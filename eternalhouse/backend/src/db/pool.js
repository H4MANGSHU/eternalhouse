'use strict';
const { Pool } = require('pg');
const cfg = require('../config/env');

const pool = new Pool({
  connectionString: cfg.db.url,
  max: cfg.db.poolMax,
  connectionTimeoutMillis: cfg.db.acquireTimeoutMs, // fail fast instead of unbounded queuing
  idleTimeoutMillis: 30000,
  statement_timeout: cfg.db.statementTimeoutMs,
  application_name: 'eternalhouse',
});

pool.on('error', (err) => console.error('[pg] idle client error:', err.message));

class DbBusyError extends Error {
  constructor(cause) { super('Database busy'); this.status = 503; this.cause = cause; }
}

const isAcquireTimeout = (e) => /timeout exceeded when trying to connect|Connection terminated/i.test(e && e.message);

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (e) {
    if (isAcquireTimeout(e)) throw new DbBusyError(e);
    throw e;
  }
}

async function tx(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    if (isAcquireTimeout(e)) throw new DbBusyError(e);
    throw e;
  }
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx, DbBusyError };
