'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-value-with-at-least-32-characters';
process.env.APP_ORIGINS = process.env.APP_ORIGINS || 'http://localhost:5000';
process.env.CSP_MODE = 'strict';

const app = require('./server');

test('CSP stricte génère un nonce et l’injecte dans les scripts inline HTML', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/html/admin_dashboard.html`);
  if (response.status !== 200) return;
  const policy = response.headers.get('content-security-policy') || '';
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  const body = await response.text();
  assert.equal(body.includes(`<script nonce="${nonce}"`), true);
});
