const db = require('./db');
const { transporter } = require('./mailer');

function previousPeriod(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { period:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`, start:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`, end:new Date(date.getFullYear(),date.getMonth()+1,0).toISOString().slice(0,10) };
}

async function sendMonthlySummary(now = new Date()) {
  if (now.getDate() !== 1 || now.getHours() < Number(process.env.MONTHLY_SUMMARY_HOUR || 8)) return {skipped:true};
  const {period,start,end}=previousPeriod(now);
  const [reserved]=await db.query('INSERT IGNORE INTO monthly_summary_runs(period,recipient_count) VALUES(?,0)',[period]);
  if (!reserved.affectedRows) return {skipped:true,period};
  try {
    const [[summary]] = await db.query(`SELECT COUNT(DISTINCT dr.id) AS reports,COUNT(DISTINCT dr.user_id) AS contributors,
      COALESCE(SUM(dr.total_hours),0) AS hours,SUM(DATE(dr.created_at)=dr.report_date) AS punctual
      FROM daily_reports dr WHERE dr.report_date BETWEEN ? AND ?`,[start,end]);
    const [[departmentCount]] = await db.query('SELECT COUNT(DISTINCT department) AS total FROM users WHERE is_active=1',[ ]);
    const [[rate]] = await db.query(`SELECT ROUND(100*SUM(DATE(created_at)=report_date)/NULLIF(COUNT(*),0),1) AS onTimeRate FROM daily_reports WHERE report_date BETWEEN ? AND ?`,[start,end]);
    const [recipients] = await db.query("SELECT email,last_name FROM users WHERE is_active=1 AND LOWER(TRIM(role))='big_manager' AND email IS NOT NULL AND email<>''");
    if (!recipients.length) throw new Error('Aucun big manager avec une adresse e-mail active.');
    const text=`Synthèse mensuelle ${period}\nRapports soumis : ${summary.reports||0}\nContributeurs : ${summary.contributors||0}\nHeures déclarées : ${Number(summary.hours||0).toFixed(1)}\nPonctualité : ${rate.onTimeRate ?? 0}%\nServices actifs : ${departmentCount.total||0}`;
    const html=`<h1>Synthèse mensuelle — ${period}</h1><ul><li>Rapports soumis : <strong>${Number(summary.reports||0)}</strong></li><li>Contributeurs : <strong>${Number(summary.contributors||0)}</strong></li><li>Heures déclarées : <strong>${Number(summary.hours||0).toFixed(1)}</strong></li><li>Taux de ponctualité : <strong>${Number(rate.onTimeRate||0)}%</strong></li><li>Services actifs : <strong>${Number(departmentCount.total||0)}</strong></li></ul>`;
    await transporter.sendMail({from:process.env.MAIL_FROM||process.env.MAIL_USER,to:recipients.map(row=>row.email).join(','),subject:`Rapports journaliers · Synthèse ${period}`,text,html});
    await db.query('UPDATE monthly_summary_runs SET recipient_count=? WHERE period=?',[recipients.length,period]);
    return {sent:recipients.length,period};
  } catch(error) {
    await db.query('DELETE FROM monthly_summary_runs WHERE period=?',[period]);
    throw error;
  }
}

module.exports={sendMonthlySummary,previousPeriod};
