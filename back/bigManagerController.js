const crypto = require('crypto');
const db = require('./db');

let reviewsReady;
async function ensureReviewsTable(){
  if(!reviewsReady)reviewsReady=db.query(`CREATE TABLE IF NOT EXISTS big_manager_reviews(
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    target_user_id VARCHAR(36) NOT NULL,
    reviewer_id VARCHAR(36) NOT NULL,
    review_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_big_review_target_time(target_user_id,created_at),
    KEY idx_big_review_reviewer_time(reviewer_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`).catch(error=>{reviewsReady=null;throw error;});
  return reviewsReady;
}

exports.getOverview = async (req,res,next) => {
  try {
    const [rows] = await db.query(`SELECT dr.id AS reportId,dr.report_date AS date,dr.status AS reportStatus,
      u.id AS userId,u.last_name AS fullName,u.username,u.role,u.department,
      ra.id AS activityId,ra.description,ra.category,ra.hours,ra.status AS activityStatus
      FROM daily_reports dr JOIN users u ON u.id=dr.user_id
      LEFT JOIN report_activities ra ON ra.daily_report_id=dr.id
      WHERE LOWER(TRIM(u.role)) IN ('agent','manager','chef_service','chef_de_service','chef')
      ORDER BY dr.report_date DESC,dr.created_at DESC,ra.id DESC LIMIT 1000`);
    const [ratings] = await db.query(`SELECT n.id,n.agent_id AS managerId,n.evaluation_date AS date,n.rating,n.comment,
      target.last_name AS managerName,target.username AS managerUsername,reviewer.last_name AS reviewerName
      FROM notation n JOIN users target ON target.id=n.agent_id JOIN users reviewer ON reviewer.id=n.manager_id
      WHERE LOWER(TRIM(target.role))='manager'
      ORDER BY n.evaluation_date DESC,n.updated_at DESC LIMIT 1000`);
    const [managers] = await db.query("SELECT id,last_name AS fullName,username,department FROM users WHERE is_active=1 AND LOWER(TRIM(role))='manager' ORDER BY last_name");
    const [people] = await db.query("SELECT id,last_name AS fullName,username,role,department FROM users WHERE is_active=1 AND LOWER(TRIM(role)) IN ('agent','manager','chef_service','chef_de_service','chef') ORDER BY last_name");
    await ensureReviewsTable();
    const [reviews] = await db.query(`SELECT r.id,r.review_text AS reviewText,r.created_at AS createdAt,
      target.id AS targetId,target.last_name AS targetName,target.username AS targetUsername,target.role AS targetRole,
      author.last_name AS reviewerName FROM big_manager_reviews r JOIN users target ON target.id=r.target_user_id
      JOIN users author ON author.id=r.reviewer_id ORDER BY r.created_at DESC,r.id DESC LIMIT 500`);
    return res.json({success:true,activities:rows,ratings,managers,people,reviews});
  } catch(error){next(error);}
};

exports.getAgentDetails = async (req,res,next) => {
  try {
    const agentId=String(req.params.agentId||'').trim();
    const parsedDays=Number.parseInt(req.query.days,10);
    const days=Number.isInteger(parsedDays)?Math.min(3650,Math.max(1,parsedDays)):30;
    const start=new Date();
    start.setHours(0,0,0,0);
    start.setDate(start.getDate()-(days-1));
    const startDate=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
    const [profiles]=await db.query(`SELECT u.id,u.last_name AS fullName,u.username,u.email,u.phone,u.role,
      COALESCE(r.name,u.role) AS roleName,u.department,COALESCE(d.name,u.department) AS departmentName,
      u.job_title AS jobTitle,u.bio,u.avatar_url AS avatarUrl,u.is_active AS isActive,
      u.created_at AS createdAt,u.updated_at AS updatedAt
      FROM users u LEFT JOIN roles r ON r.id=u.role LEFT JOIN departments d ON d.id=u.department
      WHERE u.id=? AND u.is_active=1 AND LOWER(TRIM(u.role))='agent' LIMIT 1`,[agentId]);
    if(!profiles.length)return res.status(404).json({success:false,message:'Agent actif introuvable.'});
    const profile=profiles[0];
    const [summaryRows]=await db.query(`SELECT COUNT(DISTINCT dr.id) AS reportCount,
      COUNT(ra.id) AS activityCount,
      SUM(CASE WHEN LOWER(TRIM(ra.status))='completed' THEN 1 ELSE 0 END) AS completedActivities,
      SUM(CASE WHEN LOWER(TRIM(ra.status)) IN ('pending','in_progress') THEN 1 ELSE 0 END) AS pendingActivities,
      COALESCE(SUM(ra.hours),0) AS totalHours,
      COUNT(DISTINCT CASE WHEN LOWER(TRIM(dr.status)) IN ('approved','validated','accepted') THEN dr.id END) AS approvedReports,
      COUNT(DISTINCT CASE WHEN LOWER(TRIM(dr.status)) IN ('submitted','pending') THEN dr.id END) AS pendingReports,
      COUNT(DISTINCT CASE WHEN LOWER(TRIM(dr.status)) IN ('rejected','refused') THEN dr.id END) AS rejectedReports
      FROM daily_reports dr LEFT JOIN report_activities ra ON ra.daily_report_id=dr.id
      WHERE dr.user_id=? AND dr.report_date>=?`,[agentId,startDate]);
    const summary=summaryRows[0]||{};
    for(const key of ['reportCount','activityCount','completedActivities','pendingActivities','approvedReports','pendingReports','rejectedReports'])summary[key]=Number(summary[key]||0);
    summary.totalHours=Number(summary.totalHours||0);
    summary.completionRate=summary.activityCount?Math.round(summary.completedActivities*1000/summary.activityCount)/10:0;
    const [reports]=await db.query(`SELECT dr.id,dr.report_date AS reportDate,dr.status,dr.total_hours AS totalHours,
      dr.observations,dr.objectives,dr.next_day_targets AS nextDayTargets,dr.general_comments AS generalComments,
      dr.review_comment AS reviewComment,reviewer.last_name AS reviewerName,dr.reviewed_at AS reviewedAt,
      COUNT(ra.id) AS activityCount,COALESCE(SUM(ra.hours),0) AS activityHours
      FROM daily_reports dr LEFT JOIN report_activities ra ON ra.daily_report_id=dr.id
      LEFT JOIN users reviewer ON reviewer.id=dr.reviewed_by
      WHERE dr.user_id=? AND dr.report_date>=?
      GROUP BY dr.id,dr.report_date,dr.status,dr.total_hours,dr.observations,dr.objectives,
        dr.next_day_targets,dr.general_comments,dr.review_comment,reviewer.last_name,dr.reviewed_at
      ORDER BY dr.report_date DESC,dr.created_at DESC LIMIT 500`,[agentId,startDate]);
    const [activities]=await db.query(`SELECT ra.id,ra.daily_report_id AS reportId,dr.report_date AS reportDate,
      dr.status AS reportStatus,ra.description,ra.objectives,ra.category,ra.status,ra.obsevations AS observations,
      ra.hours,ra.created_at AS createdAt
      FROM report_activities ra JOIN daily_reports dr ON dr.id=ra.daily_report_id
      WHERE dr.user_id=? AND dr.report_date>=? ORDER BY dr.report_date DESC,ra.id DESC LIMIT 1000`,[agentId,startDate]);
    const [issues]=await db.query(`SELECT ri.id,ri.report_id AS reportId,dr.report_date AS reportDate,
      ri.issue_description AS description,ri.proposed_solution AS proposedSolution,
      ri.needs_manager_help AS needsManagerHelp,ri.status,ri.review_comment AS reviewComment,
      reviewer.last_name AS reviewerName,ri.reviewed_at AS reviewedAt,ri.created_at AS createdAt
      FROM report_issues ri JOIN daily_reports dr ON dr.id=ri.report_id
      LEFT JOIN users reviewer ON reviewer.id=ri.reviewed_by
      WHERE dr.user_id=? AND dr.report_date>=? ORDER BY ri.created_at DESC LIMIT 500`,[agentId,startDate]);
    const [ratings]=await db.query(`SELECT n.evaluation_date AS evaluationDate,n.rating,n.comment,
      manager.last_name AS managerName,manager.username AS managerUsername
      FROM notation n JOIN users manager ON manager.id=n.manager_id
      WHERE n.agent_id=? AND n.evaluation_date>=? ORDER BY n.evaluation_date DESC,n.updated_at DESC LIMIT 500`,[agentId,startDate]);
    const categories=Object.values(activities.reduce((acc,item)=>{const label=String(item.category||'Non classée');if(!acc[label])acc[label]={category:label,count:0,hours:0};acc[label].count+=1;acc[label].hours+=Number(item.hours||0);return acc;},{})).sort((a,b)=>b.count-a.count);
    const completion=summary.activityCount?`${summary.completedActivities}/${summary.activityCount} activités terminées (${summary.completionRate} %)`:'aucune activité enregistrée';
    const narrative=`Sur les ${days} derniers jours (depuis le ${new Date(`${startDate}T12:00:00`).toLocaleDateString('fr-FR')}), ${profile.fullName} a transmis ${summary.reportCount} rapport${summary.reportCount===1?'':'s'} et réalisé ${summary.activityCount} activité${summary.activityCount===1?'':'s'}. ${completion}. Le temps déclaré totalise ${summary.totalHours.toFixed(1)} h. ${issues.length?`${issues.length} difficulté${issues.length===1?'':'s'} signalée${issues.length===1?'':'s'}; `:'Aucune difficulté signalée sur la période; '}${ratings.length?`${ratings.length} notation${ratings.length===1?'':'s'} reçue${ratings.length===1?'':'s'}, moyenne de ${(ratings.reduce((sum,row)=>sum+Number(row.rating),0)/ratings.length).toFixed(1)}/5.`:'aucune notation enregistrée sur la période.'}`;
    return res.json({success:true,days,startDate,profile,summary,reports,activities,issues,ratings,categories,narrative});
  }catch(error){next(error);}
};

exports.addReview = async(req,res,next)=>{
  try{
    const targetId=String(req.body?.targetId||'').trim(),reviewText=String(req.body?.reviewText||'').trim();
    if(!targetId||reviewText.length<5||reviewText.length>3000)return res.status(400).json({success:false,message:'Choisissez une personne et saisissez un avis de 5 à 3 000 caractères.'});
    const [targets]=await db.query("SELECT id FROM users WHERE id=? AND is_active=1 AND LOWER(TRIM(role)) IN ('agent','manager','chef_service','chef_de_service','chef')",[targetId]);
    if(!targets.length)return res.status(404).json({success:false,message:'Agent ou manager actif introuvable.'});
    await ensureReviewsTable();
    await db.query('INSERT INTO big_manager_reviews(id,target_user_id,reviewer_id,review_text) VALUES(?,?,?,?)',[crypto.randomUUID(),targetId,req.user.id,reviewText]);
    return res.status(201).json({success:true,message:'Avis ajouté à l’historique.'});
  }catch(error){next(error);}
};

exports.rateManager = async (req,res,next) => {
  try {
    const { managerId, date, rating, comment='' } = req.body || {};
    if (!managerId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')) || !Number.isInteger(Number(rating)) || Number(rating)<1 || Number(rating)>5 || String(comment).length>2000)
      return res.status(400).json({success:false,message:'Fournissez un manager, une date, une note de 1 à 5 et un avis de 2 000 caractères maximum.'});
    const [target] = await db.query("SELECT id FROM users WHERE id=? AND is_active=1 AND LOWER(TRIM(role))='manager'",[managerId]);
    if (!target.length) return res.status(404).json({success:false,message:'Manager actif introuvable.'});
    const id=crypto.randomUUID();
    await db.query(`INSERT INTO notation(id,agent_id,manager_id,evaluation_date,rating,comment)
      VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rating=VALUES(rating),comment=VALUES(comment),updated_at=CURRENT_TIMESTAMP`,
      [id,managerId,req.user.id,date,Number(rating),String(comment).trim()]);
    return res.json({success:true,message:'Notation journalière enregistrée.'});
  } catch(error){next(error);}
};
