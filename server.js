import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { configured, secret, telegram } from './config.js';
import { replyFor } from './bot.js';

function authorized(value) {
  const actual = Buffer.from(typeof value === 'string' ? value : '');
  const expected = Buffer.from(secret);
  return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createServer(send = telegram) {
  // Bounded, in-memory retry suppression; resets on restart. Fine for a test bot.
  const processed = new Map();
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      return json(200, { service: 'Hassan Agro Telegram test bot', status: 'running', botConfigured: configured });
    }
    if (req.method !== 'POST' || req.url !== '/telegram/webhook') return json(404, { error: 'Not found' });
    if (!configured) return json(503, { error: 'Bot configuration required' });
    if (!authorized(req.headers['x-telegram-bot-api-secret-token'])) return json(403, { error: 'Forbidden' });
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536) return json(413, { error: 'Payload too large' });
        chunks.push(chunk);
      }
      let update;
      try { update = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return json(400, { error: 'Invalid JSON' }); }
      if (!update || !Number.isSafeInteger(update.update_id)) return json(400, { error: 'Invalid update' });
      // Telegram is configured with max_connections=1 to serialize normal delivery.
      if (processed.has(update.update_id)) return json(200, { ok: true });
      const message = update.message;
      const text = replyFor(message);
      if (text && message.chat?.id) await send('sendMessage', { chat_id: message.chat.id, text });
      processed.set(update.update_id, true);
      if (processed.size > 2000) processed.delete(processed.keys().next().value);
      return json(200, { ok: true });
    } catch {
      console.error('Webhook processing failed; Telegram may retry.');
      if (!res.headersSent) return json(502, { error: 'Please retry' });
      res.end();
    }
  });
}

export function startServer() {
  const server = createServer();
  server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log(`Telegram test bot started; configured=${configured}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
