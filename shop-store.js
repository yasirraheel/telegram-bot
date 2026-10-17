import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = process.env.SHOP_DATA_DIR || join(process.cwd(), 'data');
const dataFile = join(dataDir, 'shop.json');

const initial = () => ({ version: 1, products: [], orders: [], settings: { shopName: 'ShahabTech Shop', supportText: 'Contact the shop owner for support.' } });

function ensure() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!existsSync(dataFile)) writeFileSync(dataFile, JSON.stringify(initial(), null, 2), { mode: 0o600 });
}

export function readStore() {
  ensure();
  try {
    const parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
    return { ...initial(), ...parsed, products: Array.isArray(parsed.products) ? parsed.products : [], orders: Array.isArray(parsed.orders) ? parsed.orders : [] };
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
    priceStars: product.priceStars, deliveryType: product.deliveryType, published: product.published,
    stockCount: product.stock.length, createdAt: product.createdAt, updatedAt: product.updatedAt,
  };
}
