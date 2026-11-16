-- EternalHouse schema (PostgreSQL 16). Idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- D1: Users & Auth Tokens
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub    text UNIQUE,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL DEFAULT '',
  password_hash text,
  picture       text,
  role          text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  email_verified boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login    timestamptz
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS sessions (
  sid     text PRIMARY KEY,
  sess    jsonb NOT NULL,
  expire  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire);

-- D2: Product Catalog
CREATE TABLE IF NOT EXISTS products (
  id            serial PRIMARY KEY,
  record_id     text NOT NULL UNIQUE,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  brand         text NOT NULL,
  category      text NOT NULL,
  subcategory   text NOT NULL DEFAULT '',
  gender        text NOT NULL DEFAULT 'Unisex',
  price_usd     numeric(10,2) NOT NULL CHECK (price_usd >= 0),
  price_inr     integer NOT NULL CHECK (price_inr BETWEEN 199 AND 499),
  stock         integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  section       text NOT NULL DEFAULT '',
  demand_signal text NOT NULL DEFAULT '',
  evidence_type text NOT NULL DEFAULT '',
  source        text NOT NULL DEFAULT '',
  source_link   text NOT NULL DEFAULT '',
  year          integer,
  rank          integer NOT NULL DEFAULT 9999,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_cat_idx ON products (category) WHERE active;
CREATE INDEX IF NOT EXISTS products_price_idx ON products (price_inr) WHERE active;
CREATE INDEX IF NOT EXISTS products_rank_idx ON products (rank) WHERE active;

CREATE TABLE IF NOT EXISTS product_media (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('image','video')),
  url         text NOT NULL,
  position    integer NOT NULL DEFAULT 1,
  alt         text NOT NULL DEFAULT '',
  UNIQUE (product_id, kind, position)
);

-- Editorial archive (iconic looks): reference only, not purchasable
CREATE TABLE IF NOT EXISTS lookbook (
  id        serial PRIMARY KEY,
  record_id text NOT NULL UNIQUE,
  title     text NOT NULL,
  designer  text NOT NULL,
  category  text NOT NULL,
  gender    text NOT NULL DEFAULT '',
  year      integer,
  note      text NOT NULL DEFAULT '',
  source    text NOT NULL DEFAULT '',
  link      text NOT NULL DEFAULT ''
);

-- D3: Shopping Cart
CREATE TABLE IF NOT EXISTS cart_items (
  id         serial PRIMARY KEY,
  owner_key  text NOT NULL,                 -- 'u:<uuid>' or 'a:<session-cart-id>'
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty        integer NOT NULL CHECK (qty BETWEEN 1 AND 10),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_key, product_id)
);
CREATE INDEX IF NOT EXISTS cart_owner_idx ON cart_items (owner_key);

-- D4: Orders & Payments
CREATE TABLE IF NOT EXISTS orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no             text NOT NULL UNIQUE,
  user_id              uuid NOT NULL REFERENCES users(id),
  status               text NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending_payment','paid','processing','shipped','delivered','cancelled')),
  subtotal             integer NOT NULL,
  discount             integer NOT NULL DEFAULT 0,
  shipping             integer NOT NULL DEFAULT 0,
  total                integer NOT NULL,
  coupon               text,
  payment_provider     text NOT NULL DEFAULT 'mock',
  provider_order_id    text,
  provider_payment_id  text,
  ship_to              jsonb NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id         serial PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id),
  name       text NOT NULL,
  brand      text NOT NULL,
  price_inr  integer NOT NULL,
  qty        integer NOT NULL
);

-- Email Notification Service outbox
CREATE TABLE IF NOT EXISTS email_outbox (
  id         serial PRIMARY KEY,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  kind       text NOT NULL,
  status     text NOT NULL DEFAULT 'queued',
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
