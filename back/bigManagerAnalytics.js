const db = require('./db');

const LEADER_ROLE_SQL = "LOWER(REPLACE(REPLACE(TRIM(c.role), ' ', '_'), '-', '_'))";
const STATUS_SQL = 'LOWER(TRIM(dr.status))';

function isoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function dateWindow(query = {}, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const days = Math.min(365, Math.max(1, Number.parseInt(query.days, 10) || 30));
  const endDate = query.endDate || today;
  const end = new Date(`${endDate}T12:00:00`);
  end.setDate(end.getDate() - days + 1);
  const defaultStart = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  const startDate = query.startDate || defaultStart;
  if (!isoDate(startDate) || !isoDate(endDate) || startDate > endDate) return { error: 'La période sélectionnée est invalide.' };
  const span = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
  if (span > 366) return { error: 'La période ne peut pas dépasser 366 jours.' };
  return { startDate, endDate, span };
}

function cleanId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 64 ? id : '';
}

function expectedDeadline() {
  const parsed = Number.parseInt(process.env.DAILY_REPORT_DEADLINE_HOUR || process.env.DAILY_REPORT_REMINDER_HOUR || '17', 10);
  const hour = Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 17;
  return `${String(hour).padStart(2, '0')}:00:00`;
}

function reportScope(filters, alias = 'u', reportAlias = 'dr') {
  const conditions = [];
  const params = [];
  if (filters.departmentId) { conditions.push(`${alias}.department = ?`); params.push(filters.departmentId); }
  if (filters.agentId) { conditions.push(`${alias}.id = ? AND LOWER(TRIM(${alias}.role)) = 'agent'`); params.push(filters.agentId); }
  if (filters.managerId) { conditions.push(`${reportAlias}.submitted_to = ?`); params.push(filters.managerId); }
  if (filters.lateOnly) {
    conditions.push(`(DATE(${reportAlias}.created_at) > ${reportAlias}.report_date OR (DATE(${reportAlias}.created_at) = ${reportAlias}.report_date AND TIME(${reportAlias}.created_at) > ?))`);
    params.push(filters.deadline);
  }
  return { sql: conditions.length ? ` AND ${conditions.join(' AND ')}` : '', params };
}

function toNumber(value) { return Number(value || 0); }

exports.getDepartmentAnalytics = async (req, res, next) => {
  try {
    const window = dateWindow(req.query);
    if (window.error) return res.status(400).json({ success: false, message: window.error });
    const filters = {
      ...window,
      departmentId: cleanId(req.query.departmentId),
      managerId: cleanId(req.query.managerId),
      agentId: cleanId(req.query.agentId),
      lateOnly: String(req.query.lateOnly || '') === 'true',
    };
    const deadline = expectedDeadline();
    filters.deadline = deadline;
    const roleFilter = "LOWER(REPLACE(REPLACE(TRIM(u.role), ' ', '_'), '-', '_')) IN ('agent','manager','chef_service','chef_de_service','chef')";
    const deptJoinParams = [filters.startDate, filters.endDate];
    const deptWhereParams = [];
    let deptFilter = '';
    if (filters.departmentId) { deptFilter += ' AND u.department = ?'; deptWhereParams.push(filters.departmentId); }
    if (filters.agentId) { deptFilter += " AND u.id = ? AND LOWER(TRIM(u.role)) = 'agent'"; deptWhereParams.push(filters.agentId); }
    const reportJoinScope = reportScope(filters, 'u', 'dr');
    const [[departmentRows], [people], [leaders], [trend], [statusRows], [queue], [summaryRows], [previousRows]] = await Promise.all([
      db.query(`SELECT u.department AS departmentId, COALESCE(d.name, u.department, 'Sans département') AS departmentName,
          COUNT(DISTINCT u.id) AS headcount,
          COUNT(DISTINCT CASE WHEN LOWER(REPLACE(REPLACE(TRIM(u.role), ' ', '_'), '-', '_')) = 'agent' THEN u.id END) AS agents,
          COUNT(DISTINCT CASE WHEN LOWER(REPLACE(REPLACE(TRIM(u.role), ' ', '_'), '-', '_')) = 'manager' THEN u.id END) AS managers,
          COUNT(DISTINCT CASE WHEN LOWER(REPLACE(REPLACE(TRIM(u.role), ' ', '_'), '-', '_')) IN ('chef_service','chef_de_service','chef') THEN u.id END) AS chiefs,
          COUNT(DISTINCT dr.id) AS reportCount,
          COUNT(DISTINCT CASE WHEN LOWER(REPLACE(REPLACE(TRIM(u.role), ' ', '_'), '-', '_'))='agent' THEN dr.id END) AS agentReportCount,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('submitted','pending') THEN dr.id END) AS pending,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('approved','validated','accepted') THEN dr.id END) AS approved,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('rejected','refused') THEN dr.id END) AS rejected,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} = 'changes_requested' THEN dr.id END) AS changesRequested,
          COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL AND (DATE(dr.created_at) > dr.report_date OR (DATE(dr.created_at) = dr.report_date AND TIME(dr.created_at) > ?)) THEN dr.id END) AS late,
          COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL AND COALESCE(ra.activityCount, 0) > 0 THEN dr.id END) AS completeReports,
          COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL AND COALESCE(ra.activityCount, 0) = 0 THEN dr.id END) AS reportsWithoutActivity,
          COALESCE(SUM(dr.total_hours), 0) AS totalHours,
          COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL AND (dr.total_hours <= 0 OR dr.total_hours > 24) THEN dr.id END) AS incoherentReports,
          COALESCE(ROUND(AVG(CASE WHEN dr.reviewed_at IS NOT NULL AND dr.created_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, dr.created_at, dr.reviewed_at) END)), 0) AS averageDecisionMinutes
        FROM users u
        LEFT JOIN departments d ON CONVERT(d.id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(u.department USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN daily_reports dr ON CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci AND dr.report_date BETWEEN ? AND ?${reportJoinScope.sql}
        LEFT JOIN (SELECT daily_report_id, COUNT(*) AS activityCount FROM report_activities WHERE LOWER(TRIM(status)) <> 'superseded' GROUP BY daily_report_id) ra ON ra.daily_report_id = dr.id
        WHERE u.is_active = 1 AND ${roleFilter}${deptFilter}
        GROUP BY u.department, d.name ORDER BY departmentName`, [deadline, ...deptJoinParams, ...reportJoinScope.params, ...deptWhereParams]),
      db.query(`SELECT u.id, u.last_name AS fullName, u.username, u.role, u.department AS departmentId,
          COALESCE(d.name, u.department, 'Sans département') AS departmentName,
          GROUP_CONCAT(DISTINCT assigned.submitted_to) AS managerIds
        FROM users u LEFT JOIN departments d ON CONVERT(d.id USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(u.department USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN daily_reports assigned ON CONVERT(assigned.user_id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci AND assigned.report_date BETWEEN ? AND ?
        WHERE u.is_active = 1 AND ${roleFilter}${filters.departmentId ? ' AND u.department = ?' : ''}
        GROUP BY u.id,u.last_name,u.username,u.role,u.department,d.name
        ORDER BY departmentName, u.last_name, u.username`, [filters.startDate,filters.endDate,...(filters.departmentId ? [filters.departmentId] : [])]),
      db.query(`SELECT c.id AS managerId,c.last_name AS managerName,c.username,c.department AS departmentId,
          COALESCE(d.name,c.department,'Sans département') AS departmentName,
          SUM(CASE WHEN ${LEADER_ROLE_SQL} IN ('manager','chef_service','chef_de_service','chef') AND ${STATUS_SQL} IN ('submitted','pending') AND (dr.submitted_to=c.id OR dr.submitted_to IS NULL) THEN 1 ELSE 0 END) AS backlog,
          SUM(CASE WHEN CONVERT(dr.reviewed_by USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci AND dr.reviewed_at>=DATE_SUB(NOW(),INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS processed24h,
          SUM(CASE WHEN CONVERT(dr.reviewed_by USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci AND dr.reviewed_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS processed7d,
          SUM(CASE WHEN CONVERT(dr.reviewed_by USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci AND dr.reviewed_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS processed30d,
          COALESCE(ROUND(AVG(CASE WHEN CONVERT(dr.reviewed_by USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci AND dr.reviewed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,dr.created_at,dr.reviewed_at) END)),0) AS averageDecisionMinutes,
          MAX(CASE WHEN CONVERT(dr.reviewed_by USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci THEN dr.reviewed_at END) AS lastDecisionAt
        FROM users c LEFT JOIN departments d ON CONVERT(d.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.department USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN daily_reports dr ON (CONVERT(dr.submitted_to USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci OR (dr.submitted_to IS NULL AND dr.user_id IN (SELECT a.id FROM users a WHERE CONVERT(a.department USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(c.department USING utf8mb4) COLLATE utf8mb4_general_ci AND LOWER(TRIM(a.role))='agent')))
          AND dr.report_date BETWEEN ? AND ?
        WHERE c.is_active=1 AND ${LEADER_ROLE_SQL} IN ('manager','chef_service','chef_de_service','chef')${filters.departmentId ? ' AND c.department = ?' : ''}${filters.managerId ? ' AND c.id = ?' : ''}
        GROUP BY c.id,c.last_name,c.username,c.department,d.name ORDER BY backlog DESC,c.last_name`, [filters.startDate, filters.endDate, ...(filters.departmentId ? [filters.departmentId] : []), ...(filters.managerId ? [filters.managerId] : [])]),
      db.query(`SELECT dr.report_date AS reportDate,
          COUNT(DISTINCT dr.id) AS reports,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('submitted','pending') THEN dr.id END) AS pending,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('approved','validated','accepted') THEN dr.id END) AS approved,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('rejected','refused') THEN dr.id END) AS rejected,
          COUNT(DISTINCT CASE WHEN DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?) THEN dr.id END) AS late,
          COALESCE(ROUND(AVG(CASE WHEN dr.reviewed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,dr.created_at,dr.reviewed_at) END)),0) AS averageDecisionMinutes
        FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE dr.report_date BETWEEN ? AND ? AND ${roleFilter}${reportJoinScope.sql}
        GROUP BY dr.report_date ORDER BY dr.report_date`, [deadline, filters.startDate, filters.endDate, ...reportJoinScope.params]),
      db.query(`SELECT ${STATUS_SQL} AS status,COUNT(DISTINCT dr.id) AS total FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE dr.report_date BETWEEN ? AND ? AND ${roleFilter}${reportJoinScope.sql} GROUP BY ${STATUS_SQL}`,[filters.startDate,filters.endDate,...reportJoinScope.params]),
      db.query(`SELECT dr.id AS reportId,dr.report_date AS reportDate,dr.status,dr.created_at AS submittedAt,dr.total_hours AS totalHours,
          dr.general_comments AS comments,dr.review_comment AS decisionComment,dr.submitted_to AS managerId,
          u.id AS agentId,u.last_name AS agentName,u.username, u.department AS departmentId,COALESCE(d.name,u.department,'Sans département') AS departmentName,
          c.last_name AS managerName,c.username AS managerUsername,
          CASE WHEN DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?) THEN 1 ELSE 0 END AS isLate,
          CASE WHEN COALESCE(ra.activityCount,0)=0 THEN 1 ELSE 0 END AS hasNoActivity,
          COALESCE(ra.activityCount,0) AS activityCount,COALESCE(ra.hours,0) AS activityHours,
          CASE WHEN dr.created_at<DATE_SUB(NOW(),INTERVAL 24 HOUR) THEN 1 ELSE 0 END AS urgent
        FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN departments d ON CONVERT(d.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(u.department USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN users c ON CONVERT(c.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.submitted_to USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN (SELECT daily_report_id,COUNT(*) AS activityCount,SUM(hours) AS hours FROM report_activities WHERE LOWER(TRIM(status)) <> 'superseded' GROUP BY daily_report_id) ra ON ra.daily_report_id=dr.id
        WHERE dr.report_date BETWEEN ? AND ? AND ${roleFilter} AND ${STATUS_SQL} IN ('submitted','pending')${reportJoinScope.sql}
        ORDER BY urgent DESC,dr.created_at ASC LIMIT 500`, [deadline,filters.startDate,filters.endDate,...reportJoinScope.params]),
      db.query(`SELECT COUNT(DISTINCT dr.id) AS reportCount,
          COUNT(DISTINCT CASE WHEN LOWER(REPLACE(REPLACE(TRIM(u.role), ' ', '_'), '-', '_'))='agent' THEN dr.id END) AS agentReportCount,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('submitted','pending') THEN dr.id END) AS pending,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('approved','validated','accepted') THEN dr.id END) AS approved,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('rejected','refused') THEN dr.id END) AS rejected,
          COUNT(DISTINCT CASE WHEN ${STATUS_SQL}='changes_requested' THEN dr.id END) AS changesRequested,
          COUNT(DISTINCT CASE WHEN DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?) THEN dr.id END) AS late,
          COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL AND COALESCE(ra.activityCount,0)>0 THEN dr.id END) AS completeReports,
          COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL AND COALESCE(ra.activityCount,0)=0 THEN dr.id END) AS reportsWithoutActivity,
          COALESCE(SUM(dr.total_hours),0) AS totalHours,
          COUNT(DISTINCT CASE WHEN dr.total_hours<=0 OR dr.total_hours>24 THEN dr.id END) AS incoherentReports,
          COUNT(DISTINCT CASE WHEN dr.reviewed_at IS NOT NULL THEN dr.id END) AS decidedReports,
          COALESCE(ROUND(AVG(CASE WHEN dr.reviewed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,dr.created_at,dr.reviewed_at) END)),0) AS averageDecisionMinutes
        FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN (SELECT daily_report_id,COUNT(*) AS activityCount FROM report_activities WHERE LOWER(TRIM(status)) <> 'superseded' GROUP BY daily_report_id) ra ON ra.daily_report_id=dr.id
        WHERE dr.report_date BETWEEN ? AND ? AND ${roleFilter}${reportJoinScope.sql}${filters.lateOnly ? ` AND (DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?))` : ''}`,
        [deadline,filters.startDate,filters.endDate,...reportJoinScope.params,...(filters.lateOnly ? [deadline] : [])]),
      (() => {
        const priorStart = new Date(`${filters.startDate}T12:00:00`); priorStart.setDate(priorStart.getDate()-filters.span);
        const priorEnd = new Date(`${filters.startDate}T12:00:00`); priorEnd.setDate(priorEnd.getDate()-1);
        const asIso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        return db.query(`SELECT COUNT(DISTINCT dr.id) AS reportCount,COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('approved','validated','accepted') THEN dr.id END) AS approved,COUNT(DISTINCT CASE WHEN ${STATUS_SQL} IN ('rejected','refused') THEN dr.id END) AS rejected,COUNT(DISTINCT CASE WHEN DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?) THEN dr.id END) AS late
          FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE dr.report_date BETWEEN ? AND ? AND ${roleFilter}${reportJoinScope.sql}`,[deadline,asIso(priorStart),asIso(priorEnd),...reportJoinScope.params]);
      })(),
    ]);

    const summary = summaryRows[0] || {};
    const reportCount = toNumber(summary.reportCount);
    const pending = toNumber(summary.pending);
    const approved = toNumber(summary.approved);
    const rejected = toNumber(summary.rejected);
    const late = toNumber(summary.late);
    const previous = previousRows[0] || {};
    const departments = departmentRows.map(row => {
      const reports = toNumber(row.reportCount), approvedCount = toNumber(row.approved), rejectedCount = toNumber(row.rejected), lateCount = toNumber(row.late);
      const agentReports=toNumber(row.agentReportCount),expected=toNumber(row.agents)*window.span;
      return { ...row, headcount:toNumber(row.headcount),agents:toNumber(row.agents),managers:toNumber(row.managers),chiefs:toNumber(row.chiefs),reportCount:reports,agentReportCount:agentReports,pending:toNumber(row.pending),approved:approvedCount,rejected:rejectedCount,changesRequested:toNumber(row.changesRequested),late:lateCount,completeReports:toNumber(row.completeReports),reportsWithoutActivity:toNumber(row.reportsWithoutActivity),totalHours:toNumber(row.totalHours),incoherentReports:toNumber(row.incoherentReports),averageDecisionMinutes:toNumber(row.averageDecisionMinutes),submissionRate:expected?Math.round(1000*Math.min(agentReports,expected)/expected)/10:0,approvalRate:reports?Math.round(1000*approvedCount/reports)/10:0,rejectionRate:reports?Math.round(1000*rejectedCount/reports)/10:0,onTimeRate:reports?Math.round(1000*(reports-lateCount)/reports)/10:0,completenessRate:reports?Math.round(1000*toNumber(row.completeReports)/reports)/10:0 };
    });
    const totalUsers = people.length;
    const activeAgents=people.filter(person=>String(person.role||'').trim().toLowerCase()==='agent'&&(!filters.managerId||String(person.managerIds||'').split(',').includes(filters.managerId))).length;
    const dayLabel = (mins) => mins ? `${Math.floor(mins/60)} h ${mins%60} min` : 'aucun délai mesuré';
    const narrative = `Du ${new Date(`${filters.startDate}T12:00:00`).toLocaleDateString('fr-FR')} au ${new Date(`${filters.endDate}T12:00:00`).toLocaleDateString('fr-FR')}, ${reportCount} rapport(s) ont été enregistrés parmi ${totalUsers} utilisateur(s) actif(s) dans le périmètre. ${pending} restent à approuver, ${approved} sont approuvés et ${rejected} rejetés. ${late} rapport(s) dépassent l’échéance de ${deadline.slice(0,5)} (${reportCount ? Math.round(100*late/reportCount) : 0} %). ${toNumber(summary.reportsWithoutActivity)} rapport(s) ne contiennent aucune activité; ${toNumber(summary.incoherentReports)} ont un total d’heures incohérent. Le délai moyen de décision est de ${dayLabel(toNumber(summary.averageDecisionMinutes))}.`;
    const status = { pending:0,submitted:0,approved:0,rejected:0,changes_requested:0 };
    statusRows.forEach(row => { const key=String(row.status||'').toLowerCase(); if (key==='pending')status.pending+=toNumber(row.total);else if(key==='submitted')status.submitted+=toNumber(row.total);else if(['approved','validated','accepted'].includes(key))status.approved+=toNumber(row.total);else if(['rejected','refused'].includes(key))status.rejected+=toNumber(row.total);else if(key==='changes_requested')status.changes_requested+=toNumber(row.total); });
    const normalizedLeaders = leaders.map(row => ({ ...row, backlog:toNumber(row.backlog),processed24h:toNumber(row.processed24h),processed7d:toNumber(row.processed7d),processed30d:toNumber(row.processed30d),averageDecisionMinutes:toNumber(row.averageDecisionMinutes) }));
    const normalizedTrend = trend.map(row => ({ ...row, reports:toNumber(row.reports),pending:toNumber(row.pending),approved:toNumber(row.approved),rejected:toNumber(row.rejected),late:toNumber(row.late),averageDecisionMinutes:toNumber(row.averageDecisionMinutes) }));
    const totals = { reportCount,pending,approved,rejected,changesRequested:toNumber(summary.changesRequested),late,lateRate:reportCount?Math.round(1000*late/reportCount)/10:0,submissionRate:activeAgents?Math.round(1000*Math.min(toNumber(summary.agentReportCount),activeAgents*window.span)/(activeAgents*window.span))/10:0,approvalRate:reportCount?Math.round(1000*approved/reportCount)/10:0,rejectionRate:reportCount?Math.round(1000*rejected/reportCount)/10:0,completenessRate:reportCount?Math.round(1000*toNumber(summary.completeReports)/reportCount)/10:0,completeReports:toNumber(summary.completeReports),reportsWithoutActivity:toNumber(summary.reportsWithoutActivity),incoherentReports:toNumber(summary.incoherentReports),totalHours:toNumber(summary.totalHours),averageDecisionMinutes:toNumber(summary.averageDecisionMinutes),decidedReports:toNumber(summary.decidedReports),headcount:totalUsers,activeAgents,agentReportCount:toNumber(summary.agentReportCount) };
    const priorReportCount=toNumber(previous.reportCount);
    const comparison={priorStart: (()=>{const d=new Date(`${filters.startDate}T12:00:00`);d.setDate(d.getDate()-window.span);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})(),priorEnd:(()=>{const d=new Date(`${filters.startDate}T12:00:00`);d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})(),reportChange:priorReportCount?Math.round(100*(reportCount-priorReportCount)/priorReportCount):null,previousReports:priorReportCount,previousApproved:toNumber(previous.approved),previousRejected:toNumber(previous.rejected),previousLate:toNumber(previous.late)};
    const filteredQueue = queue.map(row => ({...row,isLate:Boolean(Number(row.isLate)),urgent:Boolean(Number(row.urgent)),activityCount:toNumber(row.activityCount),activityHours:toNumber(row.activityHours),totalHours:toNumber(row.totalHours)}));
    return res.json({success:true,startDate:filters.startDate,endDate:filters.endDate,days:window.span,deadline:deadline.slice(0,5),filters:{departmentId:filters.departmentId,managerId:filters.managerId,agentId:filters.agentId,lateOnly:filters.lateOnly},summary:totals,departments,people,leaders:normalizedLeaders,trend:normalizedTrend,status,narrative,comparison,approvalQueue:filteredQueue});
  } catch (error) { return next(error); }
};

exports._test = { dateWindow, expectedDeadline, isoDate };
