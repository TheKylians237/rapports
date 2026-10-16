const crypto = require('crypto');
const db = require('./db');

let ready;
async function ensureMovementTable() {
  if (!ready) ready = db.query(`CREATE TABLE IF NOT EXISTS material_movement_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    material_name VARCHAR(160) NOT NULL,
    movement_type ENUM('entry','exit','transfer','adjustment','maintenance','other') NOT NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    source_location VARCHAR(160) NULL,
    destination_location VARCHAR(160) NULL,
    details TEXT NULL,
    actor_id VARCHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_material_movement_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(error=>{ready=null;throw error;});
  return ready;
}
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(error=>{reviewsReady=null;throw error;});
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
      WHERE LOWER(TRIM(target.role)) IN ('manager','chef_service','chef_de_service','chef')
      ORDER BY n.evaluation_date DESC,n.updated_at DESC LIMIT 1000`);
    const [managers] = await db.query("SELECT id,last_name AS fullName,username,department FROM users WHERE is_active=1 AND LOWER(TRIM(role)) IN ('manager','chef_service','chef_de_service','chef') ORDER BY last_name");
    const [people] = await db.query("SELECT id,last_name AS fullName,username,role,department FROM users WHERE is_active=1 AND LOWER(TRIM(role)) IN ('agent','manager','chef_service','chef_de_service','chef') ORDER BY last_name");
    await ensureReviewsTable();
    const [reviews] = await db.query(`SELECT r.id,r.review_text AS reviewText,r.created_at AS createdAt,
      target.id AS targetId,target.last_name AS targetName,target.username AS targetUsername,target.role AS targetRole,
      author.last_name AS reviewerName FROM big_manager_reviews r JOIN users target ON target.id=r.target_user_id
      JOIN users author ON author.id=r.reviewer_id ORDER BY r.created_at DESC,r.id DESC LIMIT 500`);
    await ensureMovementTable();
    const [movements] = await db.query(`SELECT m.id,m.material_name AS materialName,m.movement_type AS movementType,m.quantity,
      m.source_location AS sourceLocation,m.destination_location AS destinationLocation,m.details,
      m.created_at AS createdAt,u.last_name AS actorName FROM material_movement_logs m
      LEFT JOIN users u ON u.id=m.actor_id ORDER BY m.created_at DESC,m.id DESC LIMIT 500`);
    return res.json({success:true,activities:rows,ratings,managers,people,reviews,movements});
  } catch(error){next(error);}
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
    const [target] = await db.query("SELECT id FROM users WHERE id=? AND is_active=1 AND LOWER(TRIM(role)) IN ('manager','chef_service','chef_de_service','chef')",[managerId]);
    if (!target.length) return res.status(404).json({success:false,message:'Manager actif introuvable.'});
    const id=crypto.randomUUID();
    await db.query(`INSERT INTO notation(id,agent_id,manager_id,evaluation_date,rating,comment)
      VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE rating=VALUES(rating),comment=VALUES(comment),updated_at=CURRENT_TIMESTAMP`,
      [id,managerId,req.user.id,date,Number(rating),String(comment).trim()]);
    return res.json({success:true,message:'Notation journalière enregistrée.'});
  } catch(error){next(error);}
};

exports.createMovement = async (req,res,next) => {
  try {
    const {materialName,movementType,quantity,sourceLocation,destinationLocation,details}=req.body||{};
    const types=['entry','exit','transfer','adjustment','maintenance','other'];
    if(!String(materialName||'').trim()||String(materialName).length>160||!types.includes(movementType)||!Number.isFinite(Number(quantity))||String(details||'').length>3000)
      return res.status(400).json({success:false,message:'Vérifiez le matériel, le type de mouvement et la quantité.'});
    await ensureMovementTable();
    const [result]=await db.query(`INSERT INTO material_movement_logs(material_name,movement_type,quantity,source_location,destination_location,details,actor_id)
      VALUES(?,?,?,?,?,?,?)`,[String(materialName).trim(),movementType,Number(quantity),String(sourceLocation||'').slice(0,160)||null,String(destinationLocation||'').slice(0,160)||null,String(details||'').trim()||null,req.user.id]);
    return res.status(201).json({success:true,id:result.insertId});
  } catch(error){next(error);}
};

exports.listMovements = async (req,res,next) => {
  try {
    await ensureMovementTable();
    const [rows]=await db.query(`SELECT m.id,m.material_name AS materialName,m.movement_type AS movementType,m.quantity,
      m.source_location AS sourceLocation,m.destination_location AS destinationLocation,m.details,m.created_at AS createdAt,
      u.last_name AS actorName,u.username FROM material_movement_logs m LEFT JOIN users u ON u.id=m.actor_id
      ORDER BY m.created_at DESC,m.id DESC LIMIT 500`);
    return res.json({success:true,movements:rows});
  } catch(error){next(error);}
};
