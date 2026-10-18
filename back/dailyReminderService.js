const db = require('./db');
const { createNotification } = require('./notificationsController');

function reminderHour() {
  const value = Number.parseInt(process.env.DAILY_REPORT_DEADLINE_HOUR || process.env.DAILY_REPORT_REMINDER_HOUR || '17', 10);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : 17;
}

async function dispatchDailyReportReminders(now = new Date()) {
  if (now.getHours() < reminderHour()) return { sent: 0, skipped: true };
  const [agents] = await db.query(
    `SELECT u.id,u.department
       FROM users u
      WHERE u.is_active=1 AND LOWER(TRIM(u.role))='agent'
        AND NOT EXISTS (SELECT 1 FROM daily_reports dr WHERE CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci AND dr.report_date=CURDATE())
        AND NOT EXISTS (SELECT 1 FROM report_reminders rr WHERE CONVERT(rr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci AND rr.reminder_date=CURDATE())`
  );
  let sent = 0;
  const missedByDepartment = new Map();
  for (const agent of agents) {
    const [result] = await db.query(
      'INSERT IGNORE INTO report_reminders (user_id, reminder_date) VALUES (?, CURDATE())', [agent.id]
    );
    if (!result.affectedRows) continue;
    const department = String(agent.department || '');
    if (department) missedByDepartment.set(department, (missedByDepartment.get(department) || 0) + 1);
    const created = await createNotification(agent.id, {
      title: 'Rapport journalier en retard',
      body: 'Votre rapport du jour n’a pas encore été soumis. Ouvrez votre espace pour le compléter.',
      type: 'report_late',
      link: '/html/dashb_agent.html',
    });
    if (created) sent += 1;
  }
  let chiefsNotified = 0;
  if (missedByDepartment.size) {
    const departments = [...missedByDepartment.keys()];
    const [chiefs] = await db.query(
      `SELECT id,department,role FROM users WHERE is_active=1 AND department IN (?)
        AND LOWER(REPLACE(REPLACE(TRIM(role),' ','_'),'-','_')) IN ('chef_service','chef_de_service','chef','manager')
        ORDER BY department,CASE LOWER(REPLACE(REPLACE(TRIM(role),' ','_'),'-','_')) WHEN 'chef_service' THEN 0 WHEN 'chef_de_service' THEN 1 WHEN 'chef' THEN 2 ELSE 3 END,last_name,username`,
      [departments],
    );
    const selected = new Map();
    chiefs.forEach(chief => { if (!selected.has(String(chief.department))) selected.set(String(chief.department), chief); });
    for (const [department, count] of missedByDepartment) {
      const chief = selected.get(department);
      if (!chief) continue;
      const [result] = await db.query('INSERT IGNORE INTO report_reminders (user_id,reminder_date) VALUES (?,CURDATE())',[chief.id]);
      if (!result.affectedRows) continue;
      if (await createNotification(chief.id, {
        title: 'Rapports manquants dans votre service',
        body: `${count} agent(s) de votre département n’ont pas encore transmis leur rapport aujourd’hui.`,
        type: 'team_report_backlog',
        link: '/html/chef_service_dashboard.html',
      })) chiefsNotified += 1;
    }
  }
  let staleIssueReminders = 0;
  const [staleIssues] = await db.query(
    `SELECT dr.user_id AS userId,COUNT(*) AS issueCount
       FROM report_issues ri JOIN daily_reports dr ON CONVERT(dr.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(ri.report_id USING utf8mb4) COLLATE utf8mb4_general_ci
      WHERE LOWER(TRIM(ri.status)) IN ('pending','open','in_progress')
        AND ri.created_at<DATE_SUB(NOW(),INTERVAL 7 DAY)
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE CONVERT(n.user_id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci AND n.type='issue_stale' AND n.created_at>=CURDATE())
      GROUP BY dr.user_id LIMIT 500`
  );
  for (const item of staleIssues) {
    if (await createNotification(item.userId, {
      title: 'Proposition toujours en attente',
      body: `${Number(item.issueCount)} proposition(s) attend(ent) un retour depuis plus de sept jours. Vous pouvez consulter leur état depuis votre tableau de bord.`,
      type: 'issue_stale',
      link: '/html/dashb_agent.html',
    })) staleIssueReminders += 1;
  }
  return { sent, chiefsNotified, staleIssueReminders, skipped: false };
}

module.exports = { dispatchDailyReportReminders, reminderHour };
