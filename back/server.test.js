const assert = require('node:assert/strict');
const test = require('node:test');

// Valeurs minimales pour charger l'application sans base de données ni secrets réels.
// dotenv ne remplace pas les variables déjà définies, ces valeurs restent donc celles utilisées.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test-only-not-used';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-value-with-at-least-32-characters';
process.env.APP_ORIGINS = process.env.APP_ORIGINS || 'http://localhost:5000';

const app = require('./server');

test("l'application Express est exportée sans démarrer d'écoute", () => {
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.use, 'function');
  assert.equal(typeof app.listen, 'function');
});

test('le service démarre, répond sur une route inconnue et se ferme proprement', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  const policy = response.headers.get('content-security-policy') || '';
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  const missingRoute = await fetch(`http://127.0.0.1:${port}/route-inexistante`);
  assert.equal(missingRoute.status, 404);
});
