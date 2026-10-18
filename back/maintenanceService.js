const db = require('./db');
const activityAudit = require('./activityAudit');
const activityLogArchiveService = require('./activityLogArchiveService');

let lastDailyRun = '';

function retentionDays() {
  const configured = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '365', 10);
  return Number.isInteger(configured) && configured >= 30 && configured <= 36500 ? configured : 365;
}

async function purgeExpiredSecrets() {
  await db.query('DELETE FROM password_resets WHERE expires_at <= NOW()');
  await db.query('UPDATE users SET two_factor_code=NULL, two_factor_expires=NULL WHERE two_factor_expires <= NOW()');
  await db.query('DELETE FROM user_sessions WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY) OR revoked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)');
}

async function purgeOldAuditLogs() {
  const days = retentionDays();
  await activityAudit.ensureTable();
  // L’archive hebdomadaire doit réussir avant toute purge de journaux.
  await activityLogArchiveService.archivePendingWeeks();
  await db.query(`DELETE FROM activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)`);
  const [[table]] = await db.query(
    `SELECT COUNT(*) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_audit_logs'`
  );
  if (Number(table.found)) {
    await db.query(`DELETE FROM admin_audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)`);
  }
}

async function runDailyMaintenance(now = new Date()) {
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (now.getHours() < 3 || lastDailyRun === dateKey) return { skipped: true };
  await purgeExpiredSecrets();
  await purgeOldAuditLogs();
  lastDailyRun = dateKey;
  return { skipped: false, retentionDays: retentionDays() };
}

module.exports = { runDailyMaintenance, purgeExpiredSecrets, purgeOldAuditLogs, retentionDays };
