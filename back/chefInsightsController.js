const db = require('./db');
const notifications = require('./notificationsController');

const normalizedRole = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const dayKey = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const safeNumber = value => Number(value || 0);

function selectedDays(value) { return Number(value) === 14 ? 14 : 30; }
function isWorkday(date) { return date.getDay() !== 0 && date.getDay() !== 6; }
function expectedWorkdays(startDate, endDate) {
  let count = 0;
  const current = new Date(`${startDate}T12:00:00`), end = new Date(`${endDate}T12:00:00`);
  while (current <= end) { if (isWorkday(current)) count += 1; current.setDate(current.getDate() + 1); }
  return count;
}
function consecutiveMissed(datesWithReports, endDate, now = new Date()) {
  const cursor = new Date(`${endDate}T12:00:00`);
  const configuredHour=Number.parseInt(process.env.DAILY_REPORT_DEADLINE_HOUR||process.env.DAILY_REPORT_REMINDER_HOUR||'17',10);
  const deadlineHour=Number.isInteger(configuredHour)&&configuredHour>=0&&configuredHour<=23?configuredHour:17;
  if (dayKey(now) === endDate && now.getHours() < deadlineHour) cursor.setDate(cursor.getDate() - 1);
  const submitted = new Set(datesWithReports);
  let count = 0;
  while (cursor.getFullYear() > 2000) {
    const key = dayKey(cursor);
    if (isWorkday(cursor)) {
      if (submitted.has(key)) break;
      count += 1;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
function rejectionCategory(comment) {
  const value = String(comment || '').toLocaleLowerCase('fr');
  if (/\[motif\s*:\s*précision\]/i.test(value) || /précis|détaill|description/i.test(value)) return 'Précision du rapport';
  if (/\[motif\s*:\s*horaires\]/i.test(value) || /heure|durée|horaire/i.test(value)) return 'Horaires et durées';
  if (/\[motif\s*:\s*pièces/i.test(value) || /pièce|document|justificatif|fichier/i.test(value)) return 'Pièce justificative';
  if (/\[motif\s*:\s*procédure\]/i.test(value) || /procédure|conform/i.test(value)) return 'Procédure';
  return 'Autre motif';
}
function buildInsights(agents, reports, previousReports, days, deadlineHour = 17, now = new Date()) {
  const today = dayKey(now);
  const start = new Date(`${today}T12:00:00`); start.setDate(start.getDate() - days + 1);
  const startDate = dayKey(start);
  const dates = Array.from({length:14},(_,index)=>{const date=new Date(`${today}T12:00:00`);date.setDate(date.getDate()-13+index);return dayKey(date);});
  const dateRange = [];
  for (let i=0;i<days;i+=1) { const d=new Date(`${startDate}T12:00:00`);d.setDate(d.getDate()+i);dateRange.push(dayKey(d)); }
  const aggregate = (rows) => {
    const byUser=new Map();
    rows.forEach(row=>{
      const key=String(row.userId);
      if(!byUser.has(key))byUser.set(key,{reports:[],byDay:new Map()});
      const entry=byUser.get(key),date=dayKey(row.reportDate);
      entry.reports.push(row);
      const day=entry.byDay.get(date)||{reports:0,hours:0};day.reports+=1;day.hours+=safeNumber(row.totalHours);entry.byDay.set(date,day);
    });
    return byUser;
  };
  const current=aggregate(reports),previous=aggregate(previousReports);
  const allWeekdays=expectedWorkdays(startDate,today);
  const roster=agents.map(agent=>{
    const entry=current.get(String(agent.id))||{reports:[],byDay:new Map()};
    const prev=previous.get(String(agent.id))||{reports:[],byDay:new Map()};
    const rows=entry.reports, datesWithReports=[...entry.byDay.keys()];
    const activityCount=rows.reduce((sum,row)=>sum+safeNumber(row.activityCount),0);
    const activityHours=rows.reduce((sum,row)=>sum+safeNumber(row.activityHours),0);
    const totalHours=rows.reduce((sum,row)=>sum+safeNumber(row.totalHours),0);
    const approved=rows.filter(row=>['approved','validated','accepted'].includes(String(row.status).toLowerCase())).length;
    const rejected=rows.filter(row=>['rejected','refused'].includes(String(row.status).toLowerCase())).length;
    const pending=rows.filter(row=>['submitted','pending'].includes(String(row.status).toLowerCase())).length;
    const late=rows.filter(row=>Boolean(Number(row.isLate))).length;
    const avgLength=rows.length?rows.reduce((sum,row)=>sum+safeNumber(row.avgDescriptionLength)*safeNumber(row.activityCount),0)/Math.max(1,activityCount):0;
    const completeness=rows.length?100*rows.filter(row=>safeNumber(row.activityCount)>0).length/rows.length:0;
    const detailScore=Math.min(100,avgLength/80*100);
    const coherent=rows.filter(row=>safeNumber(row.totalHours)>0&&safeNumber(row.totalHours)<=24&&Math.abs(safeNumber(row.totalHours)-safeNumber(row.activityHours))<=0.6).length;
    const coherence=rows.length?100*coherent/rows.length:0;
    const qualityScore=Math.round(completeness*.4+detailScore*.3+coherence*.3);
    const workdays=allWeekdays;
    const participation=workdays?Math.min(100,Math.round(100*datesWithReports.filter(date=>{const d=new Date(`${date}T12:00:00`);return isWorkday(d);}).length/workdays)):0;
    const missingDays=consecutiveMissed(datesWithReports,today,now);
    const recent=rows.slice().sort((a,b)=>dayKey(b.reportDate).localeCompare(dayKey(a.reportDate)));
    const serialRejections=recent.slice(0,3).length===3&&recent.slice(0,3).every(row=>['rejected','refused'].includes(String(row.status).toLowerCase()));
    const previousCount=prev.reports.length,previousLate=prev.reports.filter(row=>Boolean(Number(row.isLate))).length;
    const lateRate=rows.length?late/rows.length:0,previousLateRate=previousCount?previousLate/previousCount:0;
    const drop=previousCount>=3&&rows.length<previousCount*.7;
    const reasons={};rows.filter(row=>['rejected','refused'].includes(String(row.status).toLowerCase())).forEach(row=>{const reason=rejectionCategory(row.reviewComment);reasons[reason]=(reasons[reason]||0)+1;});
    const dayReports=dates.map(day=>safeNumber(entry.byDay.get(day)?.reports));
    const dayHours=dates.map(day=>safeNumber(entry.byDay.get(day)?.hours));
    return {id:agent.id,name:agent.name,username:agent.username,jobTitle:agent.jobTitle,reportCount:rows.length,approved,rejected,pending,late,lateRate:Math.round(lateRate*1000)/10,totalHours:Math.round(totalHours*10)/10,activityCount,activityHours:Math.round(activityHours*10)/10,participationRate:participation,missedConsecutiveDays:missingDays,qualityScore,averageDescriptionLength:Math.round(avgLength),completionRate:rows.length?Math.round(1000*rows.filter(row=>safeNumber(row.activityCount)>0).length/rows.length)/10:0,approvalRate:rows.length?Math.round(1000*approved/rows.length)/10:0,firstPassRate:rows.length?Math.round(1000*approved/rows.length)/10:0,activityDrop:drop,lateTrendIncreasing:previousCount>=3&&lateRate>previousLateRate+.2,serialRejections,watch:drop||(previousCount>=3&&lateRate>previousLateRate+.2)||serialRejections||missingDays>=3,rejectionReasons:Object.entries(reasons).sort((a,b)=>b[1]-a[1]).map(([reason,count])=>({reason,count})),sparkReports:dayReports,sparkHours:dayHours,recentReports:recent.slice(0,10).map(row=>({id:row.id,date:dayKey(row.reportDate),status:row.status,submittedAt:row.submittedAt,decidedAt:row.reviewedAt,decisionComment:row.reviewComment,activityCount:safeNumber(row.activityCount),hours:safeNumber(row.totalHours)})),reportDates:datesWithReports};
  });
  const byDay=new Map(reports.map(row=>[`${row.userId}:${dayKey(row.reportDate)}`,row]));
  const matrix=agents.map(agent=>({agentId:agent.id,name:agent.name,days:dates.map(date=>{const row=byDay.get(`${agent.id}:${date}`);return {date,status:row?String(row.status||'submitted').toLowerCase():'absent',reportId:row?.id||null};})}));
  const overall={activeAgents:agents.length,reports:reports.length,approved:reports.filter(r=>['approved','validated','accepted'].includes(String(r.status).toLowerCase())).length,rejected:reports.filter(r=>['rejected','refused'].includes(String(r.status).toLowerCase())).length,pending:reports.filter(r=>['submitted','pending'].includes(String(r.status).toLowerCase())).length,late:reports.filter(r=>Boolean(Number(r.isLate))).length,totalHours:Math.round(reports.reduce((sum,row)=>sum+safeNumber(row.totalHours),0)*10)/10,activityCount:reports.reduce((sum,row)=>sum+safeNumber(row.activityCount),0),averageDecisionMinutes:0};
  const weekStart=new Date(`${today}T12:00:00`);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
  const weekStartKey=dayKey(weekStart);
  const todayReports=reports.filter(row=>dayKey(row.reportDate)===today),weekReports=reports.filter(row=>dayKey(row.reportDate)>=weekStartKey);
  const countStates=rows=>({reports:rows.length,pending:rows.filter(row=>['submitted','pending'].includes(String(row.status).toLowerCase())).length,approved:rows.filter(row=>['approved','validated','accepted'].includes(String(row.status).toLowerCase())).length,rejected:rows.filter(row=>['rejected','refused'].includes(String(row.status).toLowerCase())).length});
  overall.today=countStates(todayReports);overall.week=countStates(weekReports);
  overall.participationRate=agents.length?Math.round(1000*new Set(reports.map(row=>String(row.userId))).size/agents.length)/10:0;
  const decisionRows=reports.filter(row=>row.reviewedBy&&row.reviewedAt);
  if(decisionRows.length)overall.averageDecisionMinutes=Math.round(decisionRows.reduce((sum,row)=>sum+safeNumber(row.decisionMinutes),0)/decisionRows.length);
  const categories={};reports.filter(row=>['rejected','refused'].includes(String(row.status).toLowerCase())).forEach(row=>{const key=rejectionCategory(row.reviewComment);categories[key]=(categories[key]||0)+1;});
  return {days,startDate,endDate:today,deadlineHour,dates,matrix,agents:roster,overall,rejectionCategories:Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([category,count])=>({category,count})),watchCount:roster.filter(agent=>agent.watch).length};
}

async function currentChef(req) {
  const chefId=String(req.user?.delegatedPrincipalId||req.user?.id||'');
  const [rows]=await db.query('SELECT id,department,role,is_active AS isActive FROM users WHERE id=? LIMIT 1',[chefId]);
  const chef=rows[0];
  if(!chef||!chef.isActive||!chef.department||!['chef_service','chef_de_service','chef','manager'].includes(normalizedRole(chef.role)))return null;
  return {id:chef.id,department:chef.department};
}

async function getInsights(req,res,next) {
  try {
    const chef=await currentChef(req);
    if(!chef)return res.status(403).json({success:false,message:'Accès limité au chef actif de votre département.'});
    const days=selectedDays(req.query.days);
    const deadlineRaw=Number.parseInt(process.env.DAILY_REPORT_DEADLINE_HOUR||process.env.DAILY_REPORT_REMINDER_HOUR||'17',10);
    const deadlineHour=Number.isInteger(deadlineRaw)&&deadlineRaw>=0&&deadlineRaw<=23?deadlineRaw:17;
    const [agents]=await db.query(`SELECT id,last_name AS name,username,job_title AS jobTitle FROM users WHERE department=? AND is_active=1 AND LOWER(TRIM(role))='agent' ORDER BY last_name,username`,[chef.department]);
    const [reports]=await db.query(`SELECT dr.id,dr.user_id AS userId,dr.submitted_to AS submittedTo,dr.report_date AS reportDate,dr.status,dr.total_hours AS totalHours,dr.created_at AS submittedAt,dr.reviewed_at AS reviewedAt,dr.reviewed_by AS reviewedBy,dr.review_comment AS reviewComment,
        CASE WHEN DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?) THEN 1 ELSE 0 END AS isLate,
        COALESCE(a.activityCount,0) AS activityCount,COALESCE(a.hours,0) AS activityHours,COALESCE(a.avgDescriptionLength,0) AS avgDescriptionLength,
        CASE WHEN dr.reviewed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,dr.created_at,dr.reviewed_at) ELSE 0 END AS decisionMinutes
      FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci
      LEFT JOIN (SELECT daily_report_id,COUNT(*) AS activityCount,SUM(hours) AS hours,AVG(CHAR_LENGTH(TRIM(description))) AS avgDescriptionLength FROM report_activities WHERE LOWER(TRIM(status))<>'superseded' GROUP BY daily_report_id) a ON CONVERT(a.daily_report_id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.id USING utf8mb4) COLLATE utf8mb4_general_ci
      WHERE u.department=? AND LOWER(TRIM(u.role))='agent' AND dr.report_date BETWEEN DATE_SUB(CURDATE(),INTERVAL ? DAY) AND CURDATE() ORDER BY dr.report_date,dr.created_at`,[`${String(deadlineHour).padStart(2,'0')}:00:00`,chef.department,days-1]);
    const [previous]=await db.query(`SELECT dr.id,dr.user_id AS userId,dr.report_date AS reportDate,dr.status,dr.total_hours AS totalHours,
        CASE WHEN DATE(dr.created_at)>dr.report_date OR (DATE(dr.created_at)=dr.report_date AND TIME(dr.created_at)>?) THEN 1 ELSE 0 END AS isLate
      FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE u.department=? AND LOWER(TRIM(u.role))='agent'
       AND dr.report_date>=DATE_SUB(CURDATE(),INTERVAL ? DAY) AND dr.report_date<DATE_SUB(CURDATE(),INTERVAL ? DAY)`,[`${String(deadlineHour).padStart(2,'0')}:00:00`,chef.department,days*2,days-1]);
    const result=buildInsights(agents,reports,previous,days,deadlineHour);
    const [decisionStats]=await db.query(`SELECT COUNT(*) AS treated,COALESCE(ROUND(AVG(TIMESTAMPDIFF(MINUTE,created_at,reviewed_at))),0) AS averageMinutes FROM daily_reports WHERE reviewed_by=? AND reviewed_at>=DATE_SUB(NOW(),INTERVAL ? DAY)`,[chef.id,days]);
    const [backlogRows]=await db.query(`SELECT COUNT(*) AS backlog FROM daily_reports dr JOIN users u ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_general_ci=CONVERT(dr.user_id USING utf8mb4) COLLATE utf8mb4_general_ci WHERE u.department=? AND LOWER(TRIM(u.role))='agent' AND LOWER(TRIM(dr.status)) IN ('submitted','pending') AND (dr.submitted_to=? OR dr.submitted_to IS NULL)`,[chef.department,chef.id]);
    result.overall.approvedByChef=Number(decisionStats[0]?.treated||0);
    result.overall.pending=Number(backlogRows[0]?.backlog||0);
    result.overall.averageDecisionMinutes=Number(decisionStats[0]?.averageMinutes||0);
    result.overall.timeToApproveLabel=result.overall.averageDecisionMinutes?`${Math.floor(result.overall.averageDecisionMinutes/60)} h ${result.overall.averageDecisionMinutes%60} min`:'—';
    return res.json({success:true,department:chef.department,...result});
  }catch(error){return next(error);}
}

async function scopedAgent(req) {
  const chef=await currentChef(req);if(!chef)return {error:'Accès limité au chef actif de votre département.'};
  const [agents]=await db.query(`SELECT id,last_name AS name FROM users WHERE id=? AND department=? AND is_active=1 AND LOWER(TRIM(role))='agent' LIMIT 1`,[req.params.agentId,chef.department]);
  return agents.length?{chef,agent:agents[0]}:{error:'Agent actif introuvable dans votre département.'};
}

async function remindAgent(req,res,next) {
  try {
    const scoped=await scopedAgent(req);if(scoped.error)return res.status(404).json({success:false,message:scoped.error});
    const [sentToday]=await db.query("SELECT id FROM notifications WHERE user_id=? AND type='report_reminder' AND DATE(created_at)=CURDATE() LIMIT 1",[scoped.agent.id]);
    if(sentToday.length)return res.status(429).json({success:false,message:'Un rappel a déjà été envoyé à cet agent aujourd’hui.'});
    const sent=await notifications.createNotification(scoped.agent.id,{title:'Rappel de rapport',body:'Votre chef de service vous rappelle de transmettre votre rapport journalier.',type:'report_reminder',link:'/html/dashb_agent.html'});
    if(!sent)return res.status(503).json({success:false,message:'Le rappel n’a pas pu être enregistré.'});
    return res.json({success:true,message:`Rappel envoyé à ${scoped.agent.name}.`});
  }catch(error){return next(error);}
}

async function congratulateAgent(req,res,next) {
  try {
    const scoped=await scopedAgent(req);if(scoped.error)return res.status(404).json({success:false,message:scoped.error});
    const message=String(req.body?.message||'').trim();
    if(message.length<3||message.length>500)return res.status(400).json({success:false,message:'Le message doit contenir de 3 à 500 caractères.'});
    const sent=await notifications.createNotification(scoped.agent.id,{title:'Bravo !',body:message,type:'bravo',link:'/html/dashb_agent.html'});
    if(!sent)return res.status(503).json({success:false,message:'La félicitation n’a pas pu être envoyée.'});
    return res.status(201).json({success:true,message:'Félicitation envoyée à l’agent.'});
  }catch(error){return next(error);}
}

module.exports={getInsights,remindAgent,congratulateAgent,_test:{buildInsights,consecutiveMissed,rejectionCategory,expectedWorkdays}};
