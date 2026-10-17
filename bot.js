export const commands = [
  { command: 'start', description: 'Start the test bot' },
  { command: 'help', description: 'Show available commands' },
  { command: 'ping', description: 'Check if the bot is responding' },
  { command: 'id', description: 'Show your Telegram user and chat IDs' },
];

export function replyFor(message) {
  if (!message || typeof message.text !== 'string') return null;
  const command = message.text.trim().split(/\s/)[0].split('@')[0].toLowerCase();
  switch (command) {
    case '/start': return 'Hello! Your Hassan Agro test bot is working.\nSend me a message and I will echo it.\nUse /help to see commands.';
    case '/help': return '/start — Welcome\n/help — Commands\n/ping — Connection test\n/id — Your Telegram IDs\nAny text — Echo your message';
    case '/ping': return 'Pong! The bot is online.';
    case '/id': return `User ID: ${message.from?.id ?? 'unknown'}\nChat ID: ${message.chat.id}`;
    default: return `You said: ${message.text}`.slice(0, 4000);
  }
}
