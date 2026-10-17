const test = require('node:test');
const assert = require('node:assert/strict');
const webhookService = require('./webhookService');

test('un webhook refuse les transports et adresses locales', async () => {
  for (const endpoint of [
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://192.168.1.10/hook',
    'https://localhost/hook',
    'https://example.com:8443/hook',
    'https://user:pass@example.com/hook',
  ]) {
    await assert.rejects(webhookService.validateEndpoint(endpoint));
  }
});

test('chiffrement du secret webhook exige une clé serveur suffisamment forte', () => {
  const previous=process.env.JWT_SECRET;
  const webhookKey=process.env.WEBHOOK_ENCRYPTION_KEY;
  delete process.env.WEBHOOK_ENCRYPTION_KEY;
  process.env.JWT_SECRET='short';
  assert.throws(()=>webhookService.encryptSecret('secret'),/Clé de chiffrement/);
  if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;
  if(webhookKey!==undefined)process.env.WEBHOOK_ENCRYPTION_KEY=webhookKey;
});
