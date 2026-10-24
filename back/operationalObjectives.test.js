'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const objectives = require('./operationalObjectives');

test('les objectifs opérationnels ont des valeurs par défaut et une validation stricte', () => {
  const values = objectives.fromEnvironment();
  assert.equal(values.availability_target, '99.5');
  assert.equal(values.backup_frequency, 'quotidienne');
  assert.deepEqual(objectives.validate({ availability_target: '99.9', backup_frequency: 'hebdomadaire' }), {
    availability_target: '99.9',
    backup_frequency: 'hebdomadaire',
  });
  assert.throws(() => objectives.validate({ restore_target_minutes: 'quatre heures' }), /numérique/);
});
