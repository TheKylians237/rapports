const assert = require('node:assert/strict');
const test = require('node:test');
// No DB connection is opened by these authorization tests.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';
const { restrictTo } = require('./authMiddleware');

function authorize(role, ...allowedRoles) {
  const req = { user: { role } };
  const result = { status: null, body: null, next: false };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };

  restrictTo(...allowedRoles)(req, res, () => { result.next = true; });
  return result;
}

test('restrictTo autorise un rôle autorisé après normalisation', () => {
  assert.equal(authorize('Chef de Service', 'chef_service').next, true);
});

test('restrictTo bloque un rôle non autorisé', () => {
  const result = authorize('agent', 'admin');
  assert.equal(result.next, false);
  assert.equal(result.status, 403);
});

test('restrictTo bloque les requêtes sans rôle', () => {
  const result = authorize('', 'admin');
  assert.equal(result.next, false);
  assert.equal(result.status, 403);
});
