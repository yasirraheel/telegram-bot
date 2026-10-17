import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { commands as defaultCommands } from './bot.js';

const dataDir = process.env.SHOP_DATA_DIR || join(process.cwd(), 'data');
const dataFile = join(dataDir, 'shop.json');

const initial = () => ({
  version: 2,
  products: [],
  orders: [],
  wallets: [],
  rechargeRequests: [],
  settings: {
    shopName: 'ShahabTech Shop',
    supportText: 'Contact the shop owner for support.',
    manualPaymentInstructions: 'Contact the shop owner for the current manual payment details.',
    commands: defaultCommands.map(command => ({ ...command })),
  },
});

function ensure() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!existsSync(dataFile)) writeFileSync(dataFile, JSON.stringify(initial(), null, 2), { mode: 0o600 });
}

export function readStore() {
  ensure();
  try {
    const parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
    const defaults = initial();
    const configuredCommands = Array.isArray(parsed.settings?.commands) ? parsed.settings.commands : defaults.settings.commands;
    const normalizedCommands = defaultCommands
      .filter(command => configuredCommands.some(item => item?.command === command.command && item?.enabled !== false))
      .map(command => ({ command: command.command, description: String(configuredCommands.find(item => item?.command === command.command)?.description || command.description).slice(0, 256) }));
    return {
      ...defaults,
      ...parsed,
      products: Array.isArray(parsed.products) ? parsed.products : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
      rechargeRequests: Array.isArray(parsed.rechargeRequests) ? parsed.rechargeRequests : [],
      settings: {
        ...defaults.settings,
        ...(parsed.settings || {}),
        commands: normalizedCommands,
      },
    };
  } catch {
    throw new Error('Shop data is unreadable; refusing to overwrite it.');
  }
}

export function writeStore(store) {
  ensure();
  const temp = `${dataFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(temp, dataFile);
}

export function updateStore(mutator) {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

export function newId(prefix) { return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`; }

export function publicProduct(product) {
  return {
    id: product.id, name: product.name, category: product.category, description: product.description,
    priceStars: product.priceStars || null, pricePkr: product.pricePkr || null, deliveryType: product.deliveryType, published: product.published,
    stockCount: product.stock.length, createdAt: product.createdAt, updatedAt: product.updatedAt,
  };
}
