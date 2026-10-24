'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rateLimit = require('./rateLimit');

function request(path = '/login') {
  return {
    baseUrl: '/api/auth',
    path,
    ip: '198.51.100.10',
    socket: { remoteAddress: '198.51.100.10' },
    body: { identity: 'agent@example.invalid' },
  };
}

function response(result) {
  return {
    headers: result.headers || (result.headers = {}),
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
}

test('le magasin partagé injectable applique le même quota à deux middlewares', () => {
  const store = rateLimit.createMemoryRateLimitStore();
  const first = rateLimit({ max: 1, scope: 'shared-test', keyBy: (req) => req.body.identity, store });
  const second = rateLimit({ max: 1, scope: 'shared-test', keyBy: (req) => req.body.identity, store });
  const one = {};
  first(request(), response(one), () => {
    one.next = true;
  });
  const two = {};
  second(request('/verify-2fa'), response(two), () => {
    two.next = true;
  });
  assert.equal(one.next, true);
  assert.equal(two.status, 429);
  assert.equal(two.body.success, false);
});

test('un store asynchrone expose les compteurs et propage les erreurs', async () => {
  const calls = [];
  const middleware = rateLimit({
    max: 2,
    store: {
      consume: async (key, options) => {
        calls.push({ key, options });
        return { allowed: true, remaining: 1, resetAt: Date.now() + 1000 };
      },
    },
  });
  const result = {};
  await middleware(request(), response(result), () => {
    result.next = true;
  });
  assert.equal(result.next, true);
  assert.equal(result.headers['RateLimit-Remaining'], '1');
  assert.equal(calls.length, 1);
});
