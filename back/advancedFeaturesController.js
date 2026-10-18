const crypto = require('crypto');
const db = require('./db');
const webhookService = require('./webhookService');
const notifications = require('./notificationsController');

const iso = value => { const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return false;const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3]); };
const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const isScalarUserId = value => (typeof value === 'string' && value.length > 0 && value.length <= 64 && value.trim() === value) || (Number.isSafeInteger(value) && value > 0);

exports.getDepartmentAnalytics = async (req,res,next) => {
  try {
    const days = Math.max(7, Math.min(365, Number.parseInt(req.query.days,10)||30));
    const [departments] = await db.query(`SELECT u.department AS departmentId,COALESCE(d.name,u.department) AS departmentName,
      COUNT(dr.id) AS reportCount,COUNT(DISTINCT dr.user_id) AS activeUsers,
      SUM(CASE WHEN DATE(dr.created_at)=dr.report_date THEN 1 ELSE 0 END) AS onTimeReports,
      COUNT(DISTINCT CASE WHEN dr.id IS NOT NULL THEN dr.user_id END) AS reportingUsers,
      COALESCE(SUM(dr.total_hours),0) AS totalHours
      FROM users u LEFT JOIN departments d ON d.id=u.department
      LEFT JOIN daily_reports dr ON dr.user_id=u.id AND dr.report_date>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
      WHERE u.is_active=1 AND LOWER(TRIM(u.role)) IN ('agent','manager','chef_service','chef_de_service','chef')
      GROUP BY u.department,d.name ORDER BY departmentName`,[days]);
    const [previous] = await db.query(`SELECT u.department AS departmentId,COUNT(dr.id) AS reports,
      SUM(CASE WHEN DATE(dr.created_at)=dr.report_date THEN 1 ELSE 0 END) AS onTime
      FROM users u LEFT JOIN daily_reports dr ON dr.user_id=u.id
        AND dr.report_date>=DATE_SUB(CURDATE(),INTERVAL ? DAY) AND dr.report_date<DATE_SUB(CURDATE(),INTERVAL ? DAY)
      WHERE u.is_active=1 AND LOWER(TRIM(u.role)) IN ('agent','manager','chef_service','chef_de_service','chef')
      GROUP BY u.department`,[days*2,days]);
    const previousByDepartment=new Map(previous.map(row=>[row.departmentId,Number(row.reports)?Math.round(100*Number(row.onTime)/Number(row.reports)):0]));
    const [heatmap] = await db.query(`SELECT u.department AS departmentId,COALESCE(d.name,u.department) AS departmentName,
      DAYOFWEEK(dr.report_date) AS weekday,COUNT(*) AS reports,
      SUM(CASE WHEN DATE(dr.created_at)=dr.report_date THEN 1 ELSE 0 END) AS onTime
      FROM daily_reports dr JOIN users u ON u.id=dr.user_id LEFT JOIN departments d ON d.id=u.department
      WHERE dr.report_date>=DATE_SUB(CURDATE(),INTERVAL ? DAY) GROUP BY u.department,d.name,DAYOFWEEK(dr.report_date)
      ORDER BY departmentName,weekday`,[days]);
    return res.json({success:true,days,departments:departments.map(row=>{const onTimeRate=Number(row.reportCount)?Math.round(100*Number(row.onTimeReports)/Number(row.reportCount)):0,previousOnTimeRate=previousByDepartment.get(row.departmentId)||0;return {...row,onTimeRate,previousOnTimeRate,onTimeChange:onTimeRate-previousOnTimeRate};}),heatmap});
  } catch(error){next(error);}
};

exports.getMyObjectives = async(req,res,next)=>{
  try {
    const [objectives] = await db.query(`SELECT o.id,o.title,o.metric,o.target_value AS targetValue,o.period_start AS periodStart,o.period_end AS periodEnd,
      CASE o.metric WHEN 'reports' THEN (SELECT COUNT(*) FROM daily_reports dr WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end)
      WHEN 'activities' THEN (SELECT COUNT(*) FROM report_activities ra JOIN daily_reports dr ON dr.id=ra.daily_report_id WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end)
      WHEN 'hours' THEN (SELECT COALESCE(SUM(dr.total_hours),0) FROM daily_reports dr WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end)
      WHEN 'on_time_rate' THEN (SELECT COALESCE(ROUND(100*SUM(DATE(dr.created_at)=dr.report_date)/NULLIF(COUNT(*),0),1),0) FROM daily_reports dr WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end) END AS actualValue
      FROM user_objectives o WHERE o.user_id=? AND o.is_active=1 ORDER BY o.period_end DESC,o.created_at DESC`,[req.user.id]);
    return res.json({success:true,objectives:objectives.map(row=>({...row,progress:Number(row.targetValue)>0?Math.min(100,Math.round(100*Number(row.actualValue||0)/Number(row.targetValue))):0}))});
  } catch(error){next(error);}
};

exports.setObjective = async(req,res,next)=>{
  try {
    const {userId,title,metric,targetValue,periodStart,periodEnd}=req.body||{};
    const parsedTarget=Number(targetValue);
    if(!userId||typeof title!=='string'||title.trim().length<3||title.length>160||!['reports','activities','hours','on_time_rate'].includes(metric)||!Number.isFinite(parsedTarget)||parsedTarget<=0||parsedTarget>1000000||!iso(periodStart)||!iso(periodEnd)||periodStart>periodEnd)return res.status(400).json({success:false,message:'Objectif invalide.'});
    const actorRole=normalizeRole(req.user.role),isAdmin=actorRole==='admin';
    if(!isAdmin&&!['chef_service','chef_de_service','chef','manager'].includes(actorRole))return res.status(403).json({success:false,message:'Accès réservé au chef de service.'});
    const [targets]=await db.query("SELECT id,department,role FROM users WHERE id=? AND is_active=1 LIMIT 1",[userId]);
    if(!targets.length)return res.status(404).json({success:false,message:'Utilisateur actif introuvable.'});
    if(!['agent','manager'].includes(normalizeRole(targets[0].role)))return res.status(400).json({success:false,message:'Les objectifs individuels concernent les agents et managers actifs.'});
    if(!isAdmin){
      const [actor]=await db.query('SELECT department FROM users WHERE id=?',[req.user.id]);
      if(!actor[0]?.department||String(actor[0].department)!==String(targets[0].department))return res.status(403).json({success:false,message:'Cet utilisateur ne relève pas de votre service.'});
    }
    const id=crypto.randomUUID();
    await db.query('INSERT INTO user_objectives(id,user_id,created_by,title,metric,target_value,period_start,period_end) VALUES(?,?,?,?,?,?,?,?)',[id,userId,req.user.id,title.trim(),metric,parsedTarget,periodStart,periodEnd]);
    return res.status(201).json({success:true,id});
  } catch(error){next(error);}
};

exports.listDepartmentObjectives = async(req,res,next)=>{
  try {
    const actorRole=normalizeRole(req.user.role),userId=String(req.query.userId||'').trim();
    const isAdmin=actorRole==='admin';
    if(!isAdmin&&!['chef_service','chef_de_service','chef','manager'].includes(actorRole))return res.status(403).json({success:false,message:'Accès réservé au chef de service.'});
    let scopeSql='',params=[];
    if(userId){scopeSql=' AND u.id=?';params.push(userId);}
    if(!isAdmin){
      const [actor]=await db.query('SELECT department FROM users WHERE id=?',[req.user.id]);
      if(!actor[0]?.department)return res.status(403).json({success:false,message:'Service introuvable.'});
      scopeSql+=' AND u.department=?';params.push(actor[0].department);
    }
    const [rows]=await db.query(`SELECT o.id,o.title,o.metric,o.target_value AS targetValue,o.period_start AS periodStart,o.period_end AS periodEnd,
      u.id AS userId,u.last_name AS fullName,u.username,
      CASE o.metric WHEN 'reports' THEN (SELECT COUNT(*) FROM daily_reports dr WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end)
      WHEN 'activities' THEN (SELECT COUNT(*) FROM report_activities ra JOIN daily_reports dr ON dr.id=ra.daily_report_id WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end)
      WHEN 'hours' THEN (SELECT COALESCE(SUM(dr.total_hours),0) FROM daily_reports dr WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end)
      WHEN 'on_time_rate' THEN (SELECT COALESCE(ROUND(100*SUM(DATE(dr.created_at)=dr.report_date)/NULLIF(COUNT(*),0),1),0) FROM daily_reports dr WHERE dr.user_id=o.user_id AND dr.report_date BETWEEN o.period_start AND o.period_end) END AS actualValue
      FROM user_objectives o JOIN users u ON u.id=o.user_id WHERE o.is_active=1${scopeSql} ORDER BY o.period_end DESC,u.last_name`,params);
    return res.json({success:true,objectives:rows.map(row=>({...row,progress:Number(row.targetValue)>0?Math.min(100,Math.round(100*Number(row.actualValue||0)/Number(row.targetValue))):0}))});
  }catch(error){next(error);}
};

exports.getDelegations = async(req,res,next)=>{
  try {
    const role=normalizeRole(req.user.role),admin=role==='admin';
    if(!admin&&!['chef_service','chef_de_service','chef','manager'].includes(role))return res.status(403).json({success:false,message:'Accès réservé au chef de service.'});
    let scope='';const params=[];
    if(!admin){
      const [actor]=await db.query('SELECT department FROM users WHERE id=?',[req.user.id]);
      if(!actor[0]?.department)return res.status(403).json({success:false,message:'Service introuvable.'});
      scope=' AND p.department=? AND x.department=?';params.push(actor[0].department,actor[0].department);
    }
    const [rows]=await db.query(`SELECT d.id,d.principal_user_id AS principalUserId,p.last_name AS principalName,p.role AS principalRole,
      d.delegate_user_id AS delegateUserId,x.last_name AS delegateName,x.role AS delegateRole,d.starts_at AS startsAt,d.ends_at AS endsAt,d.reason,d.revoked_at AS revokedAt
      FROM user_delegations d JOIN users p ON p.id=d.principal_user_id JOIN users x ON x.id=d.delegate_user_id
      WHERE 1=1${scope} ORDER BY d.starts_at DESC LIMIT 500`,params);
    return res.json({success:true,delegations:rows});
  } catch(error){next(error);}
};

exports.createDelegation = async(req,res,next)=>{
  try {
    const {delegateUserId,startsAt,endsAt,reason}=req.body||{};
    const actorRole=normalizeRole(req.user.role),isAdmin=actorRole==='admin';
    if(!isAdmin&&!['chef_service','chef_de_service','chef','manager'].includes(actorRole))return res.status(403).json({success:false,message:'Accès réservé au chef de service.'});
    const principalUserId=isAdmin?req.body?.principalUserId:req.user.id;
    const start=new Date(startsAt),end=new Date(endsAt);
    if(!isScalarUserId(principalUserId)||!isScalarUserId(delegateUserId)||String(principalUserId)===String(delegateUserId)||Number.isNaN(+start)||Number.isNaN(+end)||end<=start||end-start>90*86400000)return res.status(400).json({success:false,message:'Période ou compte de délégation invalide (maximum 90 jours).'});
    const id=crypto.randomUUID(),connection=await db.getConnection();
    try {
      await connection.beginTransaction();
      const [users]=await connection.query('SELECT id,role,department FROM users WHERE id IN (?,?) AND is_active=1 ORDER BY id FOR UPDATE',[principalUserId,delegateUserId]);
      const principal=users.find(user=>String(user.id)===String(principalUserId)),delegate=users.find(user=>String(user.id)===String(delegateUserId));
      if(!principal||!delegate||!['chef_service','chef_de_service','chef','manager'].includes(normalizeRole(principal.role))){
        await connection.rollback();
        return res.status(400).json({success:false,message:'Le titulaire et le remplaçant doivent être des comptes actifs et le titulaire doit être un responsable.'});
      }
      if(!principal.department||String(principal.department)!==String(delegate.department)){
        await connection.rollback();
        return res.status(400).json({success:false,message:'Le remplaçant doit appartenir au même service.'});
      }
      if(!isAdmin&&String(principal.id)!==String(req.user.id)){
        await connection.rollback();
        return res.status(403).json({success:false,message:'Vous pouvez déléguer uniquement votre propre responsabilité.'});
      }
      const [overlaps]=await connection.query('SELECT id FROM user_delegations WHERE delegate_user_id=? AND revoked_at IS NULL AND starts_at<? AND ends_at>? LIMIT 1 FOR UPDATE',[delegateUserId,end,start]);
      if(overlaps.length){await connection.rollback();return res.status(409).json({success:false,message:'Ce remplaçant a déjà une délégation active sur cette période.'});}
      await connection.query('INSERT INTO user_delegations(id,principal_user_id,delegate_user_id,starts_at,ends_at,reason,created_by) VALUES(?,?,?,?,?,?,?)',[id,principalUserId,delegateUserId,start,end,String(reason||'').slice(0,500)||null,req.user.id]);
      await connection.commit();
    } catch(error) {try{await connection.rollback();}catch{}throw error;} finally {connection.release();}
    await Promise.all([principalUserId,delegateUserId].map(userId=>notifications.createNotification(userId,{title:'Délégation temporaire enregistrée',body:`Délégation du ${start.toLocaleString('fr-FR')} au ${end.toLocaleString('fr-FR')}.`,type:'delegation',link:'/html/chef_service_dashboard.html'})));
    return res.status(201).json({success:true,id});
  } catch(error){next(error);}
};

exports.revokeDelegation = async(req,res,next)=>{
  try {
    const role=normalizeRole(req.user.role),admin=role==='admin',principalId=req.user.id;
    if(!admin&&!['chef_service','chef_de_service','chef','manager'].includes(role))return res.status(403).json({success:false,message:'Accès réservé au chef de service.'});
    const [result]=await db.query('UPDATE user_delegations SET revoked_at=NOW() WHERE id=? AND revoked_at IS NULL AND (principal_user_id=? OR ?=1)',[req.params.id,principalId,admin?1:0]);
    if(!result.affectedRows)return res.status(404).json({success:false,message:'Délégation introuvable ou déjà révoquée.'});
    return res.json({success:true});
  } catch(error){next(error);}
};

exports.getModulePermissions = async(_req,res,next)=>{
  try {const [rows]=await db.query('SELECT role_id AS roleId,module_key AS moduleKey,is_allowed AS isAllowed,updated_at AS updatedAt FROM module_permissions ORDER BY role_id,module_key');return res.json({success:true,permissions:rows});}catch(error){next(error);}
};
exports.setModulePermission = async(req,res,next)=>{
  try {
    const {roleId,moduleKey,allowed}=req.body||{};
    if(!['agent','manager','chef_service','chef_de_service','chef','big_manager'].includes(normalizeRole(roleId))||!['reports','report_review','big_manager','admin'].includes(moduleKey)||typeof allowed!=='boolean')return res.status(400).json({success:false,message:'Permission invalide.'});
    await db.query('INSERT INTO module_permissions(role_id,module_key,is_allowed,updated_by) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE is_allowed=VALUES(is_allowed),updated_by=VALUES(updated_by)',[normalizeRole(roleId),moduleKey,allowed?1:0,req.user.id]);
    return res.json({success:true});
  }catch(error){next(error);}
};

exports.getMyApiTokens = async(req,res,next)=>{
  try {const [tokens]=await db.query('SELECT id,label,scopes,created_at AS createdAt,expires_at AS expiresAt,last_used_at AS lastUsedAt FROM api_tokens WHERE owner_id=? AND revoked_at IS NULL ORDER BY created_at DESC',[req.user.id]);return res.json({success:true,tokens});}catch(error){next(error);}
};
exports.createApiToken = async(req,res,next)=>{
  try {
    const label=String(req.body?.label||'').trim();
    if(label.length<3||label.length>100)return res.status(400).json({success:false,message:'Donnez un nom de 3 à 100 caractères au jeton.'});
    const [[active]] = await db.query('SELECT COUNT(*) AS total FROM api_tokens WHERE owner_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())',[req.user.id]);
    if(Number(active.total)>=10)return res.status(429).json({success:false,message:'Limite de 10 jetons API actifs atteinte. Révoquez-en un avant d’en créer un autre.'});
    const raw=`rpr_${crypto.randomBytes(32).toString('base64url')}`,id=crypto.randomUUID();
    const tokenHash=crypto.createHash('sha256').update(raw).digest('hex');
    await db.query('INSERT INTO api_tokens(id,owner_id,label,token_hash,scopes,expires_at) VALUES(?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 90 DAY))',[id,req.user.id,label,tokenHash,JSON.stringify(['reports:read:self'])]);
    return res.status(201).json({success:true,id,token:raw,expiresInDays:90,message:'Copiez ce jeton maintenant. Il ne sera plus affiché.'});
  }catch(error){next(error);}
};
exports.revokeApiToken = async(req,res,next)=>{
  try {const [result]=await db.query('UPDATE api_tokens SET revoked_at=NOW() WHERE id=? AND owner_id=? AND revoked_at IS NULL',[req.params.id,req.user.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Jeton introuvable.'});return res.json({success:true});}catch(error){next(error);}
};
exports.externalReports = async(req,res,next)=>{
  try {
    const raw=String(req.get('x-api-token')||'');if(!raw.startsWith('rpr_'))return res.status(401).json({success:false,message:'Jeton API invalide.'});
    const hash=crypto.createHash('sha256').update(raw).digest('hex');
    const [tokens]=await db.query('SELECT id,owner_id AS ownerId,scopes FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1',[hash]);
    if(!tokens.length)return res.status(401).json({success:false,message:'Jeton API invalide ou expiré.'});
    await db.query('UPDATE api_tokens SET last_used_at=NOW() WHERE id=?',[tokens[0].id]);
    const [reports]=await db.query('SELECT id,report_date AS date,status,total_hours,observations,created_at AS createdAt FROM daily_reports WHERE user_id=? ORDER BY report_date DESC LIMIT 100',[tokens[0].ownerId]);
    return res.json({success:true,reports});
  }catch(error){next(error);}
};

exports.savePushSubscription = async(req,res,next)=>{
  try {
    const sub=req.body?.subscription;
    if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth||String(sub.endpoint).length>2048)return res.status(400).json({success:false,message:'Abonnement de notification invalide.'});
    const id=crypto.randomUUID(),hash=crypto.createHash('sha256').update(sub.endpoint).digest('hex');
    await db.query(`INSERT INTO push_subscriptions(id,user_id,endpoint_hash,endpoint,p256dh,auth_secret) VALUES(?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),p256dh=VALUES(p256dh),auth_secret=VALUES(auth_secret)`,[id,req.user.id,hash,sub.endpoint,sub.keys.p256dh,sub.keys.auth]);
    return res.json({success:true});
  }catch(error){next(error);}
};

exports.deletePushSubscription = async(req,res,next)=>{
  try {const sub=req.body?.subscription;if(!sub?.endpoint)return res.status(400).json({success:false,message:'Abonnement invalide.'});const hash=crypto.createHash('sha256').update(sub.endpoint).digest('hex');await db.query('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint_hash=?',[req.user.id,hash]);return res.json({success:true});}catch(error){next(error);}
};

exports.getPushConfig = (_req,res)=>{
  const key=String(process.env.VAPID_PUBLIC_KEY||'').trim();
  if(!key)return res.status(503).json({success:false,enabled:false,message:'Les notifications navigateur ne sont pas configurées sur le serveur.'});
  return res.json({success:true,enabled:true,publicKey:key});
};

exports.listWebhooks=async(req,res,next)=>{try{const [rows]=await db.query('SELECT id,label,endpoint_url AS endpointUrl,created_at AS createdAt FROM webhook_endpoints WHERE owner_id=? AND revoked_at IS NULL ORDER BY created_at DESC',[req.user.id]);return res.json({success:true,webhooks:rows});}catch(error){next(error);}};
exports.createWebhook=async(req,res,next)=>{try{const label=String(req.body?.label||'').trim();if(label.length<3||label.length>100)return res.status(400).json({success:false,message:'Nom de webhook invalide.'});const [[active]]=await db.query('SELECT COUNT(*) AS total FROM webhook_endpoints WHERE owner_id=? AND is_active=1 AND revoked_at IS NULL',[req.user.id]);if(Number(active.total)>=10)return res.status(429).json({success:false,message:'Limite de 10 webhooks actifs atteinte.'});const checked=await webhookService.validateEndpoint(String(req.body?.url||''));const secret=require('crypto').randomBytes(32).toString('base64url');const encrypted=webhookService.encryptSecret(secret);const id=require('crypto').randomUUID();await db.query('INSERT INTO webhook_endpoints(id,owner_id,label,endpoint_url,secret_ciphertext,secret_iv,secret_tag) VALUES(?,?,?,?,?,?,?)',[id,req.user.id,label,checked.url,encrypted.ciphertext,encrypted.iv,encrypted.tag]);return res.status(201).json({success:true,id,secret,message:'Copiez le secret maintenant. Les événements sont signés avec HMAC-SHA256.'});}catch(error){if(error.message?.includes('URL')||error.message?.includes('domaine')||error.message?.includes('HTTPS'))return res.status(400).json({success:false,message:error.message});next(error);}};
exports.revokeWebhook=async(req,res,next)=>{try{const [result]=await db.query('UPDATE webhook_endpoints SET is_active=0,revoked_at=NOW() WHERE id=? AND owner_id=? AND revoked_at IS NULL',[req.params.id,req.user.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Webhook introuvable.'});return res.json({success:true});}catch(error){next(error);}};
