# Hassan Agro Telegram test bot

Small Node.js 22+ bot using Telegram's HTTPS webhook API, with no npm dependencies or database.

Live health endpoint: https://telegram-bot.hassanagro.com/health

Commands: `/start`, `/help`, `/products`, `/orders`, `/wallet`, `/recharge`, `/ping`, `/id`. Other text receives an echo. Photos and other non-text messages are ignored. IDs are returned only to the requesting chat. This bot does not store normal messages.

## Shop dashboard and digital products

The bot now includes a private dashboard at [telegram-bot.hassanagro.com/admin](https://telegram-bot.hassanagro.com/admin). Sign-in uses your Telegram owner ID (`6976455363`): click **Start secure sign-in**, keep **Remember me** selected if this is your private device, send the displayed `/adminlogin 123456` code to `@ShahabTech1Bot`, then return to the browser. Normal sessions last 30 days; remembered sessions last 180 days and survive an app restart. No dashboard password is stored. Sessions can be ended with **Sign out**.

From the dashboard you can create a product, choose a category, add a PKR wallet price and/or an integer Telegram Stars price, choose **Activation code** or **Access link**, and paste one delivery item per line. The Settings view contains the manual payment instructions shown to buyers. The Wallet requests view lets you verify a buyer's transfer and approve or reject the recharge; approval credits the buyer's PKR wallet. Save a draft while preparing it, or publish it when at least one item is available. The Products view never displays the stock contents; Stock and Orders show counts and delivery state. The dashboard stores shop data in a private `data/shop.json` file on the server, excluded from Git and blocked from web access.

Customers open `/start`, browse published products, and choose either Telegram Stars or an approved PKR wallet balance. For a manual recharge, the buyer taps **Wallet**, follows the instructions, transfers the amount, then sends `/recharge AMOUNT TRANSACTION_REFERENCE`. The owner approves the request from **Wallet requests**; the bot credits the wallet and can then deliver a product automatically after a wallet purchase. Stars payments still validate the invoice owner, currency, exact amount, product availability, and duplicate payment charge ID before removing stock. Telegram requires Stars for digital goods sold inside Telegram; see the [official Stars payments documentation](https://core.telegram.org/bots/payments-stars). Never add passwords or private account credentials as stock.

The shop uses Telegram's native inline-button styles: product and purchase actions are green (`success`), navigation is blue (`primary`), and cancellation is red (`danger`). These colors are rendered by Telegram inside the bot chat; they are not website CSS. The code also supports optional Telegram custom-emoji icons on those buttons. To use them, add the real numeric custom emoji IDs to the private server `.env` as `TELEGRAM_ICON_PRODUCT`, `TELEGRAM_ICON_WALLET`, `TELEGRAM_ICON_BUY`, and `TELEGRAM_ICON_CANCEL`, then restart the app. Do not invent IDs: Telegram only accepts IDs belonging to custom emoji available to the bot/account, and availability can require Telegram Premium or a bot username purchased through Fragment.

The Telegram command menu is managed in **Admin → Settings → Telegram command menu**. Checked commands are visible to every user and enabled in the bot; unchecked commands are removed from Telegram's menu and ignored. `/ping` only reports whether the bot is responding. `/id` returns the requesting user's own Telegram user and chat IDs; it does not reveal another user's ID. Adding a brand-new command with custom behavior still requires a code change.

The dashboard does not pretend to have live sales data: an empty shop shows zero products and orders. Test with a separate customer Telegram account and a low-value product first. Do not publish any product until its delivery codes or links are ready.

## 1. Create your bot in Telegram

1. Open the official verified [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Enter a display name, for example `Hassan Agro Test`.
4. Choose an available username ending in `bot`, for example `HassanAgroDemoBot`. Telegram will tell you if it is already taken.
5. BotFather returns a token. Keep it private: anyone with it can control your bot. Do not put it in GitHub, screenshots, or messages here. If exposed, use BotFather's `/revoke` command to replace it.

You must do this step using your own Telegram account. The application cannot create a Telegram identity for you.

## 2. Activate the deployed bot

The code is installed at:

```text
/home/u181781564/domains/hassanagro.com/public_html/telegram-bot
```

Open `D:\Git Work\Web\hostinger_combine_servers.bat`, select **34**, then run:

```bash
bash scripts/configure.sh
```

Paste the token when prompted. Input is hidden. The script verifies the token, writes a private `.env`, generates a random webhook secret, requests an app restart, registers the webhook, and installs the command menu. No token is committed to Git. It prints the Telegram link to open when successful.

If the host is still restarting, run these commands again after a few seconds:

```bash
export PATH="/opt/alt/alt-nodejs22/root/usr/bin:$PATH"
node scripts/telegram.js setup
node scripts/telegram.js status
```

## 3. Test in Telegram

1. Open your bot using the `https://t.me/YOUR_BOT_USERNAME` link from BotFather or the setup script.
2. Press **Start**, or send `/start`. You should receive a welcome message.
3. Send `/ping`. Expected reply: `Pong! The bot is online.`
4. Send `Hello`. Expected reply: `You said: Hello`.
5. Send `/id` to see your Telegram user and chat IDs.
6. Send `/wallet` to view the wallet and its recharge button.
7. Send `/help` to list commands.

Start testing in a private chat. For groups, add the bot to the group and use `/ping@YOUR_BOT_USERNAME`. Telegram's default privacy mode limits which group messages bots receive; normal echo messages may not reach it. You do not need to disable privacy for private chat tests. A user must open/start the bot before the bot can communicate with them privately.

## 4. Hosting configuration already used

The existing subdomain and HTTPS worked. `.htaccess` configures LiteSpeed's Node launcher using:

- Node executable: `/opt/alt/alt-nodejs22/root/usr/bin/node`
- Startup file: `app.cjs` (CommonJS loader for the ES module app)
- App root: the exact directory above
- Webhook: `https://telegram-bot.hassanagro.com/telegram/webhook`

LiteSpeed manages the app process. PM2, a manual background process, and a cron job are unnecessary for this deployment. Restart only this app with:

```bash
mkdir -p tmp
touch tmp/restart.txt
```

The HTTP app runs without a token so hosting can be checked first. `/health` then shows `botConfigured: false`; Telegram cannot reply until step 2 is completed. `botConfigured: true` checks that configuration exists; use the setup/status commands and a real `/ping` to verify the Telegram connection.

`.env`, dotfiles, source files, package manifests, and logs are blocked by `.htaccess`. The Node router also serves only its health and webhook endpoints. Keep those protections in place.

For a future Hostinger managed Node Web App deployment, select Node 22 or 24, framework **Other**, entry `server.js`, build `npm run build`, and start `npm start`. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (32–256 letters/digits/underscores/hyphens), and `PUBLIC_URL` in the app environment. That managed deployment is a separate option; the current LiteSpeed deployment is already running.

## 5. Local development

```powershell
npm ci
npm test
npm run build
Copy-Item .env.example .env
# Edit .env privately and fill in token and a random 64-character hex secret.
npm start
```

Open http://localhost:3000/health. Local HTTP alone cannot receive Telegram webhooks. Run local tests with mocked Telegram calls, or supply an HTTPS tunnel and change `PUBLIC_URL`, then run `npm run telegram:setup`. Registering another webhook for the same token replaces the hosted webhook. Use a separate BotFather bot for local experimentation, or restore the hosted webhook afterwards.

## 6. Updates

GitHub repository: https://github.com/yasirraheel/telegram-bot

From the local project in PowerShell, after testing and committing changes:

```powershell
git push origin main
scp -P 65002 .htaccess app.cjs server.js bot.js config.js package.json package-lock.json README.md u181781564@145.79.25.128:/home/u181781564/domains/hassanagro.com/public_html/telegram-bot/
scp -P 65002 scripts/telegram.js scripts/configure.sh u181781564@145.79.25.128:/home/u181781564/domains/hassanagro.com/public_html/telegram-bot/scripts/
ssh -p 65002 u181781564@145.79.25.128 "touch /home/u181781564/domains/hassanagro.com/public_html/telegram-bot/tmp/restart.txt"
```

This deployment uses uploaded files. A GitHub push alone does not redeploy it. Do not overwrite the server's private `.env`. If dependencies are added later, install production dependencies on the server before restarting.

## Troubleshooting

- **Health returns 200, botConfigured false:** run the configuration script.
- **Health shows true but no reply:** run `node scripts/telegram.js status` with Node on PATH. Check the webhook URL, pending updates and last error. Re-run setup to restore the hosted webhook.
- **401 from Telegram / token verification fails:** copy the correct token from BotFather; configure again.
- **Webhook 403:** its header secret does not match the server; run setup after any secret change.
- **503 after a deployment:** check `stderr.log` over SSH, confirm the Node executable and startup file, then request restart. The log is not publicly readable.
- **Cannot receive updates using getUpdates:** this bot uses a webhook. Telegram does not allow polling while a webhook is active.
- **Duplicate replies after a restart or rare delivery retry:** the small retry cache is in memory. Persistent exactly-once processing is outside this test bot's scope.

References: [Telegram bot creation](https://core.telegram.org/bots/tutorial#obtain-your-bot-token), [Telegram API](https://core.telegram.org/bots/api), [Telegram webhooks](https://core.telegram.org/bots/webhooks), [Hostinger Node apps](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).
