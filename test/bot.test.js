import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TELEGRAM_BOT_TOKEN = 'test-only';
process.env.TELEGRAM_WEBHOOK_SECRET = 'a'.repeat(32);
process.env.SHOP_DATA_DIR = await mkdtemp(join(tmpdir(), 'tg-shop-data-'));
const { createServer } = await import('../server.js');
const { replyFor } = await import('../bot.js');

test('commands and bounded echo work', () => {
  assert.match(replyFor({ text: '/ping@mybot' }), /Pong/);
  assert.equal(replyFor({ text: '/id', from: { id: 12 }, chat: { id: 34 } }), 'User ID: 12\nChat ID: 34');
  assert.equal(replyFor({ photo: [] }), null);
  assert.equal(replyFor({ text: 'x'.repeat(5000) }).length, 4000);
});

test('webhook authenticates, validates, replies, deduplicates, and retries failures', async () => {
  const sent = [];
  let fail = false;
  const server = createServer(async (method, payload) => {
    if (fail) throw new Error('upstream unavailable');
    sent.push({ method, payload });
  });
  // Shared hosting blocks loopback TCP; its production launcher uses Unix sockets.
  const socketDir = process.platform === 'win32' ? null : await mkdtemp(join(tmpdir(), 'tg-test-'));
  const socketPath = socketDir && join(socketDir, 'app.sock');
  await new Promise(resolve => socketPath ? server.listen(socketPath, resolve) : server.listen(0, '127.0.0.1', resolve));
  const sendRequest = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({
      ...(socketPath ? { socketPath } : { hostname: '127.0.0.1', port: server.address().port }),
      path, method: options.method || 'GET', headers: options.headers,
    }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  const post = (body, secret = 'a'.repeat(32)) => sendRequest('/telegram/webhook', {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body,
  });
  const update = id => JSON.stringify({ update_id: id, message: { chat: { id: 123 }, text: '/ping' } });
  try {
    assert.equal((await sendRequest('/health')).status, 200);
    assert.equal((await sendRequest('/.env')).status, 404);
    assert.equal((await post(update(1), 'wrong')).status, 403);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('null')).status, 400);
    assert.equal((await post('x'.repeat(70000))).status, 413);
    assert.equal((await post(update(1))).status, 200);
    assert.equal((await post(update(1))).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.chat_id, 123);
    fail = true;
    assert.equal((await post(update(2))).status, 502);
    fail = false;
    assert.equal((await post(update(2))).status, 200);
    assert.equal(sent.length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (socketDir) await rm(socketDir, { recursive: true });
  }
});

test('admin dashboard protects data and creates products through the owner session', async () => {
  const sent = [];
  const server = createServer(async (method, payload) => sent.push({ method, payload }));
  const socketDir = process.platform === 'win32' ? null : await mkdtemp(join(tmpdir(), 'tg-admin-'));
  const socketPath = socketDir && join(socketDir, 'app.sock');
  await new Promise(resolve => socketPath ? server.listen(socketPath, resolve) : server.listen(0, '127.0.0.1', resolve));
  const doRequest = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ ...(socketPath ? { socketPath } : { hostname: '127.0.0.1', port: server.address().port }), path, method: options.method || 'GET', headers: options.headers }, res => { const chunks=[]; res.on('data', c=>chunks.push(c)); res.on('end',()=>resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
    req.on('error', reject); req.end(options.body);
  });
  try {
    assert.equal((await doRequest('/admin')).status, 200);
    assert.equal((await doRequest('/api/admin/summary')).status, 401);
    const challenge = await doRequest('/api/admin/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remember: true }) });
    const { id, code } = JSON.parse(challenge.body);
    assert.match(code, /^\d{6}$/);
    await new Promise(resolve => setTimeout(resolve, 0));
    // Approve through the real Telegram update path using the configured owner ID.
    await import('../config.js');
    const update = { update_id: 4001, message: { chat: { id: 6976455363 }, from: { id: 6976455363 }, text: `/adminlogin ${code}` } };
    const updateReq = await doRequest('/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'a'.repeat(32) }, body: JSON.stringify(update) });
    assert.equal(updateReq.status, 200);
    const approved = await doRequest(`/api/admin/auth/challenge/${id}`);
    assert.equal(approved.status, 200);
    const cookie = approved.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie);
    assert.match(approved.headers['set-cookie'][0], /Max-Age=15552000/);
    const summary = await doRequest('/api/admin/summary', { headers: { cookie } });
    assert.equal(summary.status, 200);
    const initialSummary = JSON.parse(summary.body);
    assert.equal(initialSummary.commands.find(command => command.command === 'ping').enabled, true);
    assert.equal(initialSummary.commands.find(command => command.command === 'id').enabled, true);
    const commandSettings = await doRequest('/api/admin/settings', { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ commands: initialSummary.commands.map(command => ({ ...command, enabled: !['ping', 'id'].includes(command.command) })) }) });
    assert.equal(commandSettings.status, 200);
    const sentBeforeDisabledCommand = sent.length;
    assert.equal((await doRequest('/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'a'.repeat(32) }, body: JSON.stringify({ update_id: 4000, message: { chat: { id: 6976455363 }, from: { id: 6976455363 }, text: '/ping' } }) })).status, 200);
    assert.equal(sent.length, sentBeforeDisabledCommand);
    const product = await doRequest('/api/admin/products', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test product', category: 'AI Prompts', description: 'Test delivery', priceStars: 5, pricePkr: 100, deliveryType: 'Activation code', stock: ['TEST-CODE-1', 'TEST-CODE-2'], published: true }) });
    assert.equal(product.status, 200);
    const createdProduct = JSON.parse(product.body);
    assert.equal(createdProduct.stockCount, 2);
    assert.equal(createdProduct.pricePkr, 100);
    assert.equal((await doRequest('/api/admin/summary', { headers: { cookie } })).body.includes('TEST-CODE-1'), false);

    const webhook = (update, updateId) => doRequest('/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'a'.repeat(32) }, body: JSON.stringify({ update_id: updateId, ...update }) });
    assert.equal((await webhook({ message: { chat: { id: 6976455363 }, from: { id: 6976455363 }, text: '/start' } }, 4002)).status, 200);
    const menu = sent.find(item => item.method === 'sendMessage' && item.payload.text.includes('AVAILABLE PRODUCTS'));
    assert.ok(menu);
    assert.match(menu.payload.text, /instant delivery/);
    assert.match(menu.payload.reply_markup.inline_keyboard[0][0].text, /^🧠 Test product · Rs 100 · ⭐ 5$/);
    assert.equal(menu.payload.reply_markup.inline_keyboard[0][0].style, 'success');

    assert.equal((await webhook({ callback_query: { id: 'q-product', from: { id: 6976455363 }, message: { chat: { id: 6976455363 } }, data: `shop:p:${createdProduct.id}` } }, 4003)).status, 200);
    const details = sent.find(item => item.method === 'sendMessage' && item.payload.text.includes('PRODUCT DETAILS'));
    assert.ok(details);
    assert.match(details.payload.reply_markup.inline_keyboard[0][0].text, /Pay from wallet/);
    assert.equal(details.payload.reply_markup.inline_keyboard[0][0].style, 'success');

    assert.equal((await webhook({ message: { chat: { id: 6976455363 }, from: { id: 6976455363 }, text: '/recharge 1000 ABC12345' } }, 4004)).status, 200);
    const rechargeSummary = JSON.parse((await doRequest('/api/admin/summary', { headers: { cookie } })).body);
    assert.equal(rechargeSummary.rechargeRequests.length, 1);
    const recharge = await doRequest(`/api/admin/recharge-requests/${rechargeSummary.rechargeRequests[0].id}/approve`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(recharge.status, 200);

    assert.equal((await webhook({ callback_query: { id: 'q-wallet', from: { id: 6976455363 }, message: { chat: { id: 6976455363 } }, data: `shop:w:${createdProduct.id}` } }, 4005)).status, 200);
    assert.equal((await webhook({ callback_query: { id: 'q-wallet-confirm', from: { id: 6976455363 }, message: { chat: { id: 6976455363 } }, data: `shop:cw:${createdProduct.id}` } }, 4006)).status, 200);
    assert.ok(sent.some(item => item.method === 'sendMessage' && item.payload.text.includes('Payment completed from wallet')));

    assert.equal((await webhook({ callback_query: { id: 'q-buy', from: { id: 6976455363 }, message: { chat: { id: 6976455363 } }, data: `shop:b:${createdProduct.id}` } }, 4007)).status, 200);
    const confirmation = sent.find(item => item.method === 'sendMessage' && item.payload.text.includes('PURCHASE REVIEW') && item.payload.text.includes('Telegram Stars'));
    assert.ok(confirmation);
    assert.match(confirmation.payload.text, /Telegram Stars/);
    assert.equal(confirmation.payload.reply_markup.inline_keyboard[0][0].callback_data, `shop:c:${createdProduct.id}`);
    assert.equal(confirmation.payload.reply_markup.inline_keyboard[0][0].style, 'success');
    assert.equal(confirmation.payload.reply_markup.inline_keyboard[1][0].style, 'danger');

    assert.equal((await webhook({ callback_query: { id: 'q-confirm', from: { id: 6976455363 }, message: { chat: { id: 6976455363 } }, data: `shop:c:${createdProduct.id}` } }, 4008)).status, 200);
    const invoice = sent.find(item => item.method === 'sendInvoice');
    assert.ok(invoice);
    assert.equal(JSON.parse(invoice.payload.payload).productId, createdProduct.id);
    assert.match(JSON.parse(invoice.payload.payload).orderId, /^ord_/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (socketDir) await rm(socketDir, { recursive: true });
  }
});
