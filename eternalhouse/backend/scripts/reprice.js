'use strict';
// One-off: bring an existing database into the ₹199–₹499 band (safe to re-run; original price_usd is kept as the ordering source).
const { query, pool } = require('../src/db/pool');
const { MIN, MAX, makeMapper } = require('./pricing');
(async () => {
  const { rows } = await query('SELECT id, price_usd FROM products');
  const map = makeMapper(rows.map((r) => Number(r.price_usd)));
  for (const r of rows) await query('UPDATE products SET price_inr=$2 WHERE id=$1', [r.id, map(Number(r.price_usd))]);
  await query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_band');
  await query(`ALTER TABLE products ADD CONSTRAINT products_price_band CHECK (price_inr BETWEEN ${MIN} AND ${MAX})`);
  console.log('repriced', (await query('SELECT min(price_inr), max(price_inr), count(*)::int FROM products')).rows[0]);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
