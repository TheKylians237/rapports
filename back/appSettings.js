const db = require('./db');
let ready;
async function ensureSettings() {
  if (!ready) ready = db.query(`CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_by VARCHAR(36) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`).then(async () => {
    const [columns] = await db.query(
      "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_settings' AND COLUMN_NAME='setting_value'"
    );
    if (columns[0]?.DATA_TYPE !== 'text') await db.query('ALTER TABLE app_settings MODIFY setting_value TEXT NOT NULL');
    await db.query(
      "INSERT IGNORE INTO app_settings(setting_key,setting_value) VALUES ('registration_open','1'),('registration_roles','{\"agent\":true,\"manager\":true,\"chef_service\":true}'),('internet_access_enabled','0'),('internet_allowlist_ips','[]'),('network_access_configured','0'),('network_access_enabled','0'),('network_access_allowlist','[]')"
    );
  }).catch(error => { ready = null; throw error; });
  return ready;
}
async function getRegistrationOpen() {
  await ensureSettings();
  const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key='registration_open'");
  return rows[0]?.setting_value === '1';
}
async function getRegistrationState() {
  await ensureSettings();
  const [rows] = await db.query("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('registration_open','registration_roles')");
  const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  const roles = { agent: false, manager: false, chef_service: false };
  let invalid = false;
  try {
    const configured = JSON.parse(settings.registration_roles || '{}');
    for (const role of Object.keys(roles)) roles[role] = configured[role] === true;
    invalid = !configured || typeof configured !== 'object' || Array.isArray(configured);
  } catch {
    invalid = true;
  }
  if (invalid) Object.keys(roles).forEach(role => { roles[role] = false; });
  return { enabled: settings.registration_open === '1', roles, invalid };
}
module.exports = { ensureSettings, getRegistrationOpen, getRegistrationState };
