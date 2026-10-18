const test = require('node:test');
const assert = require('node:assert/strict');
const { weekStartForDate, addDays } = require('./activityLogArchiveService');

test('calcule le lundi de la semaine pour les dates ISO et locales', () => {
  assert.equal(weekStartForDate('2026-10-12'), '2026-10-12');
  assert.equal(weekStartForDate('2026-10-18'), '2026-10-12');
  assert.equal(weekStartForDate('2026-10-19'), '2026-10-19');
});

test('avance les bornes d’archive d’une semaine complète', () => {
  assert.equal(addDays('2026-10-12', 7), '2026-10-19');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
});
