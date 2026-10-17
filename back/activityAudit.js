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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`).catch(error => { ready = null; throw error; });
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

async function exportOwnData(req, res, next) {
  try {
    await ensureTable();
    const userId = req.user.id;
    const [[profile]] = await db.query(
      `SELECT id, last_name, username, email, phone, role, department, job_title, bio, avatar_url, created_at
         FROM users WHERE id=? LIMIT 1`, [userId]
    );
    const [reports] = await db.query(
      `SELECT id, report_date, total_hours, status, review_comment, next_day_targets, general_comments, created_at, updated_at
         FROM daily_reports WHERE user_id=? ORDER BY report_date DESC`, [userId]
    );
    const [activities] = await db.query(
      `SELECT ra.id, ra.daily_report_id AS reportId, ra.description, ra.objectives, ra.category, ra.status,
              ra.obsevations AS observations, ra.hours, ra.created_at AS createdAt
         FROM report_activities ra JOIN daily_reports dr ON dr.id=ra.daily_report_id
        WHERE dr.user_id=? ORDER BY dr.report_date DESC, ra.id`, [userId]
    );
    const [proposals] = await db.query(
      `SELECT ri.id, ri.report_id AS reportId, ri.activity_id AS activityId, ri.issue_description,
              ri.proposed_solution, ri.needs_manager_help, ri.status, ri.review_comment, ri.created_at
         FROM report_issues ri JOIN daily_reports dr ON dr.id=ri.report_id
        WHERE dr.user_id=? ORDER BY ri.created_at DESC`, [userId]
    );
    const [evaluations] = await db.query(
      `SELECT evaluation_date AS date, rating, comment, created_at AS createdAt
         FROM agent_evaluations WHERE agent_id=? ORDER BY evaluation_date DESC`, [userId]
    );
    const [history] = await db.query(
      `SELECT action, route, status_code AS statusCode, ip_address AS ipAddress, created_at AS createdAt
         FROM activity_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 1000`, [userId]
    );
    const exportDate = new Date().toISOString();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rapports-donnees-${exportDate.slice(0, 10)}.json"`);
    return res.json({ exportedAt: exportDate, profile, reports, activities, proposals, evaluations, history });
  } catch (error) { return next(error); }
}

module.exports = { middleware, ensureTable, getOwnHistory, exportOwnData };
