'use strict';

process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMiddleware } = require('./internetAccess');

function createResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; },
  };
}

async function runPolicy({ ip, peerIp = ip, secure = true, headers = {}, trustProxy = false, config }) {
  const middleware = createMiddleware({ get: () => trustProxy }, async () => config);
  const req = { ip, path: '/api/test', socket: { remoteAddress: peerIp }, secure, headers };
  const res = createResponse();
  let continued = false;
  await middleware(req, res, () => { continued = true; });
  return { continued, status: res.statusCode, body: res.body };
}

const enabledConfig = { enabled: true, invalid: false, allowedIps: ['8.8.8.8', '1.1.1.1'] };

test('autorise les deux IP publiques configurées via HTTPS', async () => {
  const result = await runPolicy({ ip: '8.8.8.8', config: enabledConfig });
  assert.equal(result.continued, true);
});

test('refuse une autre IP publique et bloque HTTP même pour une IP autorisée', async () => {
  assert.equal((await runPolicy({ ip: '9.9.9.9', config: enabledConfig })).status, 403);
  assert.equal((await runPolicy({ ip: '8.8.8.8', secure: false, config: enabledConfig })).status, 426);
});

test('préserve l’accès direct du réseau local', async () => {
  const result = await runPolicy({ ip: '192.168.1.25', config: enabledConfig });
  assert.equal(result.continued, true);
});

test('refuse les en-têtes IP transmis si aucun proxy de confiance n’est configuré', async () => {
  const result = await runPolicy({ ip: '8.8.8.8', headers: { 'x-forwarded-for': '192.168.1.25' }, config: enabledConfig });
  assert.equal(result.status, 503);
});

test('refuse le mode TRUST_PROXY=true, qui permettrait de falsifier l’adresse source', async () => {
  const result = await runPolicy({ ip: '8.8.8.8', trustProxy: true, config: enabledConfig });
  assert.equal(result.status, 503);
});
