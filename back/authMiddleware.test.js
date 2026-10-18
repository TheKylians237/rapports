const assert = require('node:assert/strict');
const test = require('node:test');
// No DB connection is opened by these authorization tests.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';
const { restrictTo } = require('./authMiddleware');
const rateLimit = require('./rateLimit');

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

test('Big manager reçoit uniquement les routes explicitement autorisées', () => {
  assert.equal(authorize('Big_manager', 'big_manager').next, true);
  const adminOnly = authorize('big_manager', 'admin');
  assert.equal(adminOnly.next, false);
  assert.equal(adminOnly.status, 403);
});

test('parcours métier : seuls les agents soumettent et consultent leur tableau agent', () => {
  for (const role of ['agent', 'manager', 'chef_service', 'big_manager', 'admin']) {
    const result = authorize(role, 'agent');
    assert.equal(result.next, role === 'agent', `rôle ${role}`);
    if (role !== 'agent') assert.equal(result.status, 403, `rôle ${role}`);
  }
});

test('parcours métier : les routes Big manager refusent les autres rôles', () => {
  for (const role of ['agent', 'manager', 'chef_service', 'admin']) {
    const result = authorize(role, 'big_manager');
    assert.equal(result.next, false, `rôle ${role}`);
    assert.equal(result.status, 403, `rôle ${role}`);
  }
  assert.equal(authorize('big_manager', 'big_manager').next, true);
});

test('parcours métier : les managers accèdent au tableau chef de service prévu par l’application', () => {
  for (const role of ['manager', 'chef_service', 'chef_de_service', 'chef']) {
    assert.equal(authorize(role, 'chef_service').next, true, `rôle ${role}`);
  }
  for (const role of ['agent', 'big_manager', 'admin']) {
    const result = authorize(role, 'chef_service');
    assert.equal(result.next, false, `rôle ${role}`);
    assert.equal(result.status, 403, `rôle ${role}`);
  }
});

test('les fonctions déléguées au chef sont refusées au Big Manager', () => {
  for (const role of ['chef_service', 'chef_de_service', 'manager', 'admin']) {
    assert.equal(authorize(role, 'admin', 'chef_service').next, true, `rôle ${role}`);
  }
  for (const role of ['big_manager', 'agent']) {
    const result = authorize(role, 'admin', 'chef_service');
    assert.equal(result.next, false, `rôle ${role}`);
    assert.equal(result.status, 403, `rôle ${role}`);
  }
});

test('une délégation active donne accès au module chef uniquement quand elle a été vérifiée en base', () => {
  const req={user:{id:'deputy',role:'agent',delegatedPrincipalId:'principal'}};
  const result={next:false,status:null};
  const res={status(code){result.status=code;return this;},json(){return this;}};
  restrictTo('chef_service')(req,res,()=>{result.next=true;});
  assert.equal(result.next,true);
  assert.equal(authorize('agent','chef_service').status,403);
});

test('les alias de récupération partagent le même quota lorsqu’ils ont le même scope', () => {
  const limit = rateLimit({ max: 1, scope: 'test-password-recovery', keyBy: req => req.body?.email });
  const call = path => {
    const result = { status: null, next: false };
    const req = { baseUrl: '/api/auth', path, ip: '198.51.100.15', socket: { remoteAddress: '198.51.100.15' }, body: { email: 'unique-test@example.invalid' } };
    const res = { setHeader() {}, status(code) { result.status = code; return this; }, json() { return this; } };
    limit(req, res, () => { result.next = true; });
    return result;
  };
  assert.equal(call('/forgot-password').next, true);
  assert.equal(call('/reset-otp').status, 429);
});
