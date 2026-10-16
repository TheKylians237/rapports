const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PASSWORD_MIN_LENGTH,
  isValidEmail,
  isValidPassword,
  normalizeRole,
  isValidIsoDate,
  clampText,
} = require('./validators');

test('isValidEmail accepte les adresses valides et rejette les autres', () => {
  assert.equal(isValidEmail('agent@example.com'), true);
  assert.equal(isValidEmail('  Agent@Example.COM '), true);
  assert.equal(isValidEmail('sans-arobase'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
});

test('isValidPassword applique une longueur minimale unique', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  assert.equal(isValidPassword('a'.repeat(PASSWORD_MIN_LENGTH)), true);
  assert.equal(isValidPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)), false);
  assert.equal(isValidPassword('a'.repeat(201)), false);
  assert.equal(isValidPassword(123456789012), false);
});

test('normalizeRole harmonise les alias de rôles', () => {
  assert.equal(normalizeRole('Chef de Service'), 'chef_de_service');
  assert.equal(normalizeRole('  Manager '), 'manager');
  assert.equal(normalizeRole('chef-service'), 'chef_service');
});

test('isValidIsoDate valide le format et les dates réelles', () => {
  assert.equal(isValidIsoDate('2026-10-16'), true);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('16/10/2026'), false);
  assert.equal(isValidIsoDate(''), false);
});

test('clampText tronque et renvoie null pour les valeurs vides', () => {
  assert.equal(clampText('  bonjour  ', 3), 'bon');
  assert.equal(clampText('', 10), null);
  assert.equal(clampText(null, 10), null);
});
