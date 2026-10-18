'use strict';

const PERIODS = new Set(['day', 'week', 'month', 'quarter', 'year', 'custom']);

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function resolveDateRange(query, now = new Date()) {
  const period = String(query.period || 'month').trim().toLowerCase();
  if (!PERIODS.has(period)) return { error: 'Période invalide.' };
  if (period === 'custom') {
    const startDate = String(query.startDate || '').trim();
    const endDate = String(query.endDate || '').trim();
    if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
      return { error: 'Sélectionnez des dates valides et cohérentes.' };
    }
    return { period, startDate, endDate };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === 'month') start.setDate(1);
  if (period === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  if (period === 'year') start.setMonth(0, 1);
  return { period, startDate: dateKey(start), endDate: dateKey(now) };
}

function parseAgentIds(queryValue) {
  const values = Array.isArray(queryValue) ? queryValue : String(queryValue || '').split(',');
  return [...new Set(values.map(id => String(id).trim()).filter(Boolean))];
}

function selectAgents(departmentAgents, requestedIds) {
  if (!requestedIds.length) return departmentAgents;
  return departmentAgents.filter(agent => requestedIds.includes(String(agent.id)));
}

function emptyMetrics() {
  return {
    reportCount: 0, approvedReports: 0, pendingReports: 0, rejectedReports: 0,
    activitiesTotal: 0, completedActivities: 0, pendingActivities: 0,
    totalHours: 0, activeAgents: 0, selectedAgents: 0, completionRate: 0, approvalRate: 0,
  };
}

function normalizeMetrics(row = {}, selectedCount = 0) {
  const activitiesTotal = Number(row.activitiesTotal || 0);
  const reportCount = Number(row.reportCount || 0);
  const completedActivities = Number(row.completedActivities || 0);
  const approvedReports = Number(row.approvedReports || 0);
  return {
    reportCount,
    approvedReports,
    pendingReports: Number(row.pendingReports || 0),
    rejectedReports: Number(row.rejectedReports || 0),
    activitiesTotal,
    completedActivities,
    pendingActivities: Number(row.pendingActivities || 0),
    totalHours: Number(row.totalHours || 0),
    activeAgents: Number(row.activeAgents || 0),
    selectedAgents: selectedCount,
    completionRate: activitiesTotal ? Math.round((completedActivities / activitiesTotal) * 1000) / 10 : 0,
    approvalRate: reportCount ? Math.round((approvedReports / reportCount) * 1000) / 10 : 0,
  };
}

function synthesisScope(requestedIds, agents, department) {
  if (requestedIds.length === 1) return `l’agent ${agents[0]?.name || agents[0]?.username || ''}`.trim();
  if (requestedIds.length) return `le groupe de ${agents.length} agents sélectionnés`;
  return `l’ensemble des agents actifs du département ${department}`;
}

function displayDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}

function reportStatusSummary(metrics) {
  if (!metrics.reportCount) return 'Aucun rapport n’a été soumis sur la période ; le taux d’approbation n’est donc pas calculable.';
  const approved = metrics.approvedReports;
  const rejected = metrics.rejectedReports;
  return `${approved} rapport${approved === 1 ? ' a été' : 's ont été'} approuvé${approved === 1 ? '' : 's'}, ${metrics.pendingReports} ${metrics.pendingReports === 1 ? 'reste' : 'restent'} en attente de traitement et ${rejected} ${rejected === 1 ? 'a été rejeté' : 'ont été rejetés'}. Le taux d’approbation s’établit à ${metrics.approvalRate} % des rapports enregistrés sur la période.`;
}

function categorySummary(rows) {
  if (!rows.length) return 'Aucune catégorie n’est renseignée pour les activités recensées ; leur répartition thématique ne peut pas être établie à partir des données disponibles.';
  const details = rows.map(row => `${row.category} (${Number(row.total)} activité${Number(row.total) === 1 ? '' : 's'})`);
  return `Les catégories les plus représentées sont : ${details.join(' ; ')}. Ce classement décrit la répartition des activités saisies et aide à repérer les principaux domaines d’intervention.`;
}

function followUpSummary(metrics) {
  if (!metrics.pendingActivities && !metrics.pendingReports) {
    return 'À la date de cette consultation, aucune activité n’est signalée en attente et aucun rapport ne reste à traiter dans le périmètre retenu. Le bilan peut être utilisé comme état de situation pour la période, puis comparé aux périodes précédentes pour suivre l’évolution de la charge et de l’avancement.';
  }
  const pendingActivity = metrics.pendingActivities === 1 ? 'activité reste' : 'activités restent';
  const pendingReport = metrics.pendingReports === 1 ? 'rapport demeure' : 'rapports demeurent';
  return `Pour le suivi managérial, ${metrics.pendingActivities} ${pendingActivity} à achever et ${metrics.pendingReports} ${pendingReport} en attente de traitement. Ces éléments constituent les principaux points à examiner lors du prochain suivi, en tenant compte des échéances et des éventuelles observations consignées dans les rapports.`;
}

function emptyNarrative(startLabel, endLabel, scope) {
  return [
    `Périmètre et période : du ${startLabel} au ${endLabel}, l’analyse porte sur ${scope}. Aucun rapport ni aucune activité n’a été enregistré dans ce périmètre pendant la période considérée.`,
    'Lecture du bilan : en l’absence de données, il n’est pas possible de calculer un volume horaire, un taux d’achèvement ou un taux de traitement des rapports. Cette absence de résultats ne permet pas, à elle seule, de conclure à une absence de travail ; elle indique que le tableau ne dispose d’aucune saisie correspondant aux critères sélectionnés.',
    'Point de suivi : vérifiez que les agents concernés ont transmis leurs rapports et que les dates sélectionnées couvrent bien les journées à analyser. Élargissez la période ou le groupe d’agents si nécessaire, puis actualisez la synthèse.',
  ].join('\n\n');
}

function activeNarrative(metrics, rows, labels) {
  const pendingActivityRate = metrics.activitiesTotal
    ? Math.round((metrics.pendingActivities / metrics.activitiesTotal) * 1000) / 10 : 0;
  const reportSummary = reportStatusSummary(metrics);
  const categories = categorySummary(rows);
  const followUp = followUpSummary(metrics);
  const agentLabel = metrics.selectedAgents
    ? ` pour ${metrics.selectedAgents} agent${metrics.selectedAgents === 1 ? '' : 's'} dans le périmètre sélectionné` : '';
  const reportPlural = metrics.reportCount === 1 ? '' : 's';
  const activityPlural = metrics.activitiesTotal === 1 ? '' : 's';
  const completedVerb = metrics.completedActivities === 1 ? ' est' : 's sont';
  const completedEnding = metrics.completedActivities === 1 ? '' : 's';
  const pendingVerb = metrics.pendingActivities === 1 ? ' reste' : 's restent';
  const hours = `${metrics.totalHours.toFixed(1)} heure${metrics.totalHours === 1 ? '' : 's'}`;
  return [
    `Périmètre et période : du ${labels.start} au ${labels.end}, cette synthèse porte sur ${labels.scope}. Elle recense ${metrics.reportCount} rapport${reportPlural} et ${metrics.activitiesTotal} activité${activityPlural}${agentLabel}. Le temps déclaré représente un total de ${hours}. Ces indicateurs décrivent les saisies enregistrées dans l’application pour la période choisie.`,
    `Avancement des activités : ${metrics.completedActivities} activité${completedVerb} terminée${completedEnding}, soit ${metrics.completionRate} % des activités. ${metrics.pendingActivities} activité${pendingVerb} en attente, ce qui représente ${pendingActivityRate} %. Le taux d’achèvement rapporte les activités terminées au nombre total d’activités recensées ; il permet de lire l’état d’avancement sans confondre celui-ci avec l’approbation des rapports.`,
    `Traitement des rapports : ${reportSummary}`,
    `Répartition des travaux : ${categories}`,
    `Points de suivi : ${followUp}`,
  ].join('\n\n');
}

function buildNarrative(metrics, rows, scope, startDate, endDate) {
  const startLabel = displayDate(startDate);
  const endLabel = displayDate(endDate);
  if (!metrics.reportCount && !metrics.activitiesTotal) return emptyNarrative(startLabel, endLabel, scope);
  return activeNarrative(metrics, rows, { start: startLabel, end: endLabel, scope });
}

module.exports = {
  resolveDateRange, parseAgentIds, selectAgents, emptyMetrics,
  normalizeMetrics, synthesisScope, buildNarrative,
};
