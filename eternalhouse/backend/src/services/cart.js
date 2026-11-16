'use strict';
// D3 Shopping Cart + server-authoritative pricing rules.
const { query, tx } = require('../db/pool');

const COUPONS = { GENZ20: { pct: 20 } };
const FREE_SHIPPING_AT = 999;
const SHIPPING_FEE = 99;

function ownerKey(req) {
  if (req.session && req.session.uid) return 'u:' + req.session.uid;
  if (req.session && req.session.cartId) return 'a:' + req.session.cartId;
  return null;
}

async function list(owner) {
  if (!owner) return [];
  const { rows } = await query(
    `SELECT c.product_id AS id, c.qty, p.name, p.brand, p.slug, p.price_inr AS price, p.stock, p.category
       FROM cart_items c JOIN products p ON p.id = c.product_id AND p.active
      WHERE c.owner_key = $1 ORDER BY c.updated_at DESC`, [owner]);
  return rows;
}

function totals(items, couponCode) {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const coupon = COUPONS[String(couponCode || '').toUpperCase()];
  const discount = coupon ? Math.round((subtotal * coupon.pct) / 100) : 0;
  const after = subtotal - discount;
  const shipping = items.length === 0 || after >= FREE_SHIPPING_AT ? 0 : SHIPPING_FEE;
  return { subtotal, discount, shipping, total: after + shipping, coupon: coupon ? String(couponCode).toUpperCase() : null,
    count: items.reduce((s, i) => s + i.qty, 0) };
}

async function add(owner, productId, qty) {
  const { rows } = await query('SELECT stock FROM products WHERE id=$1 AND active', [productId]);
  if (!rows[0]) return { error: 'Product not found', status: 404 };
  if (rows[0].stock < 1) return { error: 'Sold out', status: 409 };
  await query(
    `INSERT INTO cart_items (owner_key, product_id, qty) VALUES ($1,$2,LEAST($3,10))
     ON CONFLICT (owner_key, product_id) DO UPDATE SET qty = LEAST(cart_items.qty + EXCLUDED.qty, 10), updated_at = now()`,
    [owner, productId, qty]);
  return { ok: true };
}

async function setQty(owner, productId, qty) {
  if (qty <= 0) return query('DELETE FROM cart_items WHERE owner_key=$1 AND product_id=$2', [owner, productId]);
  return query('UPDATE cart_items SET qty=LEAST($3,10), updated_at=now() WHERE owner_key=$1 AND product_id=$2', [owner, productId, qty]);
}

async function merge(fromKey, toKey) {
  await tx(async (c) => {
    await c.query(
      `INSERT INTO cart_items (owner_key, product_id, qty)
       SELECT $2, product_id, qty FROM cart_items WHERE owner_key=$1
       ON CONFLICT (owner_key, product_id) DO UPDATE SET qty = LEAST(cart_items.qty + EXCLUDED.qty, 10)`, [fromKey, toKey]);
    await c.query('DELETE FROM cart_items WHERE owner_key=$1', [fromKey]);
  });
}

async function count(owner) {
  if (!owner) return 0;
  const { rows } = await query('SELECT COALESCE(SUM(qty),0)::int AS n FROM cart_items WHERE owner_key=$1', [owner]);
  return rows[0].n;
}

module.exports = { ownerKey, list, totals, add, setQty, merge, count, COUPONS, FREE_SHIPPING_AT };
