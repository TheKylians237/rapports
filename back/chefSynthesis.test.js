'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const synthesis = require('./chefSynthesis');

test('valide les périodes personnalisées et refuse les dates impossibles', () => {
  assert.deepEqual(synthesis.resolveDateRange({ period: 'custom', startDate: '2026-10-01', endDate: '2026-10-16' }), {
    period: 'custom', startDate: '2026-10-01', endDate: '2026-10-16',
  });
  assert.match(synthesis.resolveDateRange({ period: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }).error, /dates valides/);
  assert.match(synthesis.resolveDateRange({ period: 'future' }).error, /Période invalide/);
});

test('calcule les périodes jour, semaine, mois, trimestre et année', () => {
  const now = new Date(2026, 9, 17, 15, 20);
  assert.deepEqual(synthesis.resolveDateRange({ period: 'day' }, now), { period: 'day', startDate: '2026-10-17', endDate: '2026-10-17' });
  assert.deepEqual(synthesis.resolveDateRange({ period: 'week' }, now), { period: 'week', startDate: '2026-10-12', endDate: '2026-10-17' });
  assert.deepEqual(synthesis.resolveDateRange({ period: 'month' }, now), { period: 'month', startDate: '2026-10-01', endDate: '2026-10-17' });
  assert.deepEqual(synthesis.resolveDateRange({ period: 'quarter' }, now), { period: 'quarter', startDate: '2026-10-01', endDate: '2026-10-17' });
  assert.deepEqual(synthesis.resolveDateRange({ period: 'year' }, now), { period: 'year', startDate: '2026-01-01', endDate: '2026-10-17' });
});

test('normalise la sélection des agents et calcule les indicateurs', () => {
  assert.deepEqual(synthesis.parseAgentIds(['a', 'b', 'a', '']), ['a', 'b']);
  const metrics = synthesis.normalizeMetrics({ reportCount: 2, approvedReports: 1, activitiesTotal: 4, completedActivities: 3, totalHours: '6.5' }, 2);
  assert.equal(metrics.completionRate, 75);
  assert.equal(metrics.approvalRate, 50);
  assert.equal(metrics.selectedAgents, 2);
});

test('construit une synthèse lisible avec ou sans activité', () => {
  const empty = synthesis.buildNarrative(synthesis.emptyMetrics(), [], 'le service Informatique', '2026-10-01', '2026-10-17');
  assert.match(empty, /Aucun rapport ni aucune activité/);
  const metrics = synthesis.normalizeMetrics({ reportCount: 1, approvedReports: 1, activitiesTotal: 1, completedActivities: 1, totalHours: 2 }, 1);
  const active = synthesis.buildNarrative(metrics, [{ category: 'Support', total: 1 }], 'l’agent Awa', '2026-10-01', '2026-10-17');
  assert.match(active, /2\.0 heures/);
  assert.match(active, /l’agent Awa/);
  assert.match(active, /Support/);
});
