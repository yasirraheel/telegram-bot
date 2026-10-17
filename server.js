import http from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { adminUserId, configured, secret, telegram } from './config.js';
import { commands, replyFor } from './bot.js';
import { dashboardPage, loginPage } from './admin-page.js';
import { newId, publicProduct, readStore, updateStore } from './shop-store.js';

const sessions = new Map();
const challenges = new Map();

function authorized(value) {
  const actual = Buffer.from(typeof value === 'string' ? value : '');
  const expected = Buffer.from(secret);
  return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
}

function sessionUser(req) {
  const token = cookies(req).admin_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); return null; }
  return session.userId;
}

function sendJson(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); }
function sendHtml(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); }

async function bodyJson(req, maxBytes = 65536) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function adminOnly(req, res) { const userId = sessionUser(req); if (!userId) { sendJson(res, 401, { error: 'Sign-in required' }); return null; } return userId; }
function cleanLines(value) { return (Array.isArray(value) ? value : String(value || '').split(/\r?\n/)).map(item => String(item).trim()).filter(Boolean).slice(0, 10000); }
function publicOrder(order) { return { id: order.id, productName: order.productName, amountStars: order.amountStars, userId: order.userId, deliveryStatus: order.deliveryStatus, createdAt: order.createdAt }; }
function shopKeyboard(products) { return { inline_keyboard: products.map(product => [{ text: `${product.name} · ⭐ ${product.priceStars}`, callback_data: `shop:p:${product.id}` }]) }; }

async function sendProducts(send, chatId) {
  const products = readStore().products.filter(product => product.published && product.stock.length > 0);
  if (!products.length) return send('sendMessage', { chat_id: chatId, text: 'The shop is being prepared. Please check back soon.' });
  return send('sendMessage', { chat_id: chatId, text: 'Choose a digital product:', reply_markup: shopKeyboard(products) });
}

async function handleAdminLogin(send, message, code) {
  if (String(message.from?.id) !== adminUserId) return send('sendMessage', { chat_id: message.chat.id, text: 'This account is not authorized for shop administration.' });
  const challenge = [...challenges.values()].find(item => item.code === code && item.expiresAt > Date.now());
  if (!challenge) return send('sendMessage', { chat_id: message.chat.id, text: 'That sign-in code is invalid or expired. Start again from the dashboard.' });
  challenge.approved = true; challenge.userId = adminUserId;
  return send('sendMessage', { chat_id: message.chat.id, text: 'Dashboard sign-in approved. Return to your browser.' });
}

function invoicePayload(productId, userId) { return JSON.stringify({ productId, userId: String(userId) }); }

async function handleSuccessfulPayment(send, message) {
  const payment = message.successful_payment; let payload;
  try { payload = JSON.parse(payment.invoice_payload); } catch { return; }
  if (String(payload.userId) !== String(message.from?.id) || payment.currency !== 'XTR') return;
  let order;
  try {
    order = updateStore(store => {
      const existing = store.orders.find(item => item.paymentChargeId === payment.telegram_payment_charge_id); if (existing) return existing;
      const product = store.products.find(item => item.id === payload.productId && item.published);
      if (!product || product.priceStars !== payment.total_amount || !product.stock.length) throw new Error('Product unavailable after payment');
      const item = product.stock.shift();
      const created = { id: newId('ord'), productId: product.id, productName: product.name, userId: String(message.from.id), chatId: message.chat.id, amountStars: payment.total_amount, currency: 'XTR', paymentChargeId: payment.telegram_payment_charge_id, deliveryItem: item, deliveryStatus: 'delivered', createdAt: new Date().toISOString() };
      store.orders.push(created); return created;
    });
  } catch { return send('sendMessage', { chat_id: message.chat.id, text: 'Your payment was received, but stock is temporarily unavailable. Please contact the shop owner with your Telegram payment receipt.' }); }
  const label = /^https?:\/\//.test(order.deliveryItem) ? 'Your access link' : 'Your activation code';
  return send('sendMessage', { chat_id: message.chat.id, text: `✅ Payment received for ${order.productName}.\n\n${label}:\n${order.deliveryItem}\n\nKeep this message private. Your order ID is ${order.id}.` });
}

async function handleCallback(send, query) {
  await send('answerCallbackQuery', { callback_query_id: query.id });
  const chatId = query.message?.chat?.id; const [scope, action, id] = String(query.data || '').split(':'); if (scope !== 'shop') return;
  if (action === 'list') return sendProducts(send, chatId);
  if (action === 'p') {
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!product) return send('sendMessage', { chat_id: chatId, text: 'That product is no longer available.' });
    return send('sendMessage', { chat_id: chatId, text: `${product.name}\n\n${product.description}\n\nPrice: ⭐ ${product.priceStars}\nAvailable: ${product.stock.length}`, reply_markup: { inline_keyboard: [[{ text: `Buy for ⭐ ${product.priceStars}`, callback_data: `shop:b:${product.id}` }], [{ text: '← Back to products', callback_data: 'shop:list' }]] } });
  }
  if (action === 'b') {
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!product) return send('sendMessage', { chat_id: chatId, text: 'That product is sold out.' });
    return send('sendInvoice', { chat_id: chatId, title: product.name.slice(0, 32), description: product.description.slice(0, 255), payload: invoicePayload(product.id, query.from.id), currency: 'XTR', prices: [{ label: product.name.slice(0, 32), amount: product.priceStars }], provider_token: '' });
  }
}

async function handleUpdate(send, update) {
  if (update.callback_query) return handleCallback(send, update.callback_query);
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query; let ok = false; let errorMessage = 'This product is unavailable.';
    try { const payload = JSON.parse(query.invoice_payload); const product = readStore().products.find(item => item.id === payload.productId && item.published && item.stock.length); ok = Boolean(product && String(payload.userId) === String(query.from.id) && query.currency === 'XTR' && query.total_amount === product.priceStars); if (ok) errorMessage = undefined; } catch { /* invalid payload stays rejected */ }
    return send('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok, ...(errorMessage ? { error_message: errorMessage } : {}) });
  }
  const message = update.message; if (!message?.chat?.id || typeof message.text !== 'string' && !message.successful_payment) return;
  if (message.successful_payment) return handleSuccessfulPayment(send, message);
  const command = message.text.trim().split(/\s/)[0].split('@')[0].toLowerCase(); const argument = message.text.trim().split(/\s+/).slice(1).join(' ');
  if (command === '/adminlogin') return handleAdminLogin(send, message, argument);
  if (command === '/products' || command === '/start') { await send('sendMessage', { chat_id: message.chat.id, text: replyFor({ text: '/start', chat: message.chat, from: message.from }), reply_markup: { inline_keyboard: [[{ text: 'Browse products', callback_data: 'shop:list' }]] } }); return command === '/products' ? sendProducts(send, message.chat.id) : undefined; }
  if (command === '/orders') { const orders = readStore().orders.filter(order => String(order.userId) === String(message.from?.id)).slice(-10).reverse(); return send('sendMessage', { chat_id: message.chat.id, text: orders.length ? orders.map(order => `${order.id} · ${order.productName} · ⭐ ${order.amountStars} · ${order.deliveryStatus}`).join('\n') : 'You have no orders yet.' }); }
  const text = replyFor(message); if (text) return send('sendMessage', { chat_id: message.chat.id, text });
}

async function adminApi(req, res, send) {
  if (!adminOnly(req, res)) return;
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/api/admin/summary') { const store = readStore(); return sendJson(res, 200, { metrics: { published: store.products.filter(item => item.published).length, stock: store.products.reduce((sum, item) => sum + item.stock.length, 0), orders: store.orders.length, paid: store.orders.length }, products: store.products.map(publicProduct), orders: store.orders.map(publicOrder), settings: store.settings }); }
  if (req.method === 'PATCH' && path === '/api/admin/settings') { const data = await bodyJson(req); updateStore(store => { store.settings = { ...store.settings, shopName: String(data.shopName || '').slice(0, 80), supportText: String(data.supportText || '').slice(0, 500) }; }); return sendJson(res, 200, { ok: true }); }
  const productMatch = path.match(/^\/api\/admin\/products(?:\/([^/]+))?$/);
  if (productMatch && ['POST', 'PATCH'].includes(req.method)) {
    const data = await bodyJson(req); const productId = productMatch[1];
    try { const result = updateStore(store => { const now = new Date().toISOString(); const name = String(data.name || '').trim().slice(0, 100); const description = String(data.description || '').trim().slice(0, 1000); const priceStars = Number(data.priceStars); const deliveryType = data.deliveryType === 'Access link' ? 'Access link' : 'Activation code'; const addStock = cleanLines(data.stock); if (!name || !description || !Number.isInteger(priceStars) || priceStars < 1 || priceStars > 1000000) throw new Error('Enter a name, description, and whole-number Stars price.'); if (productId) { const product = store.products.find(item => item.id === productId); if (!product) throw new Error('Product not found.'); product.name = name; product.category = String(data.category || 'Other').slice(0, 50); product.description = description; product.priceStars = priceStars; product.deliveryType = deliveryType; product.stock.push(...addStock); if (data.published === true && !product.stock.length) throw new Error('Add at least one stock item before publishing.'); product.published = Boolean(data.published); product.updatedAt = now; return publicProduct(product); } if (Boolean(data.published) && !addStock.length) throw new Error('Add at least one stock item before publishing.'); const product = { id: newId('prd'), name, category: String(data.category || 'Other').slice(0, 50), description, priceStars, deliveryType, stock: addStock, published: Boolean(data.published), createdAt: now, updatedAt: now }; store.products.push(product); return publicProduct(product); }); return sendJson(res, 200, result); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  return sendJson(res, 404, { error: 'Admin endpoint not found' });
}

export function createServer(send = telegram) {
  const processed = new Map();
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); const path = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && (path === '/' || path === '/health')) return sendJson(res, 200, { service: 'ShahabTech Telegram shop', status: 'running', botConfigured: configured, dashboard: '/admin' });
      if (req.method === 'GET' && path === '/admin') return sendHtml(res, 200, sessionUser(req) ? dashboardPage() : loginPage());
      if (path.startsWith('/api/admin/auth/')) {
        if (req.method === 'POST' && path === '/api/admin/auth/challenge') { const id = randomBytes(12).toString('hex'); const code = String(randomInt(100000, 1000000)); challenges.set(id, { id, code, expiresAt: Date.now() + 5 * 60 * 1000, approved: false }); return sendJson(res, 200, { id, code }); }
        if (req.method === 'GET' && path.startsWith('/api/admin/auth/challenge/')) { const id = path.split('/').pop(); const challenge = challenges.get(id); if (!challenge || challenge.expiresAt < Date.now()) return sendJson(res, 200, { expired: true }); if (!challenge.approved) return sendJson(res, 200, { approved: false }); const token = randomBytes(32).toString('hex'); sessions.set(token, { userId: challenge.userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }); challenges.delete(id); return sendJson(res, 200, { approved: true }, { 'Set-Cookie': `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800` }); }
        if (req.method === 'POST' && path === '/api/admin/auth/logout') { const token = cookies(req).admin_session; if (token) sessions.delete(token); return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' }); }
      }
      if (path.startsWith('/api/admin/')) return adminApi(req, res, send);
      if (req.method !== 'POST' || path !== '/telegram/webhook') return sendJson(res, 404, { error: 'Not found' });
      if (!configured) return sendJson(res, 503, { error: 'Bot configuration required' }); if (!authorized(req.headers['x-telegram-bot-api-secret-token'])) return sendJson(res, 403, { error: 'Forbidden' });
      const update = await bodyJson(req); if (!update || !Number.isSafeInteger(update.update_id)) return sendJson(res, 400, { error: 'Invalid update' }); if (processed.has(update.update_id)) return sendJson(res, 200, { ok: true });
      await handleUpdate(send, update); processed.set(update.update_id, true); if (processed.size > 2000) processed.delete(processed.keys().next().value); return sendJson(res, 200, { ok: true });
    } catch (error) { console.error('Request failed:', error.message); if (!res.headersSent) return sendJson(res, error.status || 502, { error: error.status === 413 ? error.message : 'Please retry' }); }
  });
}

export function startServer() { const server = createServer(); server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`ShahabTech shop started; configured=${configured}`)); for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
