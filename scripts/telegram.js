import { configured, publicUrl, secret, telegram } from '../config.js';
import { commands } from '../bot.js';

try {
  if (!configured) throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (32–256 letters, digits, _ or -) in .env or hosting environment variables.');
  const action = process.argv[2];
  if (!['setup', 'status'].includes(action)) throw new Error('Use: node scripts/telegram.js setup|status');
  if (action === 'setup') {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:') throw new Error('PUBLIC_URL must use HTTPS');
    const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(15000) });
    const health = await response.json();
    if (!response.ok || health.service !== 'Hassan Agro Telegram test bot' || !health.botConfigured) throw new Error('Public Node health endpoint is not configured/ready');
    const me = await telegram('getMe');
    await telegram('setMyCommands', { commands });
    await telegram('setWebhook', {
      url: new URL('/telegram/webhook', url).href,
      secret_token: secret,
      allowed_updates: ['message'],
      max_connections: 1,
    });
    console.log(`Webhook registered. Open https://t.me/${me.username} and send /start.`);
  }
  const info = await telegram('getWebhookInfo');
  console.log(JSON.stringify({ url: info.url, pendingUpdates: info.pending_update_count, lastError: info.last_error_message || null }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
