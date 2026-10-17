const db = require('./db');
let ready;
async function ensureSettings() {
  if (!ready) ready = db.query(`CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    updated_by VARCHAR(36) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`).then(() => db.query(
    "INSERT IGNORE INTO app_settings(setting_key,setting_value) VALUES ('registration_open','1')"
  )).catch(error => { ready = null; throw error; });
  return ready;
}
async function getRegistrationOpen() {
  // Public registration status is read-only. Schema creation belongs to the
  // authenticated admin path or to the installation migration.
  const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key='registration_open'");
  return rows[0]?.setting_value === '1';
}
module.exports = { ensureSettings, getRegistrationOpen };
