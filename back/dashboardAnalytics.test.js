const test = require('node:test');
const assert = require('node:assert/strict');
const bigManager = require('./bigManagerAnalytics')._test;
const chef = require('./chefInsightsController')._test;
const agent = require('./agentDashboardController')._test;

test('les filtres Big Manager exigent des dates réelles et une fenêtre bornée', () => {
  assert.equal(bigManager.isoDate('2026-02-28'), true);
  assert.equal(bigManager.isoDate('2026-02-29'), false);
  assert.equal(bigManager.dateWindow({startDate:'2026-10-01',endDate:'2026-10-16'}).span, 16);
  assert.ok(bigManager.dateWindow({startDate:'2025-01-01',endDate:'2026-10-16'}).error);
});

test('les indicateurs comparatifs exposent les taux qualité et leur évolution', () => {
  const comparison = bigManager.buildComparison({
    startDate: '2026-10-17',
    span: 7,
    current: { reportCount: 10, approved: 8, late: 2, completeReports: 9 },
    previous: { reportCount: 8, approved: 4, rejected: 2, late: 4, completeReports: 4 },
  });
  assert.equal(comparison.priorStart, '2026-10-10');
  assert.equal(comparison.priorEnd, '2026-10-16');
  assert.equal(comparison.baselineAvailable, true);
  assert.equal(comparison.previousCompletenessRate, 50);
  assert.equal(comparison.completenessRateChange, 40);
  assert.equal(comparison.approvalRateChange, 30);
  assert.equal(comparison.lateRateChange, -30);
});

test('la ponctualité des rappels est réglable et retombe à 17 h', () => {
  const previous=process.env.DAILY_REPORT_DEADLINE_HOUR;
  process.env.DAILY_REPORT_DEADLINE_HOUR='19';
  assert.equal(bigManager.expectedDeadline(),'19:00:00');
  process.env.DAILY_REPORT_DEADLINE_HOUR='invalid';
  assert.equal(bigManager.expectedDeadline(),'17:00:00');
  if(previous===undefined)delete process.env.DAILY_REPORT_DEADLINE_HOUR;else process.env.DAILY_REPORT_DEADLINE_HOUR=previous;
});

test('le score qualité agent combine complétude, détail et cohérence des heures', () => {
  assert.equal(agent.scoreReport({activityCount:2,averageDescriptionLength:80,totalHours:6,activityHours:6}),100);
  assert.equal(agent.scoreReport(null),0);
  assert.ok(agent.scoreReport({activityCount:1,averageDescriptionLength:10,totalHours:9,activityHours:3})<50);
});

test('la meilleure série agent compte les jours ouvrés consécutifs', () => {
  const reports=['2026-10-01','2026-10-02','2026-10-05','2026-10-06'].map(reportDate=>({reportDate}));
  assert.equal(agent.bestReportStreak(reports,'2026-10-01','2026-10-07'),4);
});

test('les motifs de rejet sont regroupés dans les catégories réutilisables', () => {
  assert.equal(chef.rejectionCategory('[Motif: Horaires] Les durées ne concordent pas.'),'Horaires et durées');
  assert.equal(chef.rejectionCategory('[Motif: Pièces manquantes] Ajouter la facture.'),'Pièce justificative');
});

test('le suivi chef calcule participation, alertes et matrice sans toucher aux rapports', () => {
  const now=new Date(2026,9,16,18,0,0);
  const built=chef.buildInsights([{id:'a1',name:'Agent A',username:'a'}],[
    {id:'r1',userId:'a1',reportDate:'2026-10-15',status:'approved',totalHours:5,activityHours:5,activityCount:1,avgDescriptionLength:80,isLate:0,reviewedBy:'chef',reviewedAt:'2026-10-15 15:00:00',decisionMinutes:60},
  ],[],14,17,now);
  assert.equal(built.agents[0].qualityScore,100);
  assert.equal(built.agents[0].approved,1);
  assert.equal(built.matrix[0].days.length,14);
  assert.equal(built.matrix[0].days.at(-2).status,'approved');
});
