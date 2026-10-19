import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');

export const token = process.env.TELEGRAM_BOT_TOKEN || '';
export const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
export const publicUrl = process.env.PUBLIC_URL || 'https://telegram-bot.hassanagro.com';
export const adminUserId = String(process.env.ADMIN_TELEGRAM_USER_ID || '6976455363');
export const configured = Boolean(token && /^[A-Za-z0-9_-]{32,256}$/.test(secret));

// Optional Telegram custom-emoji IDs for inline buttons. Leave these blank
// until you have copied real IDs from Telegram; invalid values are ignored.
function customEmojiId(name) {
  const value = String(process.env[name] || '').trim();
  return /^\d+$/.test(value) ? value : undefined;
}
export const customEmojiIds = {
  product: customEmojiId('TELEGRAM_ICON_PRODUCT'),
  wallet: customEmojiId('TELEGRAM_ICON_WALLET'),
  buy: customEmojiId('TELEGRAM_ICON_BUY'),
  cancel: customEmojiId('TELEGRAM_ICON_CANCEL'),
};

export async function telegram(method, payload = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  // Never include the request URL or token in logs/errors.
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed (code ${result.error_code || response.status})`);
  return result.result;
}
