import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, secret = 'a'.repeat(32)) => fetch(`${base}/telegram/webhook`, {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body,
  });
  const update = id => JSON.stringify({ update_id: id, message: { chat: { id: 123 }, text: '/ping' } });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
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
  }
});
