'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIp, isLocalOrPrivateIp, isPublicIp, validateAllowlist } = require('./ipAddress');

test('normalizes IPv4-mapped IPv6 addresses', () => {
  assert.equal(normalizeIp('::ffff:8.8.8.8'), '8.8.8.8');
});

test('identifies local and private addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '192.168.1.250', 'fe80::1', 'fd12::8']) {
    assert.equal(isLocalOrPrivateIp(address), true, address);
  }
  assert.equal(isLocalOrPrivateIp('8.8.8.8'), false);
  assert.equal(isPublicIp('198.18.0.1'), false);
  assert.equal(isPublicIp('2001:db8::1'), false);
  assert.equal(isPublicIp('2001:20::1'), false);
  assert.equal(isPublicIp('3fff::1'), false);
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
  assert.equal(isPublicIp('8.8.8.8'), true);
});

test('accepts exactly two public IP addresses from distinct networks', () => {
  assert.deepEqual(validateAllowlist(['8.8.8.8', '1.1.1.1']), ['8.8.8.8', '1.1.1.1']);
  assert.deepEqual(validateAllowlist(['2606:4700:4700::1111', '2001:4860:4860::8888']), ['2606:4700:4700::1111', '2001:4860:4860::8888']);
});

test('rejects duplicate, private, malformed, or same-network addresses', () => {
  for (const addresses of [
    ['8.8.8.8', '8.8.8.8'],
    ['8.8.8.8', '8.8.8.200'],
    ['10.0.0.1', '1.1.1.1'],
    ['not-an-ip', '1.1.1.1'],
  ]) assert.throws(() => validateAllowlist(addresses), TypeError);
});

test('allows clearing the list only while the restriction is disabled', () => {
  assert.deepEqual(validateAllowlist(['', ''], { enabled: false }), []);
  assert.throws(() => validateAllowlist([], { enabled: true }), TypeError);
});
