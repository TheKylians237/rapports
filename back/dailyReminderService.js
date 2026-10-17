const db = require('./db');
const { createNotification } = require('./notificationsController');

function reminderHour() {
  const value = Number.parseInt(process.env.DAILY_REPORT_REMINDER_HOUR || '18', 10);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : 18;
}

async function dispatchDailyReportReminders(now = new Date()) {
  if (now.getHours() < reminderHour()) return { sent: 0, skipped: true };
  const [agents] = await db.query(
    `SELECT u.id
       FROM users u
      WHERE u.is_active=1 AND LOWER(TRIM(u.role))='agent'
        AND NOT EXISTS (SELECT 1 FROM daily_reports dr WHERE dr.user_id=u.id AND dr.report_date=CURDATE())
        AND NOT EXISTS (SELECT 1 FROM report_reminders rr WHERE rr.user_id=u.id AND rr.reminder_date=CURDATE())`
  );
  let sent = 0;
  for (const agent of agents) {
    const [result] = await db.query(
      'INSERT IGNORE INTO report_reminders (user_id, reminder_date) VALUES (?, CURDATE())', [agent.id]
    );
    if (!result.affectedRows) continue;
    const created = await createNotification(agent.id, {
      title: 'Rapport journalier en retard',
      body: 'Votre rapport du jour n’a pas encore été soumis. Ouvrez votre espace pour le compléter.',
      type: 'report_late',
      link: '/html/dashb_agent.html',
    });
    if (created) sent += 1;
  }
  return { sent, skipped: false };
}

module.exports = { dispatchDailyReportReminders, reminderHour };
