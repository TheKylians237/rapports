const db = require('./db');

let ready;
async function ensureTable() {
  if (!ready) ready = db.query(`CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NULL,
    action VARCHAR(12) NOT NULL,
    route VARCHAR(160) NOT NULL,
    status_code SMALLINT UNSIGNED NOT NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_activity_user_time (user_id, created_at),
    KEY idx_activity_time (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(error => { ready = null; throw error; });
  return ready;
}

function middleware(req, res, next) {
  if (!req.path.startsWith('/api/auth/')) return next();
  res.on('finish', () => {
    ensureTable().then(() => db.query(
      'INSERT INTO activity_logs (user_id,action,route,status_code,ip_address,user_agent) VALUES (?,?,?,?,?,?)',
      [req.user?.id || null, req.method, req.path.slice(0, 160), res.statusCode, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 255)]
    )).catch(error => console.error('Échec journalisation activité:', error.message));
  });
  next();
}

async function getOwnHistory(req,res,next) {
  try {
    await ensureTable();
    const [rows]=await db.query(`SELECT id,action,route,status_code AS statusCode,ip_address AS ipAddress,created_at AS createdAt
      FROM activity_logs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 300`,[req.user.id]);
    return res.json({success:true,history:rows});
  } catch(error){next(error);}
}

module.exports = { middleware, ensureTable, getOwnHistory };
