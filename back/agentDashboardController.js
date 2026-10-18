const db = require('./db');

const dayKey=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
const number=value=>Number(value||0);
const isoToday=(now=new Date())=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
const workday=date=>date.getDay()!==0&&date.getDay()!==6;

function consecutiveReportStreak(reports, now=new Date()) {
  const present=new Set(reports.map(row=>dayKey(row.reportDate)));
  const current=new Date(`${isoToday(now)}T12:00:00`);
  const deadline=Number.parseInt(process.env.DAILY_REPORT_DEADLINE_HOUR||process.env.DAILY_REPORT_REMINDER_HOUR||'17',10);
  if(now.getHours()<(Number.isInteger(deadline)?deadline:17))current.setDate(current.getDate()-1);
  let streak=0;
  for(let i=0;i<370;i+=1){
    if(workday(current)){if(!present.has(dayKey(current)))break;streak+=1;}
    current.setDate(current.getDate()-1);
  }
  return streak;
}

function bestReportStreak(reports, monthStart, endDate) {
  const present=new Set(reports.map(row=>dayKey(row.reportDate)));
  const cursor=new Date(`${monthStart}T12:00:00`),end=new Date(`${endDate}T12:00:00`);
  let current=0,best=0;
  while(cursor<=end){
    if(workday(cursor)){if(present.has(dayKey(cursor))){current+=1;best=Math.max(best,current);}else current=0;}
    cursor.setDate(cursor.getDate()+1);
  }
  return best;
}

function scoreReport(report) {
  if(!report)return 0;
  const complete=number(report.activityCount)>0?40:0;
  const detail=Math.min(30,number(report.averageDescriptionLength)/80*30);
  const coherent=number(report.totalHours)>0&&number(report.totalHours)<=24&&Math.abs(number(report.totalHours)-number(report.activityHours))<=.6?30:0;
  return Math.round(complete+detail+coherent);
}

async function getAgentDashboardInsights(req,res,next){
  try{
    const userId=String(req.user?.id||'');
    if(!userId)return res.status(401).json({success:false,message:'Session utilisateur invalide.'});
    const [userRows]=await db.query("SELECT id,department FROM users WHERE id=? AND is_active=1 AND LOWER(TRIM(role))='agent' LIMIT 1",[userId]);
    if(!userRows.length)return res.status(403).json({success:false,message:'Cette vue est réservée aux agents actifs.'});
    const today=isoToday();
    const [reportRows]=await db.query(`SELECT dr.id,dr.report_date AS reportDate,dr.status,dr.report_hours AS reportHours,dr.total_hours AS totalHours,dr.created_at AS submittedAt,dr.reviewed_at AS reviewedAt,dr.review_comment AS reviewComment,dr.general_comments AS generalComments,
       COALESCE(a.activityCount,0) AS activityCount,COALESCE(a.activityHours,0) AS activityHours,COALESCE(a.avgDescriptionLength,0) AS averageDescriptionLength
      FROM daily_reports dr LEFT JOIN (SELECT daily_report_id,COUNT(*) AS activityCount,SUM(hours) AS activityHours,AVG(CHAR_LENGTH(TRIM(description))) AS avgDescriptionLength FROM report_activities WHERE LOWER(TRIM(status))<>'superseded' GROUP BY daily_report_id) a ON CONVERT(a.daily_report_id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.id USING utf8mb4) COLLATE utf8mb4_general_ci
      WHERE dr.user_id=? AND dr.report_date>=DATE_SUB(CURDATE(),INTERVAL 89 DAY) ORDER BY dr.report_date DESC,dr.created_at DESC`,[userId]);
    const [historyTables]=await db.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='report_status_history'");
    const historyAvailable=historyTables.length>0;
    const [history]=historyTables.length?await db.query(`SELECT h.report_id AS reportId,h.previous_status AS previousStatus,h.new_status AS newStatus,h.comment,h.created_at AS createdAt,actor.last_name AS actorName
      FROM report_status_history h JOIN daily_reports dr ON CONVERT(dr.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(h.report_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN users actor ON CONVERT(actor.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(h.actor_id USING utf8mb4) COLLATE utf8mb4_general_ci
      WHERE dr.user_id=? AND dr.report_date>=DATE_SUB(CURDATE(),INTERVAL 89 DAY) ORDER BY h.created_at DESC LIMIT 500`,[userId]):[[]];
    const [activities]=await db.query(`SELECT ra.category,COUNT(*) AS activityCount,COALESCE(SUM(ra.hours),0) AS hours FROM report_activities ra JOIN daily_reports dr ON CONVERT(dr.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(ra.daily_report_id USING utf8mb4) COLLATE utf8mb4_general_ci
      WHERE dr.user_id=? AND dr.report_date>=DATE_FORMAT(CURDATE(),'%Y-%m-01') AND LOWER(TRIM(ra.status))<>'superseded' GROUP BY ra.category ORDER BY activityCount DESC,ra.category LIMIT 10`,[userId]);
    const [ratings]=await db.query(`SELECT evaluation_date AS evaluationDate,rating,comment FROM notation WHERE agent_id=? AND evaluation_date>=DATE_SUB(CURDATE(),INTERVAL 179 DAY) ORDER BY evaluation_date,updated_at`,[userId]);
    const [proposals]=await db.query(`SELECT ri.id,ri.issue_description AS description,ri.proposed_solution AS proposedSolution,ri.status,ri.review_comment AS reviewComment,ri.created_at AS createdAt,ri.reviewed_at AS reviewedAt,ra.description AS activityDescription,dr.report_date AS reportDate
      FROM report_issues ri JOIN daily_reports dr ON CONVERT(dr.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(ri.report_id USING utf8mb4) COLLATE utf8mb4_general_ci LEFT JOIN report_activities ra ON CONVERT(ra.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(ri.activity_id USING utf8mb4) COLLATE utf8mb4_general_ci
      WHERE dr.user_id=? ORDER BY ri.created_at DESC LIMIT 100`,[userId]);
    const [praiseRows]=await db.query("SELECT COUNT(*) AS total FROM notifications WHERE user_id=? AND type='bravo' AND created_at>=DATE_FORMAT(CURDATE(),'%Y-%m-01')",[userId]);
    const current=reportRows.find(row=>dayKey(row.reportDate)===today)||null;
    const currentHistory=current?history.filter(row=>String(row.reportId)===String(current.id)).slice().reverse():[];
    const currentMonth=reportRows.filter(row=>dayKey(row.reportDate).slice(0,7)===today.slice(0,7));
    const currentMonthRatings=ratings.filter(row=>dayKey(row.evaluationDate).slice(0,7)===today.slice(0,7));
    const monthHours=currentMonth.reduce((sum,row)=>sum+number(row.totalHours),0);
    const approvedCurrentMonth=currentMonth.filter(row=>['approved','validated','accepted'].includes(String(row.status).toLowerCase())).length;
    const firstPassCount=currentMonth.filter(row=>['approved','validated','accepted'].includes(String(row.status).toLowerCase())&&!history.some(item=>String(item.reportId)===String(row.id)&&['rejected','changes_requested'].includes(String(item.newStatus).toLowerCase()))).length;
    const approvedReports=currentMonth.filter(row=>['approved','validated','accepted'].includes(String(row.status).toLowerCase())).length;
    const topCategory=activities[0]||null;
    const openProposals=proposals.filter(row=>['pending','open','in_progress'].includes(String(row.status||'').toLowerCase()));
    const staleProposals=openProposals.filter(row=>Date.now()-new Date(row.createdAt).getTime()>7*86400000);
    const since=new Date(`${today}T12:00:00`);since.setDate(since.getDate()-34);
    const calendarStart=dayKey(since);
    const calendar=reportRows.filter(row=>dayKey(row.reportDate)>=calendarStart).map(row=>({date:dayKey(row.reportDate),status:row.status,reportId:row.id}));
    const quality=current?scoreReport(current):0;
    const bestStreak=bestReportStreak(currentMonth,`${today.slice(0,7)}-01`,today);
    const monthPraise=number(praiseRows[0]?.total);
    const totalMonthRating=currentMonthRatings.length?Math.round(currentMonthRatings.reduce((sum,row)=>sum+number(row.rating),0)/currentMonthRatings.length*10)/10:null;
    return res.json({success:true,today:today,report:current?{id:current.id,status:current.status,reportHours:current.reportHours,totalHours:number(current.totalHours),activityCount:number(current.activityCount),activityHours:number(current.activityHours),submittedAt:current.submittedAt,reviewedAt:current.reviewedAt,reviewComment:current.reviewComment,qualityScore:quality}:null,
      timeline:currentHistory,historyAvailable,calendar,month:{reports:currentMonth.length,totalHours:Math.round(monthHours*10)/10,approved:approvedCurrentMonth,firstPassRate:historyAvailable&&approvedReports?Math.round(1000*firstPassCount/approvedReports)/10:null,topCategory:topCategory?{name:topCategory.category,count:number(topCategory.activityCount)}:null,bestStreak,averageRating:totalMonthRating,praiseCount:monthPraise},
      qualityScore:quality,proposals:proposals.map(row=>({...row,stale:Date.now()-new Date(row.createdAt).getTime()>7*86400000})),openProposals:openProposals.length,staleProposals:staleProposals.length,ratings:ratings.map(row=>({date:dayKey(row.evaluationDate),rating:number(row.rating)})),departmentId:userRows[0].department});
  }catch(error){return next(error);}
}

module.exports={getAgentDashboardInsights,_test:{consecutiveReportStreak,bestReportStreak,scoreReport}};
