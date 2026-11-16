'use strict';
const session = require('express-session');
const { query } = require('../db/pool');
const cfg = require('../config/env');

// D1 session persistence in PostgreSQL (survives restarts, independent of Valkey availability).
class PgStore extends session.Store {
  get(sid, cb) {
    query('SELECT sess FROM sessions WHERE sid=$1 AND expire > now()', [sid])
      .then((r) => cb(null, r.rows[0] ? r.rows[0].sess : null)).catch(cb);
  }
  set(sid, sess, cb) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 864e5);
    query(`INSERT INTO sessions (sid, sess, expire) VALUES ($1,$2,$3)
           ON CONFLICT (sid) DO UPDATE SET sess=EXCLUDED.sess, expire=EXCLUDED.expire`, [sid, sess, exp])
      .then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  touch(sid, sess, cb) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 864e5);
    query('UPDATE sessions SET expire=$2 WHERE sid=$1', [sid, exp]).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  destroy(sid, cb) { query('DELETE FROM sessions WHERE sid=$1', [sid]).then(() => cb && cb(null)).catch((e) => cb && cb(e)); }
}

const store = new PgStore();

const sessionMw = session({
  name: 'rs.sid',
  secret: cfg.sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, maxAge: 7 * 864e5 },
});

setInterval(() => query('DELETE FROM sessions WHERE expire < now()').catch(() => {}), 15 * 60 * 1000).unref();

module.exports = { sessionMw, store };
