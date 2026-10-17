export const commands = [
  { command: 'start', description: 'Open the product shop' },
  { command: 'products', description: 'Browse digital products' },
  { command: 'orders', description: 'View your orders' },
  { command: 'wallet', description: 'View your wallet balance' },
  { command: 'recharge', description: 'Request a manual wallet recharge' },
  { command: 'help', description: 'Show available commands' },
  { command: 'ping', description: 'Check if the bot is responding' },
  { command: 'id', description: 'Show your Telegram IDs' },
];

export function replyFor(message) {
  if (!message || typeof message.text !== 'string') return null;
  const command = message.text.trim().split(/\s/)[0].split('@')[0].toLowerCase();
  switch (command) {
    case '/start': return 'Welcome to ShahabTech Shop!\n\nUse the buttons below to browse digital products and receive your activation code or access link automatically after payment.';
    case '/help': return '/start — Open the shop\n/products — Browse products\n/orders — View your orders\n/wallet — View wallet balance\n/recharge AMOUNT REFERENCE — Request a manual recharge\n/ping — Connection test\n/id — Your Telegram IDs';
    case '/products': return null;
    case '/orders': return null;
    case '/adminlogin': return null;
    case '/ping': return 'Pong! The bot is online.';
    case '/id': return `User ID: ${message.from?.id ?? 'unknown'}\nChat ID: ${message.chat.id}`;
    default: return `You said: ${message.text}`.slice(0, 4000);
  }
}
