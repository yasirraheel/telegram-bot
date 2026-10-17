import http from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { adminUserId, configured, secret, telegram } from './config.js';
import { commands, replyFor } from './bot.js';
import { dashboardPage, loginPage } from './admin-page.js';
import { newId, publicProduct, readStore, updateStore } from './shop-store.js';

const sessions = new Map();
const challenges = new Map();
const pendingPurchases = new Map();

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
function commandMenu(store) {
  const selected = new Map((store.settings.commands || []).map(command => [command.command, command]));
  return commands.filter(command => selected.has(command.command)).map(command => ({ command: command.command, description: selected.get(command.command).description || command.description }));
}
function commandEnabled(command) { return commandMenu(readStore()).some(item => item.command === command.replace(/^\//, '')); }
async function sendHelp(send, chatId) {
  const available = commandMenu(readStore());
  return send('sendMessage', { chat_id: chatId, text: `AVAILABLE COMMANDS\n\n${available.map(item => `/${item.command} — ${item.description}`).join('\n')}` });
}
function publicOrder(order) {
  return {
    id: order.id,
    productName: order.productName,
    amountStars: order.amountStars || null,
    amountPkr: order.amountPkr || null,
    paymentMethod: order.paymentMethod || 'stars',
    userId: order.userId,
    deliveryStatus: order.deliveryStatus,
    createdAt: order.createdAt,
  };
}
function publicRecharge(request) {
  return { id: request.id, userId: request.userId, amountPkr: request.amountPkr, reference: request.reference, status: request.status, createdAt: request.createdAt, reviewedAt: request.reviewedAt, notes: request.notes || '' };
}
function productEmoji(product) {
  const value = `${product.category || ''} ${product.name || ''}`.toLowerCase();
  if (/design|graphic|logo|template/.test(value)) return '🎨';
  if (/code|dev|react|software|saas/.test(value)) return '💻';
  if (/video|music|audio/.test(value)) return '🎬';
  if (/marketing|prompt|ai|automation/.test(value)) return '🧠';
  if (/course|learn|education/.test(value)) return '📚';
  return '✨';
}

function productButtonText(product) {
  const label = `${productEmoji(product)} ${product.name}`.slice(0, 46);
  const prices = [product.pricePkr ? `Rs ${product.pricePkr}` : '', product.priceStars ? `⭐ ${product.priceStars}` : ''].filter(Boolean).join(' · ');
  return `${label}${prices ? ` · ${prices}` : ''}`.slice(0, 64);
}

function shopKeyboard(products) {
  return {
    inline_keyboard: [
      ...products.map(product => [{ text: productButtonText(product), callback_data: `shop:p:${product.id}` }]),
      [{ text: '▣ Wallet', callback_data: 'wallet:view' }, { text: '▤ My orders', callback_data: 'shop:orders' }],
    ],
  };
}

function ordersText(orders) {
  return orders.length
    ? `▤ YOUR ORDERS\n\n${orders.map(order => `${order.id}\n${order.productName} · ${order.paymentMethod === 'wallet' ? `Rs ${order.amountPkr}` : `⭐ ${order.amountStars}`} · ${order.deliveryStatus}`).join('\n\n')}`
    : '▤ YOUR ORDERS\n\nYou have no orders yet.';
}

async function sendOrders(send, chatId, userId) {
  const orders = readStore().orders.filter(order => String(order.userId) === String(userId)).slice(-10).reverse();
  return send('sendMessage', { chat_id: chatId, text: ordersText(orders), reply_markup: { inline_keyboard: [[{ text: '▣ Wallet', callback_data: 'wallet:view' }, { text: '◂ Shop', callback_data: 'shop:list' }]] } });
}

function walletFor(store, userId) {
  return store.wallets.find(wallet => String(wallet.userId) === String(userId)) || { userId: String(userId), balancePkr: 0, totalDepositedPkr: 0 };
}

function walletText(store, userId) {
  const wallet = walletFor(store, userId);
  return `▣ WALLET\n\nAvailable balance: Rs ${wallet.balancePkr}\nTotal recharged: Rs ${wallet.totalDepositedPkr}\n\nUse wallet balance to pay for products. Recharge requests are reviewed manually by the shop owner.`;
}

async function sendWallet(send, chatId, userId) {
  return send('sendMessage', {
    chat_id: chatId,
    text: walletText(readStore(), userId),
    reply_markup: { inline_keyboard: [[{ text: '+ Recharge wallet', callback_data: 'wallet:recharge' }], [{ text: '◂ Shop', callback_data: 'shop:list' }]] },
  });
}

async function sendRechargeInstructions(send, chatId) {
  const store = readStore();
  return send('sendMessage', {
    chat_id: chatId,
    text: `▣ RECHARGE WALLET\n\n${store.settings.manualPaymentInstructions}\n\nAfter you complete the transfer, send:\n/recharge AMOUNT TRANSACTION_REFERENCE\n\nExample:\n/recharge 1000 ABC12345\n\nYour request will stay pending until the shop owner verifies it.`,
    reply_markup: { inline_keyboard: [[{ text: '▣ View wallet', callback_data: 'wallet:view' }], [{ text: '◂ Shop', callback_data: 'shop:list' }]] },
  });
}

async function sendProducts(send, chatId) {
  const store = readStore();
  const shopName = store.settings?.shopName || 'ShahabTech Shop';
  const products = store.products.filter(product => product.published && product.stock.length > 0);
  if (!products.length) return send('sendMessage', { chat_id: chatId, text: `🛒 ${shopName.toUpperCase()}\n\nThe shop is being prepared. Please check back soon.` });
  const stockLine = products.reduce((sum, product) => sum + product.stock.length, 0);
  const text = `▣ ${shopName.toUpperCase()}\n\nDigital tools, prompts and templates with instant delivery.\n\nAVAILABLE PRODUCTS · ${stockLine} items\nSelect an item to review payment options.`;
  return send('sendMessage', { chat_id: chatId, text, reply_markup: shopKeyboard(products) });
}

async function handleAdminLogin(send, message, code) {
  if (String(message.from?.id) !== adminUserId) return send('sendMessage', { chat_id: message.chat.id, text: 'This account is not authorized for shop administration.' });
  const challenge = [...challenges.values()].find(item => item.code === code && item.expiresAt > Date.now());
  if (!challenge) return send('sendMessage', { chat_id: message.chat.id, text: 'That sign-in code is invalid or expired. Start again from the dashboard.' });
  challenge.approved = true; challenge.userId = adminUserId;
  return send('sendMessage', { chat_id: message.chat.id, text: 'Dashboard sign-in approved. Return to your browser.' });
}

function invoicePayload(productId, userId, orderId) { return JSON.stringify({ productId, userId: String(userId), orderId }); }

function deliveryMessage(order) {
  const label = /^https?:\/\//.test(order.deliveryItem) ? 'Access link' : 'Activation code';
  return `Payment received for ${order.productName}.\n\n${label}:\n${order.deliveryItem}\n\nKeep this message private. Order ID: ${order.id}.`;
}

async function handleSuccessfulPayment(send, message) {
  const payment = message.successful_payment; let payload;
  try { payload = JSON.parse(payment.invoice_payload); } catch { return; }
  if (String(payload.userId) !== String(message.from?.id) || payment.currency !== 'XTR') return;
  let order;
  try {
    order = updateStore(store => {
      const existing = store.orders.find(item => item.paymentChargeId === payment.telegram_payment_charge_id); if (existing) return existing;
      const product = store.products.find(item => item.id === payload.productId && item.published);
      if (!product || !product.priceStars || product.priceStars !== payment.total_amount || !product.stock.length) throw new Error('Product unavailable after payment');
      const item = product.stock.shift();
      const created = { id: payload.orderId || newId('ord'), productId: product.id, productName: product.name, userId: String(message.from.id), chatId: message.chat.id, amountStars: payment.total_amount, paymentMethod: 'stars', currency: 'XTR', paymentChargeId: payment.telegram_payment_charge_id, deliveryItem: item, deliveryStatus: 'delivered', createdAt: new Date().toISOString() };
      store.orders.push(created); return created;
    });
  } catch { return send('sendMessage', { chat_id: message.chat.id, text: 'Your payment was received, but stock is temporarily unavailable. Please contact the shop owner with your Telegram payment receipt.' }); }
  return send('sendMessage', { chat_id: message.chat.id, text: deliveryMessage(order) });
}

async function handleWalletPurchase(send, query, product, orderId = newId('ord')) {
  const userId = String(query.from?.id);
  let order;
  try {
    order = updateStore(store => {
      const current = store.wallets.find(wallet => String(wallet.userId) === userId);
      const wallet = current || { userId, balancePkr: 0, totalDepositedPkr: 0, updatedAt: new Date().toISOString() };
      const price = Number(product.pricePkr);
      const freshProduct = store.products.find(item => item.id === product.id && item.published);
      if (!freshProduct || !Number.isInteger(price) || price < 1 || !freshProduct.pricePkr || freshProduct.pricePkr !== price || !freshProduct.stock.length) throw new Error('Product unavailable');
      if (Number(wallet.balancePkr) < price) throw new Error('Insufficient wallet balance');
      wallet.balancePkr -= price;
      wallet.updatedAt = new Date().toISOString();
      if (!current) store.wallets.push(wallet);
      const item = freshProduct.stock.shift();
      const created = { id: orderId, productId: freshProduct.id, productName: freshProduct.name, userId, chatId: query.message.chat.id, amountPkr: price, paymentMethod: 'wallet', deliveryItem: item, deliveryStatus: 'delivered', createdAt: new Date().toISOString() };
      store.orders.push(created);
      return created;
    });
  } catch (error) {
    return send('sendMessage', { chat_id: query.message.chat.id, text: error.message === 'Insufficient wallet balance' ? 'Your wallet balance is too low for this product. Recharge your wallet or choose Telegram Stars.' : 'That product is no longer available.', reply_markup: { inline_keyboard: [[{ text: '+ Recharge wallet', callback_data: 'wallet:recharge' }], [{ text: '◂ Shop', callback_data: 'shop:list' }]] } });
  }
  return send('sendMessage', { chat_id: query.message.chat.id, text: `Payment completed from wallet.\n\n${deliveryMessage(order)}` });
}

function createRechargeRequest(userId, chatId, amountPkr, reference) {
  return updateStore(store => {
    const request = { id: newId('rch'), userId: String(userId), chatId, amountPkr, reference, status: 'pending', createdAt: new Date().toISOString() };
    store.rechargeRequests.push(request);
    return request;
  });
}

async function handleRechargeCommand(send, message, argument) {
  const parts = String(argument || '').trim().split(/\s+/).filter(Boolean);
  const amountPkr = Number(parts.shift());
  const reference = parts.join(' ').slice(0, 120);
  if (!Number.isInteger(amountPkr) || amountPkr < 1 || amountPkr > 10000000 || !reference) {
    return send('sendMessage', { chat_id: message.chat.id, text: 'Use this format after making your manual transfer:\n/recharge AMOUNT TRANSACTION_REFERENCE\n\nExample:\n/recharge 1000 ABC12345', reply_markup: { inline_keyboard: [[{ text: '+ Recharge instructions', callback_data: 'wallet:recharge' }]] } });
  }
  const request = createRechargeRequest(message.from?.id, message.chat.id, amountPkr, reference);
  return send('sendMessage', { chat_id: message.chat.id, text: `Recharge request ${request.id} received.\n\nAmount: Rs ${amountPkr}\nReference: ${reference}\nStatus: Pending owner review\n\nYour wallet will be credited after the transfer is verified.`, reply_markup: { inline_keyboard: [[{ text: '▣ View wallet', callback_data: 'wallet:view' }], [{ text: '◂ Shop', callback_data: 'shop:list' }]] } });
}

async function handleCallback(send, query) {
  await send('answerCallbackQuery', { callback_query_id: query.id });
  const chatId = query.message?.chat?.id; const [scope, action, id] = String(query.data || '').split(':');
  if (scope === 'wallet') {
    if (action === 'view') return sendWallet(send, chatId, query.from?.id);
    if (action === 'recharge') return sendRechargeInstructions(send, chatId);
    return;
  }
  if (scope !== 'shop') return;
  if (action === 'list') return sendProducts(send, chatId);
  if (action === 'orders') return sendOrders(send, chatId, query.from?.id);
  if (action === 'p') {
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!product) return send('sendMessage', { chat_id: chatId, text: 'That product is no longer available.' });
    const deliveryType = String(product.deliveryType || 'Activation code');
    const priceLines = [product.pricePkr ? `Wallet price: Rs ${product.pricePkr}` : '', product.priceStars ? `Telegram Stars price: ⭐ ${product.priceStars}` : ''].filter(Boolean).join('\n');
    const buttons = [];
    if (product.pricePkr) buttons.push({ text: `▣ Pay from wallet · Rs ${product.pricePkr}`, callback_data: `shop:w:${product.id}` });
    if (product.priceStars) buttons.push({ text: `⭐ Pay with Stars · ${product.priceStars}`, callback_data: `shop:b:${product.id}` });
    return send('sendMessage', { chat_id: chatId, text: `▣ PRODUCT DETAILS\n\n${productEmoji(product)} ${product.name}\n\n${product.description}\n\n${priceLines}\nSTOCK: ${product.stock.length} available\nDELIVERY: Instant ${deliveryType.toLowerCase()}\n\nChoose a payment method.`, reply_markup: { inline_keyboard: [...buttons.map(button => [button]), [{ text: '◂ Back to shop', callback_data: 'shop:list' }]] } });
  }
  if (action === 'b') {
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!product || !product.priceStars) return send('sendMessage', { chat_id: chatId, text: 'Telegram Stars are not available for this product.' });
    const deliveryType = String(product.deliveryType || 'Activation code');
    const orderId = newId('ord');
    pendingPurchases.set(`${chatId}:${product.id}`, { userId: String(query.from?.id), orderId, method: 'stars', expiresAt: Date.now() + 10 * 60 * 1000 });
    return send('sendMessage', { chat_id: chatId, text: `▣ PURCHASE REVIEW\n\nOrder: ${orderId}\nProduct: ${product.name}\nQuantity: 1\nTotal: ⭐ ${product.priceStars}\nPayment: Telegram Stars\nDelivery: Instant ${deliveryType.toLowerCase()}\n\nContinue to Telegram payment?`, reply_markup: { inline_keyboard: [[{ text: `Proceed · ⭐ ${product.priceStars}`, callback_data: `shop:c:${product.id}` }], [{ text: 'Cancel', callback_data: `shop:x:${product.id}` }]] } });
  }
  if (action === 'w') {
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!product || !product.pricePkr) return send('sendMessage', { chat_id: chatId, text: 'Wallet payment is not available for this product.' });
    const balance = walletFor(readStore(), query.from?.id).balancePkr;
    const orderId = newId('ord');
    pendingPurchases.set(`${chatId}:${product.id}`, { userId: String(query.from?.id), orderId, method: 'wallet', expiresAt: Date.now() + 10 * 60 * 1000 });
    return send('sendMessage', { chat_id: chatId, text: `▣ PURCHASE REVIEW\n\nOrder: ${orderId}\nProduct: ${product.name}\nQuantity: 1\nTotal: Rs ${product.pricePkr}\nWallet balance: Rs ${balance}\nAfter purchase: Rs ${Math.max(0, balance - product.pricePkr)}\nPayment: Wallet\nDelivery: Instant delivery\n\nConfirm wallet payment?`, reply_markup: { inline_keyboard: [[{ text: `Proceed · Rs ${product.pricePkr}`, callback_data: `shop:cw:${product.id}` }], [{ text: 'Cancel', callback_data: `shop:x:${product.id}` }]] } });
  }
  if (action === 'c') {
    const pendingKey = `${chatId}:${id}`; const pending = pendingPurchases.get(pendingKey);
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!pending || pending.method !== 'stars' || pending.expiresAt < Date.now() || String(pending.userId) !== String(query.from?.id)) return send('sendMessage', { chat_id: chatId, text: 'This purchase confirmation expired. Please choose the product again.', reply_markup: { inline_keyboard: [[{ text: '◂ Back to shop', callback_data: 'shop:list' }]] } });
    if (!product) { pendingPurchases.delete(pendingKey); return send('sendMessage', { chat_id: chatId, text: 'That product is sold out. Please choose another product.', reply_markup: { inline_keyboard: [[{ text: '🛒 Back to shop', callback_data: 'shop:list' }]] } }); }
    pendingPurchases.delete(pendingKey);
    return send('sendInvoice', { chat_id: chatId, title: product.name.slice(0, 32), description: product.description.slice(0, 255), payload: invoicePayload(product.id, query.from.id, pending.orderId), currency: 'XTR', prices: [{ label: product.name.slice(0, 32), amount: product.priceStars }], provider_token: '' });
  }
  if (action === 'cw') {
    const pendingKey = `${chatId}:${id}`; const pending = pendingPurchases.get(pendingKey);
    const product = readStore().products.find(item => item.id === id && item.published && item.stock.length);
    if (!pending || pending.method !== 'wallet' || pending.expiresAt < Date.now() || String(pending.userId) !== String(query.from?.id) || !product) return send('sendMessage', { chat_id: chatId, text: 'This wallet purchase expired. Please choose the product again.', reply_markup: { inline_keyboard: [[{ text: '◂ Back to shop', callback_data: 'shop:list' }]] } });
    pendingPurchases.delete(pendingKey);
    return handleWalletPurchase(send, query, product, pending.orderId);
  }
  if (action === 'x') {
    pendingPurchases.delete(`${chatId}:${id}`);
    return send('sendMessage', { chat_id: chatId, text: 'Purchase cancelled. Your shop is still open.', reply_markup: { inline_keyboard: [[{ text: '◂ Back to shop', callback_data: 'shop:list' }]] } });
  }
}

async function handleUpdate(send, update) {
  if (update.callback_query) return handleCallback(send, update.callback_query);
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query; let ok = false; let errorMessage = 'This product is unavailable.';
    try { const payload = JSON.parse(query.invoice_payload); const product = readStore().products.find(item => item.id === payload.productId && item.published && item.stock.length); ok = Boolean(product && product.priceStars && String(payload.userId) === String(query.from.id) && query.currency === 'XTR' && query.total_amount === product.priceStars); if (ok) errorMessage = undefined; } catch { /* invalid payload stays rejected */ }
    return send('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok, ...(errorMessage ? { error_message: errorMessage } : {}) });
  }
  const message = update.message; if (!message?.chat?.id || typeof message.text !== 'string' && !message.successful_payment) return;
  if (message.successful_payment) return handleSuccessfulPayment(send, message);
  const command = message.text.trim().split(/\s/)[0].split('@')[0].toLowerCase(); const argument = message.text.trim().split(/\s+/).slice(1).join(' ');
  if (command === '/adminlogin') return handleAdminLogin(send, message, argument);
  if (command.startsWith('/') && !commandEnabled(command)) return;
  if (command === '/help') return sendHelp(send, message.chat.id);
  if (command === '/products' || command === '/start') return sendProducts(send, message.chat.id);
  if (command === '/orders') return sendOrders(send, message.chat.id, message.from?.id);
  if (command === '/wallet') return sendWallet(send, message.chat.id, message.from?.id);
  if (command === '/recharge') return handleRechargeCommand(send, message, argument);
  const text = replyFor(message); if (text) return send('sendMessage', { chat_id: message.chat.id, text });
}

async function adminApi(req, res, send) {
  if (!adminOnly(req, res)) return;
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/api/admin/summary') {
    const store = readStore();
    return sendJson(res, 200, {
      metrics: {
        published: store.products.filter(item => item.published).length,
        stock: store.products.reduce((sum, item) => sum + item.stock.length, 0),
        orders: store.orders.length,
        paid: store.orders.length,
        pendingRecharges: store.rechargeRequests.filter(item => item.status === 'pending').length,
        walletBalance: store.wallets.reduce((sum, wallet) => sum + Number(wallet.balancePkr || 0), 0),
      },
      products: store.products.map(publicProduct),
      orders: store.orders.map(publicOrder),
      rechargeRequests: store.rechargeRequests.map(publicRecharge).reverse(),
      settings: store.settings,
      commands: commands.map(command => ({ ...command, enabled: commandMenu(store).some(active => active.command === command.command) })),
    });
  }
  if (req.method === 'PATCH' && path === '/api/admin/settings') {
    const data = await bodyJson(req);
    const nextCommands = Array.isArray(data.commands) ? commands.filter(command => data.commands.some(item => item?.command === command.command && item?.enabled !== false)).map(command => ({ command: command.command, description: String(data.commands.find(item => item?.command === command.command)?.description || command.description).slice(0, 256) })) : null;
    if (nextCommands) await send('setMyCommands', { commands: nextCommands });
    updateStore(store => {
      store.settings = {
        ...store.settings,
        ...(data.shopName !== undefined ? { shopName: String(data.shopName).slice(0, 80) } : {}),
        ...(data.supportText !== undefined ? { supportText: String(data.supportText).slice(0, 500) } : {}),
        ...(data.manualPaymentInstructions !== undefined ? { manualPaymentInstructions: String(data.manualPaymentInstructions).slice(0, 2000) } : {}),
        ...(nextCommands ? { commands: nextCommands } : {}),
      };
    });
    return sendJson(res, 200, { ok: true });
  }
  const productMatch = path.match(/^\/api\/admin\/products(?:\/([^/]+))?$/);
  if (productMatch && ['POST', 'PATCH'].includes(req.method)) {
    const data = await bodyJson(req); const productId = productMatch[1];
    try {
      const result = updateStore(store => {
        const now = new Date().toISOString();
        const name = String(data.name || '').trim().slice(0, 100);
        const description = String(data.description || '').trim().slice(0, 1000);
        const rawStars = String(data.priceStars ?? '').trim();
        const rawPkr = String(data.pricePkr ?? '').trim();
        const priceStars = rawStars ? Number(rawStars) : null;
        const pricePkr = rawPkr ? Number(rawPkr) : null;
        const deliveryType = data.deliveryType === 'Access link' ? 'Access link' : 'Activation code';
        const addStock = cleanLines(data.stock);
        if (!name || !description || (!Number.isInteger(priceStars) || priceStars < 1 || priceStars > 1000000) && (!Number.isInteger(pricePkr) || pricePkr < 1 || pricePkr > 100000000)) throw new Error('Enter at least one whole-number price: Stars or PKR.');
        if (priceStars !== null && (!Number.isInteger(priceStars) || priceStars < 1 || priceStars > 1000000)) throw new Error('Stars price must be a whole number between 1 and 1,000,000.');
        if (pricePkr !== null && (!Number.isInteger(pricePkr) || pricePkr < 1 || pricePkr > 100000000)) throw new Error('PKR price must be a whole number between 1 and 100,000,000.');
        if (productId) {
          const product = store.products.find(item => item.id === productId);
          if (!product) throw new Error('Product not found.');
          product.name = name; product.category = String(data.category || 'Other').slice(0, 50); product.description = description;
          product.priceStars = priceStars; product.pricePkr = pricePkr; product.deliveryType = deliveryType; product.stock.push(...addStock);
          if (data.published === true && !product.stock.length) throw new Error('Add at least one stock item before publishing.');
          product.published = Boolean(data.published); product.updatedAt = now; return publicProduct(product);
        }
        if (Boolean(data.published) && !addStock.length) throw new Error('Add at least one stock item before publishing.');
        const product = { id: newId('prd'), name, category: String(data.category || 'Other').slice(0, 50), description, priceStars, pricePkr, deliveryType, stock: addStock, published: Boolean(data.published), createdAt: now, updatedAt: now };
        store.products.push(product); return publicProduct(product);
      });
      return sendJson(res, 200, result);
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  const rechargeAction = path.match(/^\/api\/admin\/recharge-requests\/([^/]+)\/(approve|reject)$/);
  if (req.method === 'POST' && rechargeAction) {
    const requestId = rechargeAction[1]; const action = rechargeAction[2]; const data = await bodyJson(req);
    const originalRequest = readStore().rechargeRequests.find(item => item.id === requestId);
    try {
      const result = updateStore(store => {
        const request = store.rechargeRequests.find(item => item.id === requestId);
        if (!request) throw new Error('Recharge request not found.');
        if (request.status !== 'pending') throw new Error('This request has already been reviewed.');
        request.status = action === 'approve' ? 'approved' : 'rejected'; request.reviewedAt = new Date().toISOString(); request.notes = String(data.notes || '').slice(0, 500);
        if (action === 'approve') {
          let wallet = store.wallets.find(item => String(item.userId) === String(request.userId));
          if (!wallet) { wallet = { userId: String(request.userId), balancePkr: 0, totalDepositedPkr: 0 }; store.wallets.push(wallet); }
          wallet.balancePkr = Number(wallet.balancePkr || 0) + request.amountPkr; wallet.totalDepositedPkr = Number(wallet.totalDepositedPkr || 0) + request.amountPkr; wallet.updatedAt = new Date().toISOString();
        }
        return publicRecharge(request);
      });
      if (originalRequest?.chatId) {
        try {
          await send('sendMessage', { chat_id: originalRequest.chatId, text: action === 'approve' ? `Wallet recharge approved. Rs ${originalRequest.amountPkr} has been added to your wallet.` : `Wallet recharge ${originalRequest.id} was rejected. Please contact support if you believe this is an error.` });
        } catch { /* A notification failure must not undo an approved wallet credit. */ }
      }
      return sendJson(res, 200, result);
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
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
