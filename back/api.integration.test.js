'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-value-with-at-least-32-characters';
process.env.APP_ORIGINS = process.env.APP_ORIGINS || 'http://localhost:5000';
process.env.CSP_MODE = 'report-only';

const app = require('./server');

async function start(t) {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('parcours API isolé : santé, CSP en observation et rapport de violation', async (t) => {
  const baseUrl = await start(t);
  const health = await fetch(`${baseUrl}/api/health`);
  assert.ok([200, 503].includes(health.status));
  assert.match(health.headers.get('content-security-policy-report-only') || '', /nonce-/);
  assert.match(health.headers.get('content-security-policy-report-only') || '', /report-uri/);

  const cspReport = await fetch(`${baseUrl}/api/security/csp-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } }),
  });
  assert.equal(cspReport.status, 204);
});

test('parcours API protégé : une demande d’audit sans session reste refusée', async (t) => {
  const baseUrl = await start(t);
  const response = await fetch(`${baseUrl}/api/auth/admin/users`);
  assert.ok([401, 503].includes(response.status));
  const body = await response.json();
  assert.equal(body.success, false);
});
