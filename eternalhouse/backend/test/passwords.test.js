'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/auth/passwords');

test('passwords are salted scrypt hashes and verify only for the matching password', async () => {
  const password = 'correct horse battery staple';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrect password', first), false);
});

test('missing or malformed password hashes never authenticate', async () => {
  assert.equal(await verifyPassword('any password', null), false);
  assert.equal(await verifyPassword('any password', 'not-a-hash'), false);
});
