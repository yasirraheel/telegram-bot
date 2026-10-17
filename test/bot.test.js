import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TELEGRAM_BOT_TOKEN = 'test-only';
process.env.TELEGRAM_WEBHOOK_SECRET = 'a'.repeat(32);
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
    const req = request({
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
