const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const appSettings = require('./appSettings');
const { sendAccountCredentials } = require('./mailer');
const activityAudit = require('./activityAudit');
const { isValidEmail, isValidPassword, PASSWORD_MIN_LENGTH } = require('./validators');

let schemaReady;
async function ensureAdminSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS departments (
      id varchar(100) NOT NULL PRIMARY KEY,
      name varchar(100) NOT NULL UNIQUE,
      is_active tinyint(1) NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await db.query(`CREATE TABLE IF NOT EXISTS roles (
      id varchar(30) NOT NULL PRIMARY KEY,
      name varchar(60) NOT NULL,
      is_active tinyint(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await db.query(`INSERT IGNORE INTO roles(id,name) VALUES
      ('agent','Agent'),('chef_service','Chef de service'),('manager','Manager'),
      ('chef_de_service','Chef de service'),('chef','Chef'),('big_manager','Big manager'),('admin','Administrateur')`);
    await db.query(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_id varchar(36) NULL,
      target_id varchar(36) NULL,
      action varchar(60) NOT NULL,
      ip_address varchar(45) NULL,
      details text NULL,
      created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_admin_audit_created (created_at),
      KEY idx_admin_audit_actor (actor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await db.query(`CREATE TABLE IF NOT EXISTS admin_retention_policies (
      entity_type varchar(40) NOT NULL PRIMARY KEY,
      retention_days int unsigned NOT NULL DEFAULT 365,
      is_enabled tinyint(1) NOT NULL DEFAULT 0,
      updated_by varchar(36) NULL,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await db.query(`CREATE TABLE IF NOT EXISTS data_archives (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      entity_type varchar(40) NOT NULL,
      source_id varchar(64) NOT NULL,
      department varchar(100) NULL,
      owner_id varchar(36) NULL,
      record_date date NULL,
      payload longtext NOT NULL,
      archived_by varchar(36) NULL,
      archived_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_archive_source (entity_type, source_id),
      KEY idx_archive_date (record_date),
      KEY idx_archive_department (department)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    await db.query(`INSERT IGNORE INTO admin_retention_policies (entity_type,retention_days,is_enabled)
      VALUES ('daily_report',365,0),('report_issue',365,0),('notation',365,0)`);
    await db.query('ALTER TABLE departments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
    await db.query('ALTER TABLE admin_audit_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
    await db.query('ALTER TABLE admin_retention_policies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
    await db.query('ALTER TABLE data_archives CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
    await db.query('ALTER TABLE departments MODIFY id varchar(100) NOT NULL');
    await db.query(`INSERT IGNORE INTO departments (id, name)
      SELECT TRIM(department), TRIM(department) FROM users
      WHERE department IS NOT NULL AND TRIM(department) <> '' GROUP BY TRIM(department)`);
    // Le nom existant sert de clé de département afin de préserver les relations
    // et d'éviter de perdre les affectations lors de la normalisation.
    await db.query('UPDATE departments SET id=name WHERE id<>name');
    await db.query("UPDATE users SET role=LOWER(REPLACE(REPLACE(TRIM(role),' ','_'),'-','_')) WHERE role IS NOT NULL");
    await db.query(`INSERT IGNORE INTO roles(id,name)
      SELECT LOWER(REPLACE(REPLACE(TRIM(role),' ','_'),'-','_')), LOWER(REPLACE(REPLACE(TRIM(role),' ','_'),'-','_'))
      FROM users WHERE role IS NOT NULL AND TRIM(role)<>'' AND CHAR_LENGTH(TRIM(role))<=30`);
    await db.query("ALTER TABLE users MODIFY role varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'agent', MODIFY department varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL");
    const [[roleForeignKey]] = await db.query(`SELECT COUNT(*) AS count FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='users' AND CONSTRAINT_NAME='fk_users_role_id'`);
    if (!Number(roleForeignKey.count)) await db.query('ALTER TABLE users ADD CONSTRAINT fk_users_role_id FOREIGN KEY (role) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE RESTRICT');
    const [[departmentForeignKey]] = await db.query(`SELECT COUNT(*) AS count FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='users' AND CONSTRAINT_NAME='fk_users_department_id'`);
    if (!Number(departmentForeignKey.count)) await db.query('ALTER TABLE users ADD CONSTRAINT fk_users_department_id FOREIGN KEY (department) REFERENCES departments(id) ON UPDATE CASCADE ON DELETE RESTRICT');
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}
exports.ensureReferenceSchema = ensureAdminSchema;

async function audit(req, action, targetId, details) {
  await db.query(
    'INSERT INTO admin_audit_logs (actor_id, target_id, action, ip_address, details) VALUES (?, ?, ?, ?, ?)',
    [req.user?.id || null, targetId || null, action, req.ip || null, details ? JSON.stringify(details) : null]
  );
}

const validRoles = ['agent', 'chef_service', 'manager', 'big_manager', 'admin'];
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

exports.requireActiveAdmin = async(req,res,next)=>{
  try{
    const [rows]=await db.query("SELECT role,is_active AS isActive FROM users WHERE id=? LIMIT 1",[req.user?.id]);
    if(!rows.length||Number(rows[0].isActive)!==1||String(rows[0].role).trim().toLowerCase()!=='admin')
      return res.status(403).json({success:false,message:'Accès réservé à un compte administrateur actif.'});
    next();
  }catch(error){next(error);}
};

exports.getOverview = async (req, res, next) => {
  try {
    await ensureAdminSchema();
    const [[users]] = await db.query(`SELECT COUNT(*) total, SUM(is_active=1) active,
      SUM(is_active=0) inactive, SUM(LOWER(TRIM(role))='agent') agents,
      SUM(LOWER(TRIM(role)) IN ('chef_service','chef_de_service','manager','chef')) managers,
      SUM(LOWER(TRIM(role))='admin') admins FROM users`);
    const [[reports]] = await db.query(`SELECT COUNT(*) total,
      SUM(LOWER(TRIM(status)) IN ('submitted','pending','en_attente')) pending,
      SUM(LOWER(TRIM(status)) IN ('approved','validated','accepted','valide','validé')) approved,
      SUM(LOWER(TRIM(status)) IN ('rejected','refused','rejete','rejeté')) rejected FROM daily_reports`);
    const [[activities]] = await db.query(`SELECT COUNT(*) total,
      SUM(LOWER(TRIM(ra.status))='completed') completed,
      COALESCE(SUM(ra.hours),0) hours FROM report_activities ra`);
    const [[issues]] = await db.query(`SELECT COUNT(*) total,
      SUM(LOWER(TRIM(status))='pending') pending FROM report_issues`);
    const [departments] = await db.query(`SELECT d.id, d.name, d.is_active AS isActive,
      COUNT(DISTINCT u.id) AS memberCount,
      COUNT(DISTINCT CASE WHEN u.is_active=1 THEN u.id END) AS activeMemberCount,
      SUM(CASE WHEN u.is_active=1 AND LOWER(TRIM(u.role))='agent' THEN 1 ELSE 0 END) AS agentCount,
      SUM(CASE WHEN u.is_active=1 AND LOWER(TRIM(u.role)) IN ('chef_service','chef_de_service','manager','chef') THEN 1 ELSE 0 END) AS managerCount,
      MAX(CASE WHEN LOWER(TRIM(u.role)) IN ('chef_service','chef_de_service','manager','chef') AND u.is_active=1 THEN u.last_name END) AS managerName
      FROM departments d LEFT JOIN users u ON u.department=d.name
      GROUP BY d.id ORDER BY d.name`);
    return res.json({ success: true, users, reports, activities, issues, departments });
  } catch (error) { next(error); }
};

exports.listUsers = async (req, res, next) => {
  try {
    await ensureAdminSchema();
    const where = [];
    const params = [];
    const search = String(req.query.search || '').trim().slice(0, 100);
    if (search) { where.push('(u.last_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'); const q = `%${search}%`; params.push(q,q,q,q); }
    if (req.query.role) {
      const role=String(req.query.role).toLowerCase();
      if(['manager','chef_service','chef_de_service','chef'].includes(role)) where.push("LOWER(TRIM(u.role)) IN ('manager','chef_service','chef_de_service','chef')");
      else { where.push('LOWER(TRIM(u.role)) = ?'); params.push(role); }
    }
    if (req.query.department) { where.push('u.department = ?'); params.push(String(req.query.department)); }
    if (req.query.status === 'active') where.push('u.is_active=1');
    if (req.query.status === 'inactive') where.push('u.is_active=0');
    const [rows] = await db.query(`SELECT u.id, u.last_name AS fullName, u.username, u.email,
      u.phone, u.role, u.department, u.job_title AS jobTitle, u.is_active AS isActive,
      u.created_at AS createdAt FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.last_name,u.username LIMIT 500`, params);
    return res.json({ success: true, users: rows });
  } catch (error) { next(error); }
};

exports.createUser = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await ensureAdminSchema();
    const body = req.body || {};
    const fullName = String(body.fullName || '').trim().slice(0, 50);
    const username = String(body.username || '').trim().slice(0, 50);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
    const phone = String(body.phone || '').trim().slice(0, 30) || null;
    const role = String(body.role || 'agent').trim().toLowerCase();
    const department = String(body.department || '').trim().slice(0, 100);
    const password = String(body.password || '');
    if (!fullName || !username || !isValidEmail(email) || !department || !validRoles.includes(role) || !isValidPassword(password)) {
      return res.status(400).json({ success:false, message:`Renseignez le nom, le nom utilisateur, un e-mail valide, le département, le rôle et un mot de passe d’au moins ${PASSWORD_MIN_LENGTH} caractères.` });
    }
    const [deptRows] = await db.query('SELECT id FROM departments WHERE id=? AND is_active=1', [department]);
    if (!deptRows.length) return res.status(400).json({ success:false, message:'Département introuvable ou inactif.' });
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 10);
    await connection.beginTransaction();
    await connection.query(`INSERT INTO users (id,last_name,username,email,phone,password_hash,role,department,is_active)
      VALUES (?,?,?,?,?,?,?,?,1)`, [id,fullName,username,email,phone,hash,role,deptRows[0].id]);
    await connection.commit();
    await audit(req,'USER_CREATED',id,{username,email,role,department});
    let emailSent = true;
    try { await sendAccountCredentials(email, username, password); }
    catch (mailError) { emailSent = false; console.error('Envoi des identifiants impossible:', mailError.message); }
    return res.status(201).json({ success:true, id, emailSent, message:emailSent ? 'Compte créé et identifiants envoyés par e-mail.' : 'Compte créé, mais l’e-mail n’a pas pu être envoyé. Vérifiez la configuration SMTP.' });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success:false,message:'Ce nom utilisateur ou cet e-mail est déjà utilisé.' });
    next(error);
  } finally { connection.release(); }
};

exports.getRegistrationSetting = async (req,res,next) => {
  try { await appSettings.ensureSettings(); const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key='registration_open'"); return res.json({success:true,enabled:rows[0]?.setting_value==='1'}); }
  catch(error){next(error);}
};
exports.setRegistrationSetting = async (req,res,next) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({success:false,message:'Le champ enabled doit être booléen.'});
    await appSettings.ensureSettings();
    await db.query("UPDATE app_settings SET setting_value=?,updated_by=? WHERE setting_key='registration_open'",[enabled?'1':'0',req.user.id]);
    await audit(req, enabled ? 'REGISTRATION_ENABLED' : 'REGISTRATION_DISABLED', null, {});
    return res.json({success:true,enabled});
  } catch(error){next(error);}
};

exports.updateUser = async (req, res, next) => {
  try {
    await ensureAdminSchema();
    const id = String(req.params.userId || '').trim();
    const body = req.body || {};
    const fullName = String(body.fullName || '').trim().slice(0,50);
    const username = String(body.username || '').trim().slice(0,50);
    const email = String(body.email || '').trim().toLowerCase().slice(0,120);
    const phone = String(body.phone || '').trim().slice(0,30) || null;
    const department = String(body.department || '').trim().slice(0,100);
    const role = String(body.role || '').trim().toLowerCase();
    const jobTitle = String(body.jobTitle || '').trim().slice(0,100) || null;
    if (!fullName || !username || !isValidEmail(email) || !department || !validRoles.includes(role)) {
      return res.status(400).json({ success:false,message:'Vérifiez les informations obligatoires et le rôle choisi.' });
    }
    if (req.user.id === id && role !== 'admin') return res.status(400).json({ success:false,message:'Vous ne pouvez pas retirer votre propre rôle administrateur.' });
    const [existingRows] = await db.query('SELECT role,is_active AS isActive FROM users WHERE id=? LIMIT 1',[id]);
    if (!existingRows.length) return res.status(404).json({success:false,message:'Utilisateur introuvable.'});
    if (String(existingRows[0].role).toLowerCase()==='admin' && Number(existingRows[0].isActive)===1 && role!=='admin') {
      const [[admins]] = await db.query("SELECT COUNT(*) AS total FROM users WHERE is_active=1 AND LOWER(TRIM(role))='admin'");
      if (Number(admins.total)<=1) return res.status(409).json({success:false,message:'Le dernier administrateur actif ne peut pas être rétrogradé.'});
    }
    const [deptRows] = await db.query('SELECT id FROM departments WHERE id=? AND is_active=1', [department]);
    if (!deptRows.length) return res.status(400).json({ success:false,message:'Département introuvable ou inactif.' });
    await db.query(`UPDATE users SET last_name=?,username=?,email=?,phone=?,department=?,role=?,job_title=? WHERE id=?`,
      [fullName,username,email,phone,deptRows[0].id,role,jobTitle,id]);
    await audit(req,'USER_UPDATED',id,{username,email,role,department});
    return res.json({ success:true,message:'Utilisateur mis à jour.' });
  } catch(error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success:false,message:'Ce nom utilisateur ou cet e-mail est déjà utilisé.' });
    next(error);
  }
};

exports.setUserStatus = async (req, res, next) => {
  try {
    await ensureAdminSchema();
    const id = String(req.params.userId || '').trim();
    const active = req.body?.active === true;
    if (!id || id === req.user.id && !active) return res.status(400).json({ success:false,message:'Vous ne pouvez pas désactiver votre propre compte.' });
    if (!active) {
      const [targetRows] = await db.query('SELECT role,is_active AS isActive FROM users WHERE id=? LIMIT 1',[id]);
      if (!targetRows.length) return res.status(404).json({success:false,message:'Utilisateur introuvable.'});
      if (String(targetRows[0].role).toLowerCase()==='admin' && Number(targetRows[0].isActive)===1) {
        const [[admins]] = await db.query("SELECT COUNT(*) AS total FROM users WHERE is_active=1 AND LOWER(TRIM(role))='admin'");
        if (Number(admins.total)<=1) return res.status(409).json({success:false,message:'Le dernier administrateur actif ne peut pas être désactivé.'});
      }
    }
    const [targets] = await db.query('SELECT id FROM users WHERE id=? LIMIT 1',[id]);
    if (!targets.length) return res.status(404).json({ success:false,message:'Utilisateur introuvable.' });
    await db.query('UPDATE users SET is_active=? WHERE id=?', [active ? 1 : 0,id]);
    await audit(req,active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',id);
    return res.json({ success:true,isActive:active });
  } catch(error) { next(error); }
};

exports.resetUserPassword = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const id=String(req.params.userId||'');
    const password=String(req.body?.password||'');
    if(!isValidPassword(password))return res.status(400).json({success:false,message:`Le mot de passe temporaire doit contenir entre ${PASSWORD_MIN_LENGTH} et 200 caractères.`});
    const [target]=await db.query('SELECT id FROM users WHERE id=? LIMIT 1',[id]);
    if(!target.length)return res.status(404).json({success:false,message:'Utilisateur introuvable.'});
    const hash=await bcrypt.hash(password,10);
    await db.query('UPDATE users SET password_hash=?,two_factor_code=NULL,two_factor_expires=NULL WHERE id=?',[hash,id]);
    await audit(req,'USER_PASSWORD_RESET',id);
    return res.json({success:true,message:'Mot de passe temporaire enregistré. Communiquez-le à l’utilisateur par un canal sûr.'});
  }catch(error){next(error);}
};

exports.listDepartments = async (req, res, next) => {
  try {
    await ensureAdminSchema();
    const [rows] = await db.query(`SELECT d.id,d.name,d.is_active AS isActive,
      COUNT(DISTINCT u.id) AS memberCount,
      COUNT(DISTINCT CASE WHEN u.is_active=1 THEN u.id END) AS activeMemberCount,
      SUM(CASE WHEN u.is_active=1 AND LOWER(TRIM(u.role))='agent' THEN 1 ELSE 0 END) AS agentCount,
      MAX(CASE WHEN u.is_active=1 AND LOWER(TRIM(u.role)) IN ('chef_service','chef_de_service','manager','chef') THEN u.last_name END) AS managerName
      FROM departments d LEFT JOIN users u ON u.department=d.name GROUP BY d.id ORDER BY d.name`);
    return res.json({success:true,departments:rows});
  } catch(error) { next(error); }
};

exports.createDepartment = async (req,res,next) => {
  try {
    await ensureAdminSchema();
    const name=String(req.body?.name||'').trim().slice(0,100);
    if(!name) return res.status(400).json({success:false,message:'Le nom du département est obligatoire.'});
    const id=name;
    await db.query('INSERT INTO departments(id,name,is_active) VALUES(?,?,1)',[id,name]);
    await audit(req,'DEPARTMENT_CREATED',id,{name});
    return res.status(201).json({success:true,id,name});
  } catch(error) {
    if(error.code==='ER_DUP_ENTRY') return res.status(409).json({success:false,message:'Ce département existe déjà.'});
    next(error);
  }
};

exports.updateDepartment = async (req,res,next) => {
  const connection=await db.getConnection();
  try {
    await ensureAdminSchema();
    const id=String(req.params.departmentId||'');
    const name=String(req.body?.name||'').trim().slice(0,100);
    const active=req.body?.active;
    if(!name) return res.status(400).json({success:false,message:'Le nom du département est obligatoire.'});
    const [found]=await connection.query('SELECT name FROM departments WHERE id=? FOR UPDATE',[id]);
    if(!found.length) return res.status(404).json({success:false,message:'Département introuvable.'});
    const oldName=found[0].name;
    if(active===false) {
      const [[counts]]=await connection.query('SELECT COUNT(*) AS total FROM users WHERE department=? AND is_active=1',[oldName]);
      if(Number(counts.total)) return res.status(409).json({success:false,message:'Réaffectez ou désactivez les utilisateurs avant de désactiver ce département.'});
    }
    await connection.beginTransaction();
    await connection.query('UPDATE departments SET id=?,name=?,is_active=? WHERE id=?',[name,name,active===false?0:1,id]);
    if(name!==oldName) await connection.query('UPDATE users SET department=? WHERE department=?',[name,oldName]);
    await connection.commit();
    await audit(req,name!==oldName?'DEPARTMENT_RENAMED':active===false?'DEPARTMENT_DEACTIVATED':'DEPARTMENT_UPDATED',id,{oldName,name});
    return res.json({success:true,name,isActive:active!==false});
  } catch(error) {
    try{await connection.rollback();}catch(_){}
    if(error.code==='ER_DUP_ENTRY') return res.status(409).json({success:false,message:'Un département porte déjà ce nom.'});
    next(error);
  } finally {connection.release();}
};

exports.deleteDepartment = async(req,res,next)=>{
  const connection=await db.getConnection();
  try{
    await ensureAdminSchema();
    const id=String(req.params.departmentId||'');
    await connection.beginTransaction();
    const [sourceRows]=await connection.query('SELECT id,name FROM departments WHERE id=? FOR UPDATE',[id]);
    if(!sourceRows.length){await connection.rollback();return res.status(404).json({success:false,message:'Département introuvable.'});}
    const source=sourceRows[0];
    const [[members]]=await connection.query('SELECT COUNT(*) AS total FROM users WHERE department=?',[source.name]);
    const memberCount=Number(members.total||0);
    let target=null;
    if(memberCount){
      const [targets]=await connection.query('SELECT id,name FROM departments WHERE id<>? AND is_active=1 ORDER BY name LIMIT 1 FOR UPDATE',[id]);
      target=targets[0]||null;
      if(!target){await connection.rollback();return res.status(409).json({success:false,message:'Impossible de supprimer ce département : aucun autre département actif ne peut accueillir ses membres.'});}
      await connection.query('UPDATE users SET department=? WHERE department=?',[target.name,source.name]);
    }
    await connection.query('DELETE FROM departments WHERE id=?',[id]);
    await connection.commit();
    await audit(req,'DEPARTMENT_DELETED',id,{name:source.name,reassignedUsers:memberCount,targetDepartment:target?.name||null});
    return res.json({success:true,deletedDepartment:source.name,reassignedUsers:memberCount,targetDepartment:target?.name||null});
  }catch(error){
    try{await connection.rollback();}catch(_){}
    next(error);
  }finally{connection.release();}
};

exports.listReports = async (req,res,next) => {
  try {
    await ensureAdminSchema();
    const conditions=[];const params=[];
    const department=String(req.query.department||'').trim();
    const status=String(req.query.status||'').trim();
    const search=String(req.query.search||'').trim().slice(0,100);
    const from=String(req.query.dateFrom||'');const to=String(req.query.dateTo||'');
    if(department){conditions.push('u.department=?');params.push(department);}
    if(status){conditions.push('LOWER(TRIM(dr.status))=?');params.push(status.toLowerCase());}
    if(validDate(from)){conditions.push('dr.report_date>=?');params.push(from);}
    if(validDate(to)){conditions.push('dr.report_date<=?');params.push(to);}
    if(search){conditions.push('(u.last_name LIKE ? OR u.username LIKE ? OR dr.general_comments LIKE ?)');const q=`%${search}%`;params.push(q,q,q);}
    const [rows]=await db.query(`SELECT dr.id,dr.user_id AS userId,dr.report_date AS reportDate,
      dr.status,dr.total_hours AS totalHours,dr.general_comments AS comments,
      u.last_name AS agentName,u.username,u.department,
      COUNT(ra.id) AS activityCount,
      SUM(CASE WHEN LOWER(TRIM(ra.status))='completed' THEN 1 ELSE 0 END) AS completedActivities
      FROM daily_reports dr JOIN users u ON u.id=dr.user_id LEFT JOIN report_activities ra ON ra.daily_report_id=dr.id
      ${conditions.length?`WHERE ${conditions.join(' AND ')}`:''}
      GROUP BY dr.id ORDER BY dr.report_date DESC,dr.created_at DESC LIMIT 300`,params);
    return res.json({success:true,reports:rows});
  } catch(error){next(error);}
};

exports.listReviews = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const type=['proposals','ratings'].includes(String(req.query.type))?String(req.query.type):'proposals';
    const department=String(req.query.department||'').trim();
    const search=String(req.query.search||'').trim().slice(0,100);
    const status=String(req.query.status||'').trim().toLowerCase();
    const from=String(req.query.dateFrom||'');const to=String(req.query.dateTo||'');
    const column=type==='ratings'?'n.evaluation_date':'DATE(ri.created_at)';
    const conditions=[];const params=[];
    if(department){conditions.push('agent.department=?');params.push(department);}
    if(type==='proposals'&&['pending','approved','rejected'].includes(status)){conditions.push('LOWER(TRIM(ri.status))=?');params.push(status);}
    if(validDate(from)){conditions.push(`${column}>=?`);params.push(from);}
    if(validDate(to)){conditions.push(`${column}<=?`);params.push(to);}
    if(search){
      if(type==='ratings')conditions.push('(agent.last_name LIKE ? OR agent.username LIKE ? OR n.comment LIKE ?)');
      else conditions.push('(agent.last_name LIKE ? OR agent.username LIKE ? OR ri.issue_description LIKE ? OR ri.proposed_solution LIKE ?)');
      const q=`%${search}%`;params.push(...(type==='ratings'?[q,q,q]:[q,q,q,q]));
    }
    const rowsSql=type==='ratings'
      ? `SELECT n.id,n.evaluation_date AS date,n.rating,n.comment AS details,
           agent.last_name AS agentName,agent.username,agent.department,manager.last_name AS reviewer
         FROM notation n JOIN users agent ON agent.id=n.agent_id LEFT JOIN users manager ON manager.id=n.manager_id
         ${conditions.length?`WHERE ${conditions.join(' AND ')}`:''}
         ORDER BY n.evaluation_date DESC,n.updated_at DESC LIMIT 300`
      : `SELECT ri.id,DATE(ri.created_at) AS date,ri.issue_description AS details,
           ri.proposed_solution AS solution,ri.status,ri.review_comment AS reviewComment,
           ra.description AS activityDescription,agent.last_name AS agentName,agent.username,
           agent.department,reviewer.last_name AS reviewer
         FROM report_issues ri JOIN daily_reports dr ON dr.id=ri.report_id
         JOIN users agent ON agent.id=dr.user_id LEFT JOIN report_activities ra ON ra.id=ri.activity_id
         LEFT JOIN users reviewer ON reviewer.id=ri.reviewed_by
         ${conditions.length?`WHERE ${conditions.join(' AND ')}`:''}
         ORDER BY ri.created_at DESC,ri.id DESC LIMIT 300`;
    const [rows]=await db.query(rowsSql,params);
    return res.json({success:true,type,rows});
  }catch(error){next(error);}
};

exports.listAuditLogs = async (req,res,next) => {
  try {
    await ensureAdminSchema();
    const filterUser=String(req.query.userId||'').trim().slice(0,120);
    const [adminRows]=await db.query(`SELECT l.id,l.action,l.ip_address AS ipAddress,l.details,l.created_at AS createdAt,
      actor.last_name AS actorName,actor.email AS actorEmail,l.target_id AS targetId
      FROM admin_audit_logs l LEFT JOIN users actor ON actor.id=l.actor_id
      WHERE (?='' OR l.actor_id=? OR actor.username=? OR actor.email=? OR actor.last_name LIKE ?) ORDER BY l.created_at DESC,l.id DESC LIMIT 300`,[filterUser,filterUser,filterUser,filterUser,`%${filterUser}%`]);
    await activityAudit.ensureTable();
    const [userRows]=await db.query(`SELECT l.id,CONCAT(l.action,' ',l.route,' [HTTP ',l.status_code,']') AS action,
      l.ip_address AS ipAddress,JSON_OBJECT('route',l.route,'statusCode',l.status_code,'userAgent',l.user_agent) AS details,
      l.created_at AS createdAt,u.last_name AS actorName,u.email AS actorEmail,l.user_id AS targetId
      FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id
      WHERE (?='' OR l.user_id=? OR u.username=? OR u.email=? OR u.last_name LIKE ?) ORDER BY l.created_at DESC,l.id DESC LIMIT 300`,[filterUser,filterUser,filterUser,filterUser,`%${filterUser}%`]);
    const logs=[...adminRows,...userRows].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,500);
    return res.json({success:true,logs});
  } catch(error){next(error);}
};

const archiveTypes = {
  daily_report: 'Rapports et activités',
  report_issue: 'Propositions',
  notation: 'Notations',
};

exports.getRetentionSettings = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const [rows]=await db.query(`SELECT entity_type AS entityType,retention_days AS retentionDays,
      is_enabled AS isEnabled,updated_at AS updatedAt FROM admin_retention_policies ORDER BY entity_type`);
    return res.json({success:true,policies:rows.map(row=>({...row,label:archiveTypes[row.entityType]||row.entityType}))});
  }catch(error){next(error);}
};

exports.saveRetentionSettings = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const policies=Array.isArray(req.body?.policies)?req.body.policies:[];
    if(!policies.length||policies.some(item=>!Object.hasOwn(archiveTypes,String(item.entityType))||!Number.isInteger(Number(item.retentionDays))||Number(item.retentionDays)<1||Number(item.retentionDays)>36500))
      return res.status(400).json({success:false,message:'Indiquez une durée entière comprise entre 1 et 36 500 jours pour chaque type de données.'});
    for(const item of policies){
      await db.query(`INSERT INTO admin_retention_policies(entity_type,retention_days,is_enabled,updated_by)
        VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE retention_days=VALUES(retention_days),is_enabled=VALUES(is_enabled),updated_by=VALUES(updated_by)`,
        [item.entityType,Number(item.retentionDays),item.enabled?1:0,req.user.id]);
    }
    await audit(req,'RETENTION_POLICY_UPDATED',null,{policies:policies.map(item=>({entityType:item.entityType,retentionDays:Number(item.retentionDays),enabled:!!item.enabled}))});
    return exports.getRetentionSettings(req,res,next);
  }catch(error){next(error);}
};

function isoBeforeDays(days){const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-days);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}

exports.runArchive = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const [policies]=await db.query('SELECT entity_type,retention_days FROM admin_retention_policies WHERE is_enabled=1');
    const archived={daily_report:0,report_issue:0,notation:0};
    for(const policy of policies){
      const cutoff=isoBeforeDays(Number(policy.retention_days));
      if(policy.entity_type==='daily_report'){
        const [reports]=await db.query(`SELECT dr.*,u.department FROM daily_reports dr
          JOIN users u ON u.id=dr.user_id
          LEFT JOIN data_archives ar ON ar.entity_type='daily_report' AND ar.source_id=dr.id
          WHERE dr.report_date<=? AND ar.id IS NULL ORDER BY dr.report_date ASC LIMIT 200`,[cutoff]);
        for(const report of reports){
          const [activities]=await db.query('SELECT * FROM report_activities WHERE daily_report_id=? ORDER BY id',[report.id]);
          const [issues]=await db.query('SELECT * FROM report_issues WHERE report_id=? ORDER BY created_at,id',[report.id]);
          const payload=JSON.stringify({report,activities,proposals:issues});
          const [result]=await db.query(`INSERT IGNORE INTO data_archives
            (entity_type,source_id,department,owner_id,record_date,payload,archived_by)
            VALUES('daily_report',?,?,?,?,?,?)`,[String(report.id),report.department,report.user_id,report.report_date,payload,req.user.id]);
          archived.daily_report+=Number(result.affectedRows||0);
        }
      }else if(policy.entity_type==='report_issue'){
        const [issues]=await db.query(`SELECT ri.*,agent.department,agent.last_name AS agent_name,
            agent.username,dr.user_id AS owner_id,dr.report_date,DATE(ri.created_at) AS proposal_date,
            ra.description AS activity_description
          FROM report_issues ri JOIN daily_reports dr ON dr.id=ri.report_id
          JOIN users agent ON agent.id=dr.user_id
          LEFT JOIN report_activities ra ON ra.id=ri.activity_id
          LEFT JOIN data_archives ar ON ar.entity_type='report_issue' AND ar.source_id=ri.id
          WHERE DATE(ri.created_at)<=? AND ar.id IS NULL
          ORDER BY ri.created_at ASC LIMIT 200`,[cutoff]);
        for(const issue of issues){
          const [result]=await db.query(`INSERT IGNORE INTO data_archives
            (entity_type,source_id,department,owner_id,record_date,payload,archived_by)
            VALUES('report_issue',?,?,?,?,?,?)`,[String(issue.id),issue.department,issue.owner_id,issue.proposal_date,JSON.stringify(issue),req.user.id]);
          archived.report_issue+=Number(result.affectedRows||0);
        }
      }else if(policy.entity_type==='notation'){
        const [notes]=await db.query(`SELECT n.*,agent.department FROM notation n
          JOIN users agent ON agent.id=n.agent_id
          LEFT JOIN data_archives ar ON ar.entity_type='notation' AND ar.source_id=n.id
          WHERE n.evaluation_date<=? AND ar.id IS NULL ORDER BY n.evaluation_date ASC LIMIT 200`,[cutoff]);
        for(const note of notes){
          const [result]=await db.query(`INSERT IGNORE INTO data_archives
            (entity_type,source_id,department,owner_id,record_date,payload,archived_by)
            VALUES('notation',?,?,?,?,?,?)`,[String(note.id),note.department,note.agent_id,note.evaluation_date,JSON.stringify(note),req.user.id]);
          archived.notation+=Number(result.affectedRows||0);
        }
      }
    }
    const total=archived.daily_report+archived.report_issue+archived.notation;
    await audit(req,'DATA_ARCHIVE_RUN',null,{archived,cutoffs:policies.map(policy=>({entityType:policy.entity_type,cutoff:isoBeforeDays(Number(policy.retention_days))}))});
    const [remaining]=await db.query(`SELECT entity_type AS entityType,COUNT(*) AS total FROM (
      SELECT 'daily_report' entity_type FROM daily_reports dr JOIN users u ON u.id=dr.user_id
        JOIN admin_retention_policies p ON p.entity_type='daily_report' AND p.is_enabled=1
        LEFT JOIN data_archives ar ON ar.entity_type='daily_report' AND ar.source_id=dr.id
        WHERE dr.report_date<=DATE_SUB(CURDATE(),INTERVAL p.retention_days DAY) AND ar.id IS NULL
      UNION ALL
      SELECT 'notation' entity_type FROM notation n JOIN admin_retention_policies p ON p.entity_type='notation' AND p.is_enabled=1
        LEFT JOIN data_archives ar ON ar.entity_type='notation' AND ar.source_id=n.id
        WHERE n.evaluation_date<=DATE_SUB(CURDATE(),INTERVAL p.retention_days DAY) AND ar.id IS NULL
      UNION ALL
      SELECT 'report_issue' entity_type FROM report_issues ri JOIN admin_retention_policies p ON p.entity_type='report_issue' AND p.is_enabled=1
        LEFT JOIN data_archives ar ON ar.entity_type='report_issue' AND ar.source_id=ri.id
        WHERE DATE(ri.created_at)<=DATE_SUB(CURDATE(),INTERVAL p.retention_days DAY) AND ar.id IS NULL
    ) pending GROUP BY entity_type`);
    return res.json({success:true,archived,total,remaining});
  }catch(error){next(error);}
};

exports.listArchives = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const [rows]=await db.query(`SELECT a.id,a.entity_type AS entityType,a.source_id AS sourceId,
      a.department,a.owner_id AS ownerId,a.record_date AS recordDate,a.archived_at AS archivedAt,
      u.last_name AS ownerName,archiver.last_name AS archivedByName
      FROM data_archives a LEFT JOIN users u ON u.id=a.owner_id
      LEFT JOIN users archiver ON archiver.id=a.archived_by
      ORDER BY a.record_date DESC,a.archived_at DESC LIMIT 500`);
    return res.json({success:true,archives:rows.map(row=>({...row,label:archiveTypes[row.entityType]||row.entityType}))});
  }catch(error){next(error);}
};

exports.getArchiveDetails = async(req,res,next)=>{
  try{
    await ensureAdminSchema();
    const [rows]=await db.query('SELECT id,entity_type AS entityType,source_id AS sourceId,payload,archived_at AS archivedAt FROM data_archives WHERE id=? LIMIT 1',[req.params.archiveId]);
    if(!rows.length)return res.status(404).json({success:false,message:'Archive introuvable.'});
    let payload;try{payload=JSON.parse(rows[0].payload);}catch(_){payload=rows[0].payload;}
    return res.json({success:true,archive:{...rows[0],payload,label:archiveTypes[rows[0].entityType]||rows[0].entityType}});
  }catch(error){next(error);}
};

exports.listSessions = async(req,res,next)=>{
  try {
    const [rows] = await db.query(`SELECT s.id,s.user_id AS userId,s.ip_address AS ipAddress,
      s.user_agent AS userAgent,s.created_at AS createdAt,s.last_seen AS lastSeen,s.expires_at AS expiresAt,
      u.username,u.last_name AS fullName,u.email,u.role
      FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at>NOW()
      ORDER BY s.last_seen DESC LIMIT 500`);
    return res.json({success:true,sessions:rows});
  } catch(error){next(error);}
};

exports.revokeSession = async(req,res,next)=>{
  try {
    const [result] = await db.query('UPDATE user_sessions SET revoked_at=NOW() WHERE id=? AND revoked_at IS NULL',[req.params.sessionId]);
    if(!result.affectedRows)return res.status(404).json({success:false,message:'Session introuvable ou déjà terminée.'});
    await audit(req,'SESSION_REVOKED',req.params.sessionId,{});
    return res.json({success:true,message:'Session déconnectée.'});
  } catch(error){next(error);}
};
