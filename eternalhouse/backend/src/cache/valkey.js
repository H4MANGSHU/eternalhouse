'use strict';
const Redis = require('ioredis');
const cfg = require('../config/env');
const { query } = require('../db/pool');

// Cache stores exactly 3 fields per product: name, price, stock. TTL 1h. Never blocks if Valkey is down.
let client = null;
let healthy = false;

function init() {
  if (!cfg.valkey.url || client) return;
  client = new Redis(cfg.valkey.url, {
    lazyConnect: true,
    connectTimeout: cfg.valkey.connectTimeoutMs,
    commandTimeout: 300,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (n) => Math.min(n * 500, 5000),
  });
  client.on('ready', () => { healthy = true; });
  client.on('end', () => { healthy = false; });
  client.on('close', () => { healthy = false; });
  client.on('error', () => { healthy = false; });
  client.connect().catch(() => { healthy = false; });
}

const key = (id) => `rs:prod:${id}`;

async function getSummaries(ids) {
  const out = new Map();
  if (!ids.length) return out;
  let missing = ids.slice();
  if (client && healthy) {
    try {
      const pipe = client.pipeline();
      ids.forEach((id) => pipe.hgetall(key(id)));
      const res = await pipe.exec();
      missing = [];
      res.forEach(([err, h], i) => {
        if (!err && h && h.name !== undefined) {
          out.set(ids[i], { name: h.name, price: Number(h.price), stock: Number(h.stock) });
        } else missing.push(ids[i]);
      });
    } catch (_) { missing = ids.slice(); out.clear(); }
  }
  if (missing.length) {
    const { rows } = await query(
      'SELECT id, name, price_inr AS price, stock FROM products WHERE id = ANY($1::int[]) AND active', [missing]);
    const pipe = client && healthy ? client.pipeline() : null;
    rows.forEach((r) => {
      const v = { name: r.name, price: r.price, stock: r.stock };
      out.set(r.id, v);
      if (pipe) { pipe.hset(key(r.id), v); pipe.expire(key(r.id), cfg.valkey.ttlSeconds); }
    });
    if (pipe) pipe.exec().catch(() => {});
  }
  return out;
}

async function evict(ids) {
  if (!client || !healthy || !ids.length) return;
  try { await client.del(ids.map(key)); } catch (_) { /* degrade silently */ }
}

async function ping() {
  if (!client) return { ok: false, reason: 'not configured' };
  try {
    const t = Date.now();
    const r = await client.ping();
    return { ok: r === 'PONG', ms: Date.now() - t };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function close() { if (client) { try { await client.quit(); } catch (_) { client.disconnect(); } } }

module.exports = { init, getSummaries, evict, ping, close, key, isHealthy: () => healthy, raw: () => client };
