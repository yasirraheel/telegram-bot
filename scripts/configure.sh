#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/alt/alt-nodejs22/root/usr/bin:$PATH"
read -r -s -p 'Paste your BotFather token (hidden): ' TELEGRAM_BOT_TOKEN
printf '\n'
export TELEGRAM_BOT_TOKEN
node --input-type=module <<'NODE'
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!/^\d+:[A-Za-z0-9_-]+$/.test(process.env.TELEGRAM_BOT_TOKEN || '')) {
  console.error('Invalid token format. Obtain the token from @BotFather.');
  process.exit(1);
}
// Validate the supplied token before modifying existing configuration.
const { telegram } = await import('./config.js');
try { await telegram('getMe'); }
catch { console.error('Token could not be verified with Telegram. Configuration was not changed.'); process.exit(1); }
if (existsSync('.env')) process.loadEnvFile('.env');
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || randomBytes(32).toString('hex');
writeFileSync('.env', `TELEGRAM_BOT_TOKEN=${process.env.TELEGRAM_BOT_TOKEN}\nTELEGRAM_WEBHOOK_SECRET=${secret}\nPUBLIC_URL=https://telegram-bot.hassanagro.com\n`, { mode: 0o600 });
chmodSync('.env', 0o600);
console.log('Token verified and saved privately.');
NODE
unset TELEGRAM_BOT_TOKEN
mkdir -p tmp
touch tmp/restart.txt
echo 'Restart requested. Waiting for the public app configuration...'
for attempt in {1..15}; do
  if node --input-type=module -e 'try { const r = await fetch("https://telegram-bot.hassanagro.com/health", { signal: AbortSignal.timeout(5000) }); const h = await r.json(); process.exit(r.ok && h.botConfigured ? 0 : 1); } catch { process.exit(1); }'; then
    node scripts/telegram.js setup
    exit 0
  fi
  sleep 2
done
echo 'App restart is still pending. Run: node scripts/telegram.js setup once /health shows botConfigured=true.'
exit 1
