const db = require('./db'); // Import du pool de connexion MySQL/PostgreSQL
const bcrypt = require('bcrypt'); // Assurez-vous d'avoir installé bcrypt / bcryptjs
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');



function ObtenirTempsCompact() {
  const now = new Date();
  
  const temps = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  return temps;
}

// Exemple d'utilisation :
const temps = ObtenirTempsCompact();
 // Résultat : "20261006154437"


/**
 * Récupère les données principales du dashboard (KPIs + Historique filtré)
 /**
 * Récupère les données principales du dashboard (KPIs + Historique filtré)
 */
exports.getDashboardData = async (req, res) => {
  try {
    // 1. Extraction des paramètres (sans la période)
    const user_id = req.user?.id;
    const { search = '', status = '' } = req.query;

    // 2. Requête Statistiques (KPIs) globales
    let statsSql = `
      SELECT 
        COALESCE(SUM(total_hours), 0) AS total_hours,
        COUNT(id) AS total_reports,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN status IN ('pending','submitted') THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
      FROM daily_reports r
    `;

    const statsParams = [];

    if (user_id) {
      statsSql += ` WHERE r.user_id = ?`;
      statsParams.push(user_id);
    }

    const [statsRows] = await db.query(statsSql, statsParams);
    const stats = statsRows[0] || {
      total_hours: 0,
      total_reports: 0,
      approved_count: 0,
      pending_count: 0,
      rejected_count: 0
    };

    // 3. Requête Historique des rapports (sans aucune restriction de date)
    let reportsSql = `
      SELECT 
        r.id,
        r.user_id,
        r.report_date,
        r.report_hours,
        r.total_hours,
        r.status,
        r.next_day_targets,
        r.general_comments,
        r.created_at,
        u.last_name,
        u.username,
        u.avatar_url
      FROM daily_reports r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;

    const reportsParams = [];

    if (user_id) {
      reportsSql += ` AND r.user_id = ?`;
      reportsParams.push(user_id);
    }

    if (status) {
        reportsSql += ` AND (r.status = ? OR (? = 'pending' AND r.status = 'submitted'))`;
        reportsParams.push(status);
        reportsParams.push(status);
    }

    if (search && search.trim() !== '') {
      reportsSql += ` AND (u.last_name LIKE ? OR u.username LIKE ? OR r.general_comments LIKE ? OR r.next_day_targets LIKE ?)`;
      const searchPattern = `%${search.trim()}%`;
      reportsParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    reportsSql += ` ORDER BY r.report_date DESC, r.created_at DESC LIMIT 50`;

    const [reports] = await db.query(reportsSql, reportsParams);

    // 4. Réponse JSON
    return res.status(200).json({
      success: true,
      stats,
      reports
    });

  } catch (error) {
    console.error('❌ ERREUR SERVEUR (getDashboardData):', error.message);
    console.error(error);

    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des rapports.'
    });
  }
};

/**
 * Enregistre un nouveau rapport journalier
 */
const createCanonicalDailyReport = async ({ userId, submittedTo = null, reportDate, totalHours, comments, nextDayTargets, activities }) => {
  const connection = await db.getConnection();
  const reportId = crypto.randomUUID();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO daily_reports
        (id, user_id, submitted_to, report_date, total_hours, status, next_day_targets, general_comments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, NOW(), NOW())`,
      [reportId, userId, submittedTo, reportDate, totalHours, nextDayTargets || null, comments || null]
    );
    for (const activity of activities) {
      await connection.execute(
        `INSERT INTO report_activities
          (daily_report_id, description, objectives, category, status, obsevations, hours)
          VALUES (?, ?, ?, ?, 'Pending', ?, ?)`,
        [reportId, activity.description, activity.objectives || null, activity.category, activity.observations || null, activity.hours]
      );
    }
    await connection.commit();
    return reportId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

exports.storeReport = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { report_date, date, submitted_to: submittedTo, manager_id: managerId, general_comments: comments = '', next_day_targets: nextDayTargets = '', activities = [] } = req.body;
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reportDate = report_date || date || localToday;
    if (!userId) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    const recipientId = String(submittedTo || managerId || '').trim();
    if (!recipientId) return res.status(400).json({ success: false, message: 'Choisissez le chef de service destinataire du rapport.' });
    const [recipientRows] = await db.query(
      `SELECT manager.id
         FROM users agent
         JOIN users manager ON manager.department = agent.department
        WHERE agent.id = ? AND LOWER(TRIM(agent.role)) = 'agent'
          AND agent.is_active = 1 AND manager.id = ? AND manager.is_active = 1
          AND LOWER(REPLACE(REPLACE(TRIM(manager.role), ' ', '_'), '-', '_')) IN ('manager','chef_service','chef_de_service','chef')
        LIMIT 1`,
      [userId, recipientId]
    );
    if (!recipientRows.length) return res.status(400).json({ success: false, message: 'Le destinataire doit être un chef de service actif de votre département.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return res.status(400).json({ success: false, message: 'Date de rapport invalide.' });
    if (!Array.isArray(activities) || activities.length === 0) return res.status(400).json({ success: false, message: 'Ajoutez au moins une activité au rapport.' });
    const normalizedActivities = activities.map((activity) => ({
      description: String(activity.description || '').trim().slice(0, 255),
      objectives: String(activity.objectives || '').trim(),
      observations: String(activity.observations || activity.obsevations || '').trim(),
      category: String(activity.category || 'Autre').trim().slice(0, 100),
      hours: Number(activity.hours),
    }));
    if (normalizedActivities.some(a => !a.description || !Number.isFinite(a.hours) || a.hours <= 0)) {
      return res.status(400).json({ success: false, message: 'Chaque activité doit avoir une description et une durée positive.' });
    }
    const totalHours = normalizedActivities.reduce((sum, a) => sum + a.hours, 0);
    const reportId = await createCanonicalDailyReport({ userId, submittedTo: recipientId, reportDate, totalHours, comments, nextDayTargets, activities: normalizedActivities });
    return res.status(201).json({ success: true, message: 'Rapport et activités soumis avec succès.', report_id: reportId, reportId });
  } catch (error) {
    console.error('Erreur lors de l’enregistrement du rapport journalier :', error);
    const duplicate = error.code === 'ER_DUP_ENTRY';
    return res.status(duplicate ? 409 : 500).json({
      success: false,
      message: duplicate ? 'Un rapport existe déjà pour cette date.' : 'Erreur serveur lors de la création du rapport.',
      errorDetails: error.sqlMessage || error.message
    });
  }
};

// Liste les activités de l'agent afin qu'une proposition cible une activité précise.
exports.getAgentActivitiesForProposal = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    const [users] = await db.query(
      "SELECT id FROM users WHERE id = ? AND is_active = 1 AND LOWER(TRIM(role)) = 'agent' LIMIT 1",
      [userId]
    );
    if (!users.length) return res.status(403).json({ success: false, message: 'Cette liste est réservée aux agents actifs.' });
    const [activities] = await db.query(
      `SELECT ra.id, ra.description, ra.category, ra.hours, dr.id AS reportId,
              dr.report_date AS reportDate
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
        WHERE dr.user_id = ?
        ORDER BY dr.report_date DESC, ra.created_at DESC, ra.id DESC
        LIMIT 200`, [userId]
    );
    return res.json({
      success: true,
      activities: activities.map(activity => ({ ...activity, reportDate: formatSqlDate(activity.reportDate) })),
    });
  } catch (error) {
    console.error('Erreur dans getAgentActivitiesForProposal:', error);
    next(error);
  }
};

// Enregistre une proposition séparément et la rattache à l'activité choisie.
exports.storeReportIssue = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const activityId = Number.parseInt(req.body?.activity_id, 10);
    const issueDescription = String(req.body?.issue_description || '').trim();
    const proposedSolution = String(req.body?.proposed_solution || '').trim();
    const needsManagerHelp = req.body?.needs_manager_help ? 1 : 0;
    if (!userId) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    if (!Number.isSafeInteger(activityId) || activityId < 1 || !issueDescription) {
      return res.status(400).json({ success: false, message: 'Sélectionnez une activité et décrivez la difficulté ou le besoin.' });
    }
    const [activities] = await db.query(
      `SELECT dr.id AS reportId
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
        WHERE ra.id = ? AND dr.user_id = ? LIMIT 1`,
      [activityId, userId]
    );
    if (!activities.length) return res.status(404).json({ success: false, message: 'L’activité choisie est introuvable dans votre historique.' });
    const reportId = activities[0].reportId;
    const issueId = crypto.randomUUID();
    await db.query(
      `INSERT INTO report_issues (id, report_id, activity_id, issue_description, proposed_solution, needs_manager_help)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [issueId, reportId, activityId, issueDescription, proposedSolution || null, needsManagerHelp]
    );
    return res.status(201).json({ success: true, message: 'Proposition soumise séparément avec succès.', issueId });
  } catch (error) {
    console.error('Erreur lors de la soumission de la proposition :', error);
    next(error);
  }
};

// Historique des propositions de l'agent connecté.
exports.getMyReportIssues = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    const search = String(req.query.search || '').trim().slice(0, 120);
    const status = String(req.query.status || '').trim().toLowerCase();
    const conditions = ['dr.user_id = ?'];
    const params = [userId];
    if (['pending', 'approved', 'rejected'].includes(status)) {
      conditions.push('LOWER(TRIM(ri.status)) = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(ri.issue_description LIKE ? OR ri.proposed_solution LIKE ? OR ri.review_comment LIKE ? OR ra.description LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    const [rows] = await db.query(
      `SELECT ri.id, ri.issue_description AS description, ri.proposed_solution AS proposedSolution,
              ri.status, ri.review_comment AS reviewComment, ri.created_at AS createdAt,
              ri.reviewed_at AS reviewedAt, ri.needs_manager_help AS needsManagerHelp,
              ra.description AS activityDescription, dr.report_date AS reportDate,
              reviewer.last_name AS reviewerName
         FROM report_issues ri
         JOIN daily_reports dr ON dr.id = ri.report_id
         LEFT JOIN report_activities ra ON ra.id = ri.activity_id
         LEFT JOIN users reviewer ON reviewer.id = ri.reviewed_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY ri.created_at DESC, ri.id DESC LIMIT 200`, params
    );
    return res.json({ success: true, proposals: rows.map(row => ({ ...row, reportDate: formatSqlDate(row.reportDate) })) });
  } catch (error) {
    console.error('Erreur dans getMyReportIssues:', error);
    next(error);
  }
};

// File de traitement des propositions des agents du département.
exports.getChefServiceReportIssues = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });
    const search = String(req.query.search || '').trim().slice(0, 120);
    const status = String(req.query.status || '').trim().toLowerCase();
    const conditions = ["agent.department = ?", "LOWER(TRIM(agent.role)) = 'agent'"];
    const params = [department];
    if (['pending', 'approved', 'rejected'].includes(status)) {
      conditions.push('LOWER(TRIM(ri.status)) = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(agent.last_name LIKE ? OR agent.username LIKE ? OR ri.issue_description LIKE ? OR ri.proposed_solution LIKE ? OR ra.description LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }
    const [rows] = await db.query(
      `SELECT ri.id, ri.issue_description AS description, ri.proposed_solution AS proposedSolution,
              ri.status, ri.review_comment AS reviewComment, ri.created_at AS createdAt,
              ri.reviewed_at AS reviewedAt, ri.needs_manager_help AS needsManagerHelp,
              ra.description AS activityDescription, dr.report_date AS reportDate,
              agent.id AS agentId, agent.last_name AS agentName, agent.username,
              reviewer.last_name AS reviewerName
         FROM report_issues ri
         JOIN daily_reports dr ON dr.id = ri.report_id
         JOIN users agent ON agent.id = dr.user_id
         LEFT JOIN report_activities ra ON ra.id = ri.activity_id
         LEFT JOIN users reviewer ON reviewer.id = ri.reviewed_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY CASE WHEN LOWER(TRIM(ri.status)) = 'pending' THEN 0 ELSE 1 END,
                 ri.created_at DESC, ri.id DESC LIMIT 300`, params
    );
    return res.json({ success: true, proposals: rows.map(row => ({ ...row, reportDate: formatSqlDate(row.reportDate) })) });
  } catch (error) {
    console.error('Erreur dans getChefServiceReportIssues:', error);
    next(error);
  }
};

// Le motif de rejet est exigé et les décisions ne s'appliquent qu'aux propositions en attente.
exports.decideChefServiceReportIssue = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });
    const issueId = String(req.params.issueId || '').trim();
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    const reviewComment = String(req.body?.review_comment || '').trim().slice(0, 5000);
    if (!issueId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Décision invalide.' });
    }
    if (decision === 'rejected' && !reviewComment) {
      return res.status(400).json({ success: false, message: 'Un avis est obligatoire pour rejeter une proposition.' });
    }
    const [result] = await db.query(
      `UPDATE report_issues ri
         JOIN daily_reports dr ON dr.id = ri.report_id
         JOIN users agent ON agent.id = dr.user_id
          SET ri.status = ?, ri.reviewed_by = ?, ri.reviewed_at = NOW(), ri.review_comment = ?
        WHERE ri.id = ? AND agent.department = ? AND LOWER(TRIM(agent.role)) = 'agent'
          AND LOWER(TRIM(ri.status)) = 'pending'`,
      [decision === 'approved' ? 'Approved' : 'Rejected', req.user.id, reviewComment || null, issueId, department]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, message: 'Proposition introuvable ou déjà traitée dans votre département.' });
    }
    return res.json({ success: true, status: decision === 'approved' ? 'Approved' : 'Rejected' });
  } catch (error) {
    console.error('Erreur dans decideChefServiceReportIssue:', error);
    next(error);
  }
};

// dashesController.js

exports.getAgentStats = async (req, res) => {
  try {
    const user_id = req.user?.id;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant user_id est requis."
      });
    }

    // 1. Récupération de la date de création du compte
    const [users] = await db.query(
      'SELECT created_at FROM users WHERE id = ?',
      [user_id]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Utilisateur introuvable (${user_id})`
      });
    }

    const dateCreation = new Date(users[0].created_at);
    const dateFin = new Date();

    // -------------------------------------------------------------
    // STAT 1 : HEURES TRAVAILLÉES ET POURCENTAGE
    // -------------------------------------------------------------
    const [reportsHours] = await db.query(
      'SELECT SUM(total_hours) AS totalHeures FROM daily_reports WHERE user_id = ?',
      [user_id]
    );
    const totalHeures = parseFloat(reportsHours[0].totalHeures) || 0;

    const diffMs = dateFin - dateCreation;
    const msParSemaine = 1000 * 60 * 60 * 24 * 7;
    const semainesEcoulees = diffMs > 0 ? diffMs / msParSemaine : 0;
    const heuresTheoriques = semainesEcoulees * 35; // Base de 35h/semaine
    
    let pctHeures = 0;
    if (heuresTheoriques > 0) {
      pctHeures = (totalHeures / heuresTheoriques) * 100;
    }

    // -------------------------------------------------------------
    // STAT 2 : ACTIVITÉS TERMINÉES (report_activities JOIN daily_reports)
    // -------------------------------------------------------------
    const [taskStats] = await db.query(
      `SELECT 
        COUNT(ra.id) AS totalTasks,
        SUM(CASE WHEN LOWER(ra.status) IN ('completed', 'terminee', 'terminée', 'done') THEN 1 ELSE 0 END) AS completedTasks
       FROM report_activities ra
       INNER JOIN daily_reports dr ON ra.daily_report_id = dr.id
       WHERE dr.user_id = ?`,
      [user_id]
    );

    const totalTasks = taskStats[0].totalTasks || 0;
    const completedTasks = taskStats[0].completedTasks || 0;
    
    let pctTasks = 0;
    if (totalTasks > 0) {
      pctTasks = (completedTasks / totalTasks) * 100;
    }

    // -------------------------------------------------------------
    // STAT 3 : DIFFICULTÉS SIGNALÉES (table report_issues JOIN daily_reports)
    // -------------------------------------------------------------
    const [issueStats] = await db.query(
      `SELECT 
        COUNT(ri.id) AS totalIssues,
        SUM(CASE WHEN ri.needs_manager_help = 1 OR ri.needs_manager_help = true THEN 1 ELSE 0 END) AS needsHelp
       FROM report_issues ri
       INNER JOIN daily_reports dr ON ri.report_id = dr.id
       WHERE dr.user_id = ? AND ri.created_at >= ?`,
      [user_id, users[0].created_at]
    );

    const totalIssues = issueStats[0].totalIssues || 0;
    const needsHelpCount = issueStats[0].needsHelp || 0;

    // -------------------------------------------------------------
    // REPONSE ENVOYÉE AU FRONTEND
    // -------------------------------------------------------------
    return res.status(200).json({
      success: true,
      data: {
        userId: user_id,
        heures: {
          totales: Math.round(totalHeures * 10) / 10,
          pourcentage: Math.round(pctHeures * 10) / 10
        },
        taches: {
          terminees: completedTasks,
          totales: totalTasks,
          pourcentage: Math.round(pctTasks * 10) / 10
        },
        difficultes: {
          totales: totalIssues,
          necessiteAssistance: needsHelpCount
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur serveur lors du calcul des statistiques :', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des statistiques.'
    });
  }
};



/**
 * Récupère le profil d'un utilisateur par son ID
 */
exports.getProfile = async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant utilisateur (user_id) est requis."
      });
    }

    // Sélection des champs nécessaires (exclut password_hash)
    const sql = `
      SELECT 
        id, last_name, username, email, phone, 
        role, department, job_title, bio, avatar_url
      FROM users 
      WHERE id = ?
    `;

    const [rows] = await db.query(sql, [user_id]);
       
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé."
      });
    }

    return res.status(200).json({
      success: true,
      user: rows[0]
    });
   
  } catch (error) {
    console.error('❌ ERREUR SERVEUR (getProfile):', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil.'
    });
  }
};

/**
 * Met à jour les informations du profil
 */
exports.updateProfile = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const { last_name, email, phone, jobtitle, bio } = req.body;
    if (!user_id || !last_name || !email || String(last_name).trim().length > 50 || String(email).trim().length > 120 || String(bio || '').length > 5000) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant utilisateur est requis."
      });
    }

    const sql = `
      UPDATE users 
      SET last_name = ?, email = ?, phone = ?, job_title = ?, bio = ?
      WHERE id = ?
    `;

    await db.query(sql, [String(last_name).trim(), String(email).trim().toLowerCase(), phone ? String(phone).trim().slice(0, 30) : null, jobtitle ? String(jobtitle).trim().slice(0, 100) : null, bio || null, user_id]);

    return res.status(200).json({
      success: true,
      message: 'Profil mis à jour avec succès.'
    });

  } catch (error) {
    console.error('❌ ERREUR SERVEUR (updateProfile):', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du profil.'
    });
  }
};


/**
 * Changement sécurisé de mot de passe
 */
exports.changePassword = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!user_id || !currentPassword || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont obligatoires.'
      });
    }

    // 1. Récupération du mot de passe haché de l'utilisateur
    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [user_id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé.'
      });
    }

    const user = rows[0];

    // 2. Vérification du mot de passe actuel
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Le mot de passe actuel est incorrect.'
      });
    }

    // 3. Hachage du nouveau mot de passe
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // 4. Mise à jour dans la base de données
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, user_id]);

    return res.status(200).json({
      success: true,
      message: 'Mot de passe mis à jour avec succès.'
    });

  } catch (error) {
    console.error('❌ ERREUR SERVEUR (changePassword):', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du changement de mot de passe.'
    });
  }
};


/**
 * Calcule le hash MD5 d'un fichier de façon sécurisée
 */
function getFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  // Utilisation directe du module crypto de Node.js
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
}

exports.chargeAvatar = async (req, res) => {
  try {
    const user_id = req.user?.id;
    const file = req.file; // Fichier temporaire enregistré par Multer

    if (!user_id || !file) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({
        success: false,
        message: "L'identifiant (user_id) et le fichier image sont requis."
      });
    }

    const uploadDir = path.join(__dirname, '../img');
    const tempFilePath = file.path;
    const uploadedHash = getFileHash(tempFilePath);
    const fileExt = path.extname(file.originalname).toLowerCase();

    let existingFileName = null;

    // 1. Parcourir tous les fichiers du dossier /img pour vérifier si un contenu identique existe déjà
    const files = fs.readdirSync(uploadDir);

    for (const f of files) {
      // On ignore le fichier temporaire en cours d'analyse
      if (f.startsWith('temp-')) continue;

      const currentFilePath = path.join(uploadDir, f);

      // Si c'est un fichier valide, on compare son hash MD5
      if (fs.statSync(currentFilePath).isFile()) {
        const currentHash = getFileHash(currentFilePath);

        if (uploadedHash === currentHash) {
          // 🎯 Une image identique existe déjà dans le dossier !
          existingFileName = f;
          break;
        }
      }
    }

    let finalAvatarUrl = '';

    if (existingFileName) {
      // 2. L'IMAGE EXISTE DÉJÀ : On supprime le fichier temporaire et on réutilise l'existante
      fs.unlinkSync(tempFilePath);
      finalAvatarUrl = `/img/${existingFileName}`;
      console.log(`ℹ️ Image existante réutilisée : ${existingFileName}`);
    } else {
      // 3. L'IMAGE EST NOUVELLE : On renomme le fichier temporaire avec un nom définitif propre
      const newFileName = `avatar-${uploadedHash.substring(0, 10)}${fileExt}`;
      const finalFilePath = path.join(uploadDir, newFileName);

      fs.renameSync(tempFilePath, finalFilePath);
      finalAvatarUrl = `/img/${newFileName}`;
      console.log(`✅ Nouvelle image enregistrée : ${newFileName}`);
    }

    // 4. Mise à jour du chemin en Base de Données
    const sql = 'UPDATE users SET avatar_url = ? WHERE id = ?';
    await db.query(sql, [finalAvatarUrl, user_id]);

    return res.status(200).json({
      success: true,
      message: existingFileName ? 'Image existante réutilisée avec succès !' : 'Nouvelle photo enregistrée avec succès !',
      avatar_url: finalAvatarUrl
    });

  } catch (error) {
    console.error('❌ ERREUR SERVEUR (chargeAvatar) :', error);

    // En cas d'erreur, on nettoie le fichier temporaire
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      message: 'Erreur lors du traitement de l\'avatar.'
    });
  }
};


exports.loadAvatar = async (req, res) => {
  try {
    const user_id = req.user?.id;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant utilisateur (user_id) est requis."
      });
    }

    const sql = 'SELECT id, avatar_url FROM users WHERE id = ?';
    const [rows] = await db.query(sql, [user_id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé.'
      });
    }

    const user = rows[0];

    // Valeur par défaut si aucun avatar n'est enregistré en BDD
    const defaultAvatar = 'https://api.dicebear.com/7.x/bottts/svg?seed=Agent';

    return res.status(200).json({
      success: true,
      avatar_url: user.avatar_url || defaultAvatar
    });

  } catch (error) {
    console.error('❌ ERREUR SERVEUR (loadAvatar) :', error.message);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur lors de la récupération de l'avatar."
    });
  }
};

/**
 * Enregistre un rapport journalier et ses activités liées
 * Route: POST /api/auth/save-task
 */
exports.saveTask = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { date, activities = [], comments = '' } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    if (!Array.isArray(activities) || !activities.length) return res.status(400).json({ success: false, message: 'Au moins une activité est requise pour soumettre un rapport.' });
    const normalizedActivities = activities.map(activity => ({
      description: String(activity.description || '').trim().slice(0, 255),
      objectives: String(activity.objectives || '').trim(),
      observations: String(activity.observations || activity.obsevations || '').trim(),
      category: String(activity.category || 'Autre').trim().slice(0, 100),
      hours: Number(activity.hours),
    }));
    if (normalizedActivities.some(a => !a.description || !Number.isFinite(a.hours) || a.hours <= 0)) {
      return res.status(400).json({ success: false, message: 'Chaque activité doit avoir une description et une durée positive.' });
    }
    const reportDate = date || new Date().toISOString().slice(0, 10);
    const totalHours = normalizedActivities.reduce((sum, activity) => sum + activity.hours, 0);
    const reportId = await createCanonicalDailyReport({ userId, reportDate, totalHours, comments, activities: normalizedActivities });
    return res.status(201).json({
      success: true,
      message: 'Rapport et activités soumis avec succès.',
      reportId
    });
  } catch (error) {
    console.error('Erreur lors de la soumission du rapport :', error);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({
      success: false,
      message: error.code === 'ER_DUP_ENTRY' ? 'Un rapport existe déjà pour cette date.' : 'Une erreur serveur est survenue lors de l’enregistrement du rapport.'
    });
  }
};


/**
 * Récupère les statistiques synthétiques pour un utilisateur sur une période donnée
 * GET /api/dashboard/stats/:user_id?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=all
 */
const pool = require('./db');

exports.get_dashboard_stats = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate, status } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur (user_id) est requis." });
    }

    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || dateStart;

    // 1. TEMPS TOTAL (daily_reports)
    const [totalHoursRows] = await pool.execute(
      `SELECT COALESCE(SUM(total_hours), 0) AS total_hours 
       FROM daily_reports 
       WHERE user_id = ? AND report_date BETWEEN ? AND ?`,
      [userId, dateStart, dateEnd]
    );
    const totalHours = parseFloat(totalHoursRows[0]?.total_hours || 0);

    // 2. NOMBRE DE RAPPORTS (daily_reports, source canonique)
    const [reportsCountRows] = await pool.execute(
      `SELECT COUNT(id) AS report_count 
       FROM daily_reports 
       WHERE user_id = ? AND report_date BETWEEN ? AND ?`,
      [userId, dateStart, dateEnd]
    );
    const reportCount = parseInt(reportsCountRows[0]?.report_count || 0, 10);

    // 3. ACTIVITÉS (report_activities rattachées à daily_reports)
    let actSql = `
      SELECT 
        COUNT(ra.id) AS total_activities,
        COALESCE(SUM(ra.hours), 0) AS total_act_hours,
        COALESCE(SUM(CASE WHEN LOWER(ra.status) = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN LOWER(ra.status) = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
      FROM report_activities ra
      INNER JOIN daily_reports r ON ra.daily_report_id = r.id
      WHERE r.user_id = ? AND r.report_date BETWEEN ? AND ?
    `;

    const actParams = [userId, dateStart, dateEnd];

    if (status && status !== 'all') {
      actSql += ` AND ra.status = ?`;
      actParams.push(status);
    }

    const [actRows] = await pool.execute(actSql, actParams);
    const totalActivities = parseInt(actRows[0]?.total_activities || 0, 10);
    const totalActHours = parseFloat(actRows[0]?.total_act_hours || 0);
    const pendingCount = parseInt(actRows[0]?.pending_count);
    
    const completedCount = parseInt(actRows[0]?.completed_count || 0, 10);

    const avgHours = totalActivities > 0 ? (totalActHours / totalActivities) : 0;

    // 4. Commentaires des rapports journaliers
    const [commentsRows] = await pool.execute(
      `SELECT COUNT(id) AS comments_count 
       FROM daily_reports 
       WHERE user_id = ? 
         AND report_date BETWEEN ? AND ? 
         AND general_comments IS NOT NULL 
         AND TRIM(general_comments) != ''`,
      [userId, dateStart, dateEnd]
    );
    const commentsNumber = parseInt(commentsRows[0]?.comments_count || 0, 10);

    return res.status(200).json({
      totalHours,
      reportCount,
      avgHours,
      pendingCount,
      completedCount,
      taskNumber: reportCount,
      commentsNumber
    });

  } catch (error) {
    console.error('Erreur SQL dans get_dashboard_stats :', error);
    return res.status(500).json({ 
      error: 'Erreur serveur lors de la récupération des données.',
      details: error.message 
    });
  }
};


/**
 * Récupère les activités pour la répartition horaire
 * GET /api/auth/hourly-chart-data?user_id=usr_...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
exports.get_hourly_chart_data = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur est requis." });
    }

    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || dateStart;

    // Requête SQL pour extraire l'heure (HH:mm) et la durée (hours) depuis report_activities
    const sql = `
      SELECT 
        TIME_FORMAT(ra.created_at, '%H:%i') AS time,
        CAST(ra.hours AS DECIMAL(4,2)) AS duration
      FROM report_activities ra
      INNER JOIN daily_reports r ON ra.daily_report_id = r.id
      WHERE r.user_id = ? 
        AND DATE(r.report_date) BETWEEN ? AND ?
      ORDER BY ra.created_at ASC
    `;

    const [rows] = await pool.execute(sql, [userId, dateStart, dateEnd]);

    // Formatage des durées sous forme de nombre float
    const formattedData = rows.map(item => ({
      time: item.time || "00:00",
      duration: parseFloat(item.duration) || 0
    }));

    return res.status(200).json(formattedData);

  } catch (error) {
    console.error('Erreur SQL lors de la récupération des activités :', error);
    return res.status(500).json({ error: 'Erreur serveur lors du chargement du graphique.' });
  }
};

/**
 * Récupère l'état des rapports pour la section des statistiques
 * GET /api/auth/report-status?user_id=usr_...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
exports.get_report_status = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur est requis." });
    }

    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || dateStart;

    // Comptage des rapports par statut dans daily_reports
    const sql = `
      SELECT 
        SUM(CASE WHEN LOWER(status) IN ('validé', 'valide', 'approved', 'validated') THEN 1 ELSE 0 END) AS approved_count,
        SUM(CASE WHEN LOWER(status) IN ('en attente', 'pending', 'submitted') THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN LOWER(status) IN ('rejeté', 'rejete', 'rejected') THEN 1 ELSE 0 END) AS rejected_count,
        COUNT(id) AS total_count
      FROM daily_reports
      WHERE user_id = ? AND DATE(report_date) BETWEEN ? AND ?
    `;

    const [rows] = await pool.execute(sql, [userId, dateStart, dateEnd]);
    const row = rows[0] || {};

    const approved = parseInt(row.approved_count || 0, 10);
    const pending = parseInt(row.pending_count || 0, 10);
    const rejected = parseInt(row.rejected_count || 0, 10);
    const total = parseInt(row.total_count || 0, 10);

    // Calcul du taux de validation
    const validationRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    return res.status(200).json({
      approved,
      pending,
      rejected,
      total,
      validationRate
    });

  } catch (error) {
    console.error('Erreur SQL lors de la récupération de l\'état des rapports :', error);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


/**
 * Récupère les activités pour la timeline
 * GET /api/auth/timeline-activities?user_id=usr_...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=all
 */
exports.get_timeline_activities = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate, status } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur est requis." });
    }

    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || dateStart;

    let sql = `
      SELECT 
        ra.id,
        TIME_FORMAT(ra.created_at, '%H:%i') AS time,
        TIME_FORMAT(ADDTIME(ra.created_at, SEC_TO_TIME(ra.hours * 3600)), '%H:%i') AS end_time,
        ra.description AS title,
        ra.category AS objective,
        ra.hours AS duration,
        ra.status
      FROM report_activities ra
      INNER JOIN daily_reports r ON ra.daily_report_id = r.id
      WHERE r.user_id = ? AND DATE(r.report_date) BETWEEN ? AND ?
    `;

    const queryParams = [userId, dateStart, dateEnd];

    if (status && status !== 'all') {
      sql += ` AND ra.status = ?`;
      queryParams.push(status);
    }

    sql += ` ORDER BY ra.created_at ASC`;

    const [rows] = await pool.execute(sql, queryParams);

    const formattedData = rows.map(item => ({
      ...item,
      duration: parseFloat(item.duration) || 0,
      objective: item.objective || "Aucun objectif spécifié",
      status: item.status || "En attente"
    }));

    return res.status(200).json(formattedData);

  } catch (error) {
    console.error('Erreur lors du chargement de la timeline :', error);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


/**
 * Récupère les objectifs des rapports journaliers
 * GET /api/auth/objectives?user_id=usr_...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
exports.get_objectives = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur est requis." });
    }

    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || dateStart;

    const sql = `
      SELECT ra.objectives AS comments
        FROM report_activities ra
        JOIN daily_reports dr ON dr.id = ra.daily_report_id
       WHERE dr.user_id = ?
         AND DATE(dr.report_date) BETWEEN ? AND ?
         AND ra.objectives IS NOT NULL
         AND TRIM(ra.objectives) <> ''
       GROUP BY ra.objectives
       ORDER BY MIN(ra.created_at) ASC
    `;

    const [rows] = await pool.execute(sql, [userId, dateStart, dateEnd]);

    // Extraction de la liste des commentaires
    const objectivesList = rows.map(r => r.comments);

    return res.status(200).json(objectivesList);

  } catch (error) {
    console.error('Erreur lors de la récupération des objectifs :', error);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


/**
 * Génère la synthèse professionnelle sur une période donnée
 * GET /api/auth/professional-summary?user_id=usr_...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
exports.get_professional_summary = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur est requis." });
    }

    const dateStart = startDate || new Date().toISOString().split('T')[0];
    const dateEnd = endDate || dateStart;

    // 1. Récupération des détails des activités (description, category/objective, status)
    const sqlActivities = `
      SELECT 
        ra.description,
        ra.category AS objective,
        ra.status
      FROM report_activities ra
      INNER JOIN daily_reports r ON ra.daily_report_id = r.id
      WHERE r.user_id = ? AND DATE(r.report_date) BETWEEN ? AND ?
    `;

    const [activities] = await pool.execute(sqlActivities, [userId, dateStart, dateEnd]);

    // 2. Récupération des remarques du rapport journalier canonique
    const sqlComments = `
      SELECT general_comments AS comments 
      FROM daily_reports 
       WHERE user_id = ? 
        AND DATE(report_date) BETWEEN ? AND ? 
        AND general_comments IS NOT NULL 
        AND TRIM(general_comments) != ''
    `;

    const [commentsRows] = await pool.execute(sqlComments, [userId, dateStart, dateEnd]);

    // Formatage des listes uniques
    const descriptions = [...new Set(activities.map(a => a.description).filter(Boolean))];
    const objectives = [...new Set(activities.map(a => a.objective).filter(Boolean))];
    const observations = [...new Set(commentsRows.map(c => c.comments).filter(Boolean))];

    // Comptage des statuts
    const completedCount = activities.filter(a => String(a.status).toLowerCase() === 'completed').length;
    const pendingCount = activities.filter(a => String(a.status).toLowerCase() === 'pending').length;

    return res.status(200).json({
      startDate: dateStart,
      endDate: dateEnd,
      descriptions: descriptions.length > 0 ? descriptions.join(', ') : 'aucune description enregistrée',
      objectives: objectives.length > 0 ? objectives.join(', ') : 'objectifs opérationnels définis',
      observations: observations.length > 0 ? observations.join(' ; ') : 'observations générales',
      completedCount,
      pendingCount,
      totalActivities: activities.length
    });

  } catch (error) {
    console.error('Erreur lors de la génération de la synthèse professionnelle :', error);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


/**
 * Récupère l'historique détaillé des activités
 * GET /api/auth/detailed-history?user_id=usr_...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=all
 */
exports.get_detailed_history = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { startDate, endDate, status } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "L'identifiant utilisateur est requis." });
    }

    const dateStart = startDate || '2026-10-01';
    const dateEnd = endDate || '2026-10-31';

    let sql = `
      SELECT 
        ra.id,
        DATE_FORMAT(ra.created_at, '%d/%m/%Y') AS date,
        TIME_FORMAT(ra.created_at, '%H:%i') AS start_time,
        TIME_FORMAT(ADDTIME(ra.created_at, SEC_TO_TIME(ra.hours * 3600)), '%H:%i') AS end_time,
        ra.description AS activity,
        COALESCE(NULLIF(ra.objectives, ''), ra.category, 'Aucun') AS objective,
        COALESCE((SELECT GROUP_CONCAT(ri.issue_description SEPARATOR '; ')
                    FROM report_issues ri WHERE ri.report_id = r.id), 'Aucune') AS difficulties,
        ra.hours AS duration,
        ra.status
      FROM report_activities ra
      INNER JOIN daily_reports r ON ra.daily_report_id = r.id
      WHERE r.user_id = ? 
        AND DATE(ra.created_at) BETWEEN ? AND ?
    `;

    const queryParams = [userId, dateStart, dateEnd];

    if (status && status !== 'all') {
      sql += ` AND LOWER(ra.status) = LOWER(?)`;
      queryParams.push(status);
    }

    sql += ` ORDER BY ra.created_at DESC`;

    const [rows] = await pool.execute(sql, queryParams);

    return res.status(200).json(rows);

  } catch (error) {
    console.error('Erreur SQL lors de la récupération de l\'historique détaillé :', error);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


const periodBounds = (period) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  if (period === 'quarter') {
    start.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
    end.setTime(start.getTime());
    end.setMonth(start.getMonth() + 3);
  } else if (period === 'year') {
    start.setMonth(0, 1);
    end.setFullYear(now.getFullYear() + 1, 0, 1);
  }

  const dateOnly = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: dateOnly(start), end: dateOnly(end) };
};

const formatSqlDate = (value) => {
  if (!value) return '—';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return '—';
};

exports.getChefServiceDashboard = async (req, res, next) => {
  try {
    const tokenUser = req.user;
    if (!tokenUser?.id) {
      return res.status(403).json({
        message: 'Utilisateur non identifié dans le jeton.',
      });
    }

    // Le JWT de connexion ne contient que id, role et email : relire le service en base.
    const [currentUsers] = await db.query(
      `SELECT id, last_name AS lastName, username, department, role, job_title AS jobTitle, is_active AS isActive
         FROM users WHERE id = ? LIMIT 1`,
      [tokenUser.id]
    );
    const user = currentUsers[0];
    const role = String(user?.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!user || !user.isActive || !user.department || !['chef_service', 'chef_de_service', 'chef', 'manager'].includes(role)) {
      return res.status(403).json({
        message: 'Votre compte actif doit être associé à un service et au rôle chef_service.',
      });
    }

    const { start, end } = periodBounds(
      ['month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'month'
    );
    const department = user.department;

    // Le dump SQL du projet et le schéma fourni en cours de conversation ne
    // portent pas les mêmes colonnes/tables d'activités. Détecter le schéma actif.
    const [columnRows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_reports'`
    );
    const dailyReportColumns = new Set(columnRows.map((row) => row.COLUMN_NAME));
    const optionalDailyFields = [
      ['report_hours', 'reportHours'], ['observations', 'observations'], ['objectives', 'objectives'],
      ['next_day_targets', 'nextDayTargets'], ['general_comments', 'generalComments'],
      ['total_hours', 'totalHours'],
    ];
    const dailyFieldSelect = optionalDailyFields
      .map(([column, alias]) => `${dailyReportColumns.has(column) ? `dr.${column}` : 'NULL'} AS ${alias}`)
      .join(', ');
    const [activityTableRows] = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('report_activities', 'report_tasks')`
    );
    const activityTables = new Set(activityTableRows.map((row) => row.TABLE_NAME));
    const activityTable = activityTables.has('report_activities') ? 'report_activities'
      : activityTables.has('report_tasks') ? 'report_tasks' : null;

    // 1. Rapports récents du service
    const [reportRows] = await db.query(
      `SELECT dr.id, dr.user_id AS userId, dr.report_date AS reportDate, ${dailyFieldSelect}, dr.status,
              dr.created_at AS createdAt, dr.updated_at AS updatedAt,
              u.last_name AS lastName, u.username, u.job_title AS jobTitle
         FROM daily_reports dr 
         JOIN users u ON u.id = dr.user_id
        WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?
          AND LOWER(dr.status) = 'submitted'
          AND (dr.submitted_to = ? OR dr.submitted_to IS NULL)
        ORDER BY dr.report_date DESC, dr.created_at DESC LIMIT 30`,
      [department, start, end, req.user.id]
    );

    // 2. Totaux des rapports
    const [totalsRows] = await db.query(
      `SELECT COUNT(*) AS reportsReceived,
              SUM(CASE WHEN LOWER(dr.status) IN ('submitted','pending','en_attente')
                        AND (dr.submitted_to = ? OR dr.submitted_to IS NULL) THEN 1 ELSE 0 END) AS pendingReports,
              SUM(CASE WHEN LOWER(dr.status) IN ('approved','validated','accepted','valide','validé') THEN 1 ELSE 0 END) AS approvedReports
         FROM daily_reports dr 
         JOIN users u ON u.id = dr.user_id
        WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?`,
      [req.user.id, department, start, end]
    );

    // 3. Équipe et rapports en attente
    const [teamRows] = await db.query(
      `SELECT u.id, u.last_name AS lastName, u.username, u.job_title AS jobTitle,
              COUNT(dr.id) AS reportsThisPeriod,
              SUM(CASE WHEN dr.id IS NOT NULL AND LOWER(dr.status) = 'submitted'
                        AND (dr.submitted_to = ? OR dr.submitted_to IS NULL) THEN 1 ELSE 0 END) AS pendingReports
         FROM users u 
         LEFT JOIN daily_reports dr ON dr.user_id = u.id AND dr.report_date >= ? AND dr.report_date < ?
        WHERE u.department = ? AND u.is_active = 1 AND LOWER(TRIM(u.role)) = 'agent'
        GROUP BY u.id, u.last_name, u.username, u.job_title 
        ORDER BY u.last_name, u.username`,
      [req.user.id, start, end, department]
    );

    // 4. Activités récentes
    let activityRows = [];
    let activityTotals = [{ total: 0, completed: 0 }];
    if (activityTable === 'report_activities') {
      // Les activités sont rattachées à l'UUID de daily_reports.
      [activityRows] = await db.query(
        `SELECT ra.id, ra.description AS title, ra.category, ra.status, ra.hours,
                ra.obsevations AS observations, dr.report_date AS reportDate, u.last_name AS agentName
           FROM report_activities ra JOIN daily_reports dr ON dr.id = ra.daily_report_id
           JOIN users u ON u.id = dr.user_id
          WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?
            AND LOWER(TRIM(ra.status)) IN ('completed','complete','done','finished','terminee','terminée','realisee','réalisée','achevee','achevée')
          ORDER BY dr.report_date DESC, ra.created_at DESC LIMIT 8`, [department, start, end]
      );
      [activityTotals] = await db.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN LOWER(TRIM(ra.status)) IN ('completed','complete','done','finished','terminee','terminée','realisee','réalisée','achevee','achevée') THEN 1 ELSE 0 END) AS completed
           FROM report_activities ra JOIN daily_reports dr ON dr.id = ra.daily_report_id
           JOIN users u ON u.id = dr.user_id
          WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?`, [department, start, end]
      );
    } else if (activityTable === 'report_tasks') {
      // Dump SQL du projet : tâches liées directement à daily_reports.id (UUID).
      [activityRows] = await db.query(
        `SELECT rt.id, rt.title, rt.category, rt.task_status AS status,
                rt.duration_hours AS hours, rt.description,
                dr.report_date AS reportDate, u.last_name AS agentName
           FROM report_tasks rt JOIN daily_reports dr ON dr.id = rt.report_id
           JOIN users u ON u.id = dr.user_id
          WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?
            AND LOWER(TRIM(rt.task_status)) IN ('completed','complete','done','finished','terminee','terminée','realisee','réalisée','achevee','achevée')
          ORDER BY dr.report_date DESC, rt.created_at DESC LIMIT 8`, [department, start, end]
      );
      [activityTotals] = await db.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN LOWER(TRIM(rt.task_status)) IN ('completed','complete','done','finished','terminee','terminée','realisee','réalisée','achevee','achevée') THEN 1 ELSE 0 END) AS completed
           FROM report_tasks rt JOIN daily_reports dr ON dr.id = rt.report_id
           JOIN users u ON u.id = dr.user_id
          WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?`, [department, start, end]
      );
    }

    // 6. Tendance
    const periodDays = Math.max(1, Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000));
    const previousStartDate = new Date(`${start}T00:00:00Z`);
    previousStartDate.setUTCDate(previousStartDate.getUTCDate() - periodDays);
    const previousStart = previousStartDate.toISOString().slice(0, 10);

    const [previousRows] = await db.query(
      `SELECT COUNT(*) AS count 
         FROM daily_reports dr 
         JOIN users u ON u.id = dr.user_id
        WHERE u.department = ? AND dr.report_date >= ? AND dr.report_date < ?`,
      [department, previousStart, start]
    );

    const totals = totalsRows[0] || {};
    const received = Number(totals.reportsReceived || 0);
    const previous = Number(previousRows[0]?.count || 0);
    const reportsChangePercent = previous ? Math.round(((received - previous) / previous) * 100) : 0;

    return res.json({
      user: {
        name: user.last_name || user.name || user.username || 'Chef de service',
        firstName: (user.last_name || user.username || 'Chef').split(/\s+/)[0],
        roleLabel: 'Chef de service',
      },
      stats: {
        reportsReceived: received,
        pendingReports: Number(totals.pendingReports || 0),
        approvedReports: Number(totals.approvedReports || 0),
        lateReports: 0,
        activitiesTotal: Number(activityTotals[0]?.total || 0),
        activitiesDone: Number(activityTotals[0]?.completed || 0),
        reportsChangePercent,
      },
      reports: reportRows.map((r) => {
        const dateStr = formatSqlDate(r.reportDate);
        return {
          id: r.id,
          title: `Rapport journalier`,
          reportDate: dateStr,
          periodLabel: dateStr,
          submittedAt: r.createdAt ? new Date(r.createdAt).toISOString() : dateStr,
          status: r.status,
          agent: {
            name: r.lastName || r.username || 'Agent',
            role: r.jobTitle || 'Agent',
          },
          objectives: r.objectives,
          observations: r.observations,
          nextDayTargets: r.nextDayTargets,
          generalComments: r.generalComments,
          totalHours: r.totalHours,
        };
      }),
      activities: activityRows.map((a) => ({
        ...a,
        progress: ['completed', 'complete', 'done', 'finished', 'réalisée', 'realisee', 'terminee', 'terminée', 'achevee', 'achevée'].includes(
          String(a.status || '').toLowerCase()
        )
          ? 100
          : 0,
      })),
      team: teamRows.map((a) => ({
        ...a,
        name: a.lastName || a.username || 'Agent',
        role: a.jobTitle || 'Agent',
        pendingReports: Number(a.pendingReports || 0),
      })),
    });
  } catch (error) {
    console.error('Erreur dans getChefServiceDashboard:', error);
    next(error);
  }
};

// Fiche et statistiques d'un agent. Le département est vérifié côté serveur
// afin qu'un chef ne puisse consulter un identifiant appartenant à un autre service.
exports.getChefServiceAgentDetails = async (req, res, next) => {
  try {
    if (!req.user?.id || !req.params.agentId) {
      return res.status(400).json({ success: false, message: 'Identifiant de l’agent manquant.' });
    }

    const [chefRows] = await db.query(
      `SELECT department, role, is_active AS isActive FROM users WHERE id = ? LIMIT 1`, [req.user.id]
    );
    const chef = chefRows[0];
    const chefRole = String(chef?.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!chef || !chef.isActive || !chef.department || !['chef_service', 'chef_de_service', 'chef', 'manager'].includes(chefRole)) {
      return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });
    }

    const [agentRows] = await db.query(
      `SELECT id, last_name AS lastName, username, email, phone, department,
              job_title AS jobTitle, bio, avatar_url AS avatarUrl, created_at AS createdAt
         FROM users
        WHERE id = ? AND department = ? AND LOWER(TRIM(role)) = 'agent'
        LIMIT 1`, [req.params.agentId, chef.department]
    );
    const agent = agentRows[0];
    if (!agent) return res.status(404).json({ success: false, message: 'Agent introuvable dans votre département.' });

    const [reportRows] = await db.query(
      `SELECT COUNT(*) AS totalReports,
              COALESCE(SUM(total_hours), 0) AS totalHours,
              SUM(CASE WHEN LOWER(status) = 'submitted'
                        AND (submitted_to = ? OR submitted_to IS NULL) THEN 1 ELSE 0 END) AS pendingReports,
              SUM(CASE WHEN LOWER(status) IN ('validated','approved') THEN 1 ELSE 0 END) AS validatedReports,
              MAX(report_date) AS lastReportDate
         FROM daily_reports WHERE user_id = ?`, [req.user.id, agent.id]
    );
    const [issueRows] = await db.query(
      `SELECT COUNT(*) AS totalIssues,
              SUM(CASE WHEN ri.needs_manager_help = 1 THEN 1 ELSE 0 END) AS needsHelp
         FROM report_issues ri JOIN daily_reports dr ON dr.id = ri.report_id
        WHERE dr.user_id = ?`, [agent.id]
    );
    const [evaluationRows] = await db.query(
      `SELECT ae.id, ae.rating, ae.comment, ae.evaluation_date AS evaluationDate,
              ae.updated_at AS updatedAt, manager.last_name AS managerName,
              manager.job_title AS managerJobTitle
         FROM notation ae
         JOIN users manager ON manager.id = ae.manager_id
        WHERE ae.agent_id = ?
        ORDER BY ae.evaluation_date DESC, ae.updated_at DESC
        LIMIT 50`, [agent.id]
    );
    const [evaluationStatsRows] = await db.query(
      'SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average FROM notation WHERE agent_id = ?',
      [agent.id]
    );

    const [activityTableRows] = await db.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('report_activities','report_tasks')`
    );
    const activityTables = new Set(activityTableRows.map(row => row.TABLE_NAME));
    let activityStats = { totalActivities: 0, completedActivities: 0 };
    if (activityTables.has('report_activities')) {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS totalActivities,
                SUM(CASE WHEN LOWER(ra.status) IN ('completed','done','terminee','terminée','réalisée','realisee') THEN 1 ELSE 0 END) AS completedActivities
           FROM report_activities ra JOIN daily_reports dr ON dr.id = ra.daily_report_id
          WHERE dr.user_id = ?`, [agent.id]
      );
      activityStats = rows[0] || activityStats;
    } else if (activityTables.has('report_tasks')) {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS totalActivities,
                SUM(CASE WHEN LOWER(rt.task_status) IN ('completed','done','terminee','terminée','réalisée','realisee') THEN 1 ELSE 0 END) AS completedActivities
           FROM report_tasks rt JOIN daily_reports dr ON dr.id = rt.report_id
          WHERE dr.user_id = ?`, [agent.id]
      );
      activityStats = rows[0] || activityStats;
    }

    const reports = reportRows[0] || {};
    const issues = issueRows[0] || {};
    return res.json({
      success: true,
      agent,
      evaluations: evaluationRows.map(row => ({ ...row, evaluationDate: formatSqlDate(row.evaluationDate) })),
      evaluationStats: {
        count: Number(evaluationStatsRows[0]?.count || 0),
        average: Number(evaluationStatsRows[0]?.average || 0),
      },
      stats: {
        totalReports: Number(reports.totalReports || 0),
        totalHours: Number(reports.totalHours || 0),
        pendingReports: Number(reports.pendingReports || 0),
        validatedReports: Number(reports.validatedReports || 0),
        lastReportDate: formatSqlDate(reports.lastReportDate),
        totalActivities: Number(activityStats.totalActivities || 0),
        completedActivities: Number(activityStats.completedActivities || 0),
        totalIssues: Number(issues.totalIssues || 0),
        needsHelp: Number(issues.needsHelp || 0),
      },
    });
  } catch (error) {
    console.error('Erreur dans getChefServiceAgentDetails:', error);
    next(error);
  }
};

exports.saveChefServiceAgentEvaluation = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });
    const agentId = String(req.params.agentId || '').trim();
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim().slice(0, 5000);
    const requestedDate = String(req.body?.evaluation_date || '').trim();
    if (!agentId || !Number.isInteger(rating) || rating < 1 || rating > 5 || !comment) {
      return res.status(400).json({ success: false, message: 'Attribuez une note de 1 à 5 et rédigez un avis.' });
    }
    if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return res.status(400).json({ success: false, message: 'Date d’évaluation invalide.' });
    }
    const [agents] = await db.query(
      `SELECT id FROM users
        WHERE id = ? AND department = ? AND is_active = 1 AND LOWER(TRIM(role)) = 'agent'
        LIMIT 1`, [agentId, department]
    );
    if (!agents.length) return res.status(404).json({ success: false, message: 'Agent introuvable dans votre département.' });

    await db.query(
      `INSERT INTO notation
        (id, agent_id, manager_id, evaluation_date, rating, comment)
       VALUES (?, ?, ?, COALESCE(?, CURRENT_DATE()), ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = NOW()`,
      [crypto.randomUUID(), agentId, req.user.id, requestedDate || null, rating, comment]
    );
    return res.json({ success: true, message: 'Évaluation enregistrée.' });
  } catch (error) {
    console.error('Erreur dans saveChefServiceAgentEvaluation:', error);
    next(error);
  }
};

exports.getMyAgentEvaluations = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    const [agentRows] = await db.query(
      `SELECT id FROM users WHERE id = ? AND is_active = 1 AND LOWER(TRIM(role)) = 'agent' LIMIT 1`,
      [req.user.id]
    );
    if (!agentRows.length) return res.status(403).json({ success: false, message: 'Accès réservé aux agents actifs.' });
    const search = String(req.query.search || '').trim().slice(0, 100);
    const rating = Number.parseInt(req.query.rating, 10);
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const conditions = ['ae.agent_id = ?'];
    const params = [req.user.id];
    if (search) {
      conditions.push('(ae.comment LIKE ? OR manager.last_name LIKE ? OR manager.username LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) { conditions.push('ae.rating = ?'); params.push(rating); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { conditions.push('ae.evaluation_date >= ?'); params.push(dateFrom); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { conditions.push('ae.evaluation_date <= ?'); params.push(dateTo); }
    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT ae.id, ae.rating, ae.comment, ae.evaluation_date AS evaluationDate,
              manager.last_name AS managerName, manager.job_title AS managerJobTitle
         FROM notation ae
         JOIN users manager ON manager.id = ae.manager_id
        WHERE ${where}
        ORDER BY ae.evaluation_date DESC, ae.updated_at DESC
        LIMIT 100`, params
    );
    const [summaryRows] = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(AVG(ae.rating), 0) AS average
         FROM notation ae JOIN users manager ON manager.id = ae.manager_id
        WHERE ${where}`,
      params
    );
    return res.json({
      success: true,
      evaluations: rows.map(row => ({ ...row, evaluationDate: formatSqlDate(row.evaluationDate) })),
      count: Number(summaryRows[0]?.count || 0),
      average: Number(summaryRows[0]?.average || 0),
    });
  } catch (error) {
    console.error('Erreur dans getMyAgentEvaluations:', error);
    next(error);
  }
};

// Liste recherchable des notations du département pour le chef de service.
exports.getChefServiceEvaluations = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });
    const search = String(req.query.search || '').trim().slice(0, 100);
    const rating = Number.parseInt(req.query.rating, 10);
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const conditions = ["agent.department = ?", "LOWER(TRIM(agent.role)) = 'agent'"];
    const params = [department];
    if (search) {
      conditions.push('(agent.last_name LIKE ? OR agent.username LIKE ? OR manager.last_name LIKE ? OR n.comment LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) { conditions.push('n.rating = ?'); params.push(rating); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { conditions.push('n.evaluation_date >= ?'); params.push(dateFrom); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { conditions.push('n.evaluation_date <= ?'); params.push(dateTo); }
    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT n.id, n.evaluation_date AS evaluationDate, n.rating, n.comment,
              n.updated_at AS updatedAt, agent.id AS agentId,
              agent.last_name AS agentName, agent.username AS agentUsername,
              manager.last_name AS managerName
         FROM notation n
         JOIN users agent ON agent.id = n.agent_id
         JOIN users manager ON manager.id = n.manager_id
        WHERE ${where}
        ORDER BY n.evaluation_date DESC, n.updated_at DESC
        LIMIT 200`, params
    );
    const [summaryRows] = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(AVG(n.rating), 0) AS average
         FROM notation n
         JOIN users agent ON agent.id = n.agent_id
         JOIN users manager ON manager.id = n.manager_id
        WHERE ${where}`, params
    );
    return res.json({
      success: true,
      evaluations: rows.map(row => ({ ...row, evaluationDate: formatSqlDate(row.evaluationDate) })),
      count: Number(summaryRows[0]?.count || 0),
      average: Number(summaryRows[0]?.average || 0),
    });
  } catch (error) {
    console.error('Erreur dans getChefServiceEvaluations:', error);
    next(error);
  }
};

// Classement des agents : avancement, moyenne des notes et volume de propositions.
exports.getChefServiceAgentRankings = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });
    const search = String(req.query.search || '').trim().slice(0, 100);
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const sort = ['performance', 'rating', 'proposals'].includes(String(req.query.sort)) ? String(req.query.sort) : 'performance';
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (dateFrom && !validDate(dateFrom) || dateTo && !validDate(dateTo)) {
      return res.status(400).json({ success: false, message: 'Format de date invalide.' });
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return res.status(400).json({ success: false, message: 'La date de début doit précéder la date de fin.' });
    }
    const rangeFor = column => {
      const clauses = [];
      const params = [];
      if (dateFrom) { clauses.push(`${column} >= ?`); params.push(dateFrom); }
      if (dateTo) { clauses.push(`${column} <= ?`); params.push(dateTo); }
      return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
    };
    const activityRange = rangeFor('dr.report_date');
    const proposalRange = rangeFor('DATE(ri.created_at)');
    const evaluationRange = rangeFor('n.evaluation_date');
    const conditions = ["agent.department = ?", "agent.is_active = 1", "LOWER(TRIM(agent.role)) = 'agent'"];
    const params = [department];
    if (search) {
      conditions.push('(agent.last_name LIKE ? OR agent.username LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const orderBy = {
      performance: 'completionRate DESC, completedActivities DESC, activityHours DESC',
      rating: 'averageRating DESC, ratingCount DESC, completionRate DESC',
      proposals: 'proposalCount DESC, completionRate DESC, averageRating DESC',
    }[sort];
    const [rows] = await db.query(
      `SELECT agent.id AS agentId, agent.last_name AS agentName, agent.username,
              COALESCE(activity.reportCount, 0) AS reportCount,
              COALESCE(activity.activityCount, 0) AS activityCount,
              COALESCE(activity.completedActivities, 0) AS completedActivities,
              COALESCE(activity.activityHours, 0) AS activityHours,
              CASE WHEN COALESCE(activity.activityCount, 0) = 0 THEN 0
                   ELSE ROUND(activity.completedActivities * 100 / activity.activityCount, 1) END AS completionRate,
              COALESCE(evaluation.averageRating, 0) AS averageRating,
              COALESCE(evaluation.ratingCount, 0) AS ratingCount,
              COALESCE(proposals.proposalCount, 0) AS proposalCount
         FROM users agent
         LEFT JOIN (
           SELECT dr.user_id, COUNT(DISTINCT dr.id) AS reportCount, COUNT(ra.id) AS activityCount,
                  SUM(CASE WHEN LOWER(TRIM(ra.status)) = 'completed' THEN 1 ELSE 0 END) AS completedActivities,
                  COALESCE(SUM(ra.hours), 0) AS activityHours
             FROM daily_reports dr LEFT JOIN report_activities ra ON ra.daily_report_id = dr.id
             ${activityRange.sql}
            GROUP BY dr.user_id
         ) activity ON activity.user_id = agent.id
         LEFT JOIN (
           SELECT n.agent_id, AVG(n.rating) AS averageRating, COUNT(*) AS ratingCount
             FROM notation n ${evaluationRange.sql}
            GROUP BY n.agent_id
         ) evaluation ON evaluation.agent_id = agent.id
         LEFT JOIN (
           SELECT dr.user_id, COUNT(ri.id) AS proposalCount
             FROM report_issues ri JOIN daily_reports dr ON dr.id = ri.report_id
             ${proposalRange.sql}
            GROUP BY dr.user_id
         ) proposals ON proposals.user_id = agent.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}, agent.last_name ASC, agent.username ASC`,
      [...activityRange.params, ...evaluationRange.params, ...proposalRange.params, ...params]
    );
    return res.json({
      success: true,
      department,
      sort,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      rankings: rows.map((row, index) => ({
        ...row,
        rank: index + 1,
        reportCount: Number(row.reportCount || 0),
        activityCount: Number(row.activityCount || 0),
        completedActivities: Number(row.completedActivities || 0),
        activityHours: Number(row.activityHours || 0),
        completionRate: Number(row.completionRate || 0),
        averageRating: Number(row.averageRating || 0),
        ratingCount: Number(row.ratingCount || 0),
        proposalCount: Number(row.proposalCount || 0),
      })),
    });
  } catch (error) {
    console.error('Erreur dans getChefServiceAgentRankings:', error);
    next(error);
  }
};

exports.getAgentDepartmentChefs = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Session utilisateur invalide.' });
    const [agentRows] = await db.query(
      `SELECT department FROM users
        WHERE id = ? AND is_active = 1 AND LOWER(TRIM(role)) = 'agent'
        LIMIT 1`,
      [req.user.id]
    );
    if (!agentRows.length) return res.status(403).json({ success: false, message: 'Cette liste est réservée aux agents actifs.' });
    const [rows] = await db.query(
      `SELECT id, last_name AS name, username, job_title AS jobTitle, email, role
         FROM users
        WHERE department = ? AND is_active = 1
          AND LOWER(REPLACE(REPLACE(TRIM(role), ' ', '_'), '-', '_')) IN ('manager','chef_service','chef_de_service','chef')
        ORDER BY last_name, username`,
      [agentRows[0].department]
    );
    return res.json({ success: true, department: agentRows[0].department, managers: rows });
  } catch (error) {
    console.error('Erreur dans getAgentDepartmentChefs:', error);
    next(error);
  }
};

// Annuaire du département adapté au rôle de l'utilisateur connecté.
exports.getDepartmentColleagues = async (req, res, next) => {
  try {
    const [currentRows] = await db.query(
      `SELECT id, department, role, is_active AS isActive
         FROM users WHERE id = ? LIMIT 1`, [req.user?.id]
    );
    const current = currentRows[0];
    const role = String(current?.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const leaderRoles = ['manager', 'chef_service', 'chef_de_service', 'chef'];
    if (!current || !current.isActive || !current.department) {
      return res.status(403).json({ success: false, message: 'Profil actif et département requis.' });
    }
    let colleagueCondition;
    let audience;
    if (role === 'agent') {
      colleagueCondition = "LOWER(REPLACE(REPLACE(TRIM(role), ' ', '_'), '-', '_')) IN ('manager','chef_service','chef_de_service','chef')";
      audience = 'chefs';
    } else if (leaderRoles.includes(role)) {
      colleagueCondition = "LOWER(TRIM(role)) = 'agent'";
      audience = 'agents';
    } else {
      return res.status(403).json({ success: false, message: 'Cette liste est réservée aux agents et chefs de service.' });
    }
    const [colleagues] = await db.query(
      `SELECT id, last_name AS name, username, email, phone,
              job_title AS jobTitle, role, avatar_url AS avatarUrl
         FROM users
        WHERE department = ? AND is_active = 1 AND ${colleagueCondition}
        ORDER BY last_name, username`, [current.department]
    );
    return res.json({
      success: true,
      department: current.department,
      audience,
      colleagues: colleagues.map(colleague => ({ ...colleague, role: String(colleague.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_') })),
    });
  } catch (error) {
    console.error('Erreur dans getDepartmentColleagues:', error);
    next(error);
  }
};

const getChefServiceDepartment = async (req) => {
  const [rows] = await db.query(
    `SELECT department, role, is_active AS isActive FROM users WHERE id = ? LIMIT 1`, [req.user?.id]
  );
  const chef = rows[0];
  const role = String(chef?.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!chef || !chef.isActive || !chef.department || !['chef_service', 'chef_de_service', 'chef', 'manager'].includes(role)) return null;
  return chef.department;
};

exports.getChefServiceSynthesis = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service.' });

    const period = String(req.query.period || 'month').trim().toLowerCase();
    const validPeriods = ['day', 'week', 'month', 'quarter', 'year', 'custom'];
    if (!validPeriods.includes(period)) return res.status(400).json({ success: false, message: 'Période invalide.' });

    const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const isValidDate = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    };
    const today = new Date();
    let startDate;
    let endDate;
    if (period === 'custom') {
      startDate = String(req.query.startDate || '').trim();
      endDate = String(req.query.endDate || '').trim();
      if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
        return res.status(400).json({ success: false, message: 'Sélectionnez des dates valides et cohérentes.' });
      }
    } else {
      endDate = dateKey(today);
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (period === 'day') { /* même date de début et de fin */ }
      if (period === 'week') {
        const dayOfWeek = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - dayOfWeek);
      }
      if (period === 'month') start.setDate(1);
      if (period === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
      if (period === 'year') start.setMonth(0, 1);
      startDate = dateKey(start);
    }

    let agentIds = req.query.agentIds || [];
    if (!Array.isArray(agentIds)) agentIds = String(agentIds).split(',');
    agentIds = [...new Set(agentIds.map(id => String(id).trim()).filter(Boolean))];
    if (agentIds.length > 100) return res.status(400).json({ success: false, message: 'La sélection est limitée à 100 agents.' });

    const [departmentAgents] = await db.query(
      `SELECT id, last_name AS name, username
         FROM users
        WHERE department = ? AND is_active = 1 AND LOWER(TRIM(role)) = 'agent'
        ORDER BY last_name, username`, [department]
    );
    const selectedAgents = agentIds.length
      ? departmentAgents.filter(agent => agentIds.includes(String(agent.id)))
      : departmentAgents;
    if (agentIds.length && selectedAgents.length !== agentIds.length) {
      return res.status(400).json({ success: false, message: 'La sélection contient un agent inactif ou extérieur à votre département.' });
    }
    const selectedIds = selectedAgents.map(agent => agent.id);
    if (!selectedIds.length) {
      const emptyMetrics = { reportCount: 0, approvedReports: 0, pendingReports: 0, rejectedReports: 0, activitiesTotal: 0, completedActivities: 0, pendingActivities: 0, totalHours: 0, activeAgents: 0, selectedAgents: 0, completionRate: 0, approvalRate: 0 };
      const scope = agentIds.length ? 'la sélection' : `le département ${department}`;
      return res.json({ success: true, department, period, startDate, endDate, scope, metrics: emptyMetrics, categories: [], narrative: `Aucun agent actif n’est actuellement rattaché à ${scope}.` });
    }

    const placeholders = selectedIds.map(() => '?').join(', ');
    const params = [startDate, endDate, ...selectedIds, department];
    const [metricRows] = await db.query(
      `SELECT COUNT(DISTINCT dr.id) AS reportCount,
              COUNT(ra.id) AS activitiesTotal,
              SUM(CASE WHEN LOWER(TRIM(ra.status)) = 'completed' THEN 1 ELSE 0 END) AS completedActivities,
              SUM(CASE WHEN LOWER(TRIM(ra.status)) = 'pending' THEN 1 ELSE 0 END) AS pendingActivities,
              COALESCE(SUM(ra.hours), 0) AS totalHours,
              COUNT(DISTINCT dr.user_id) AS activeAgents,
              COUNT(DISTINCT CASE WHEN LOWER(TRIM(dr.status)) IN ('approved','validated','accepted','valide','validé') THEN dr.id END) AS approvedReports,
              COUNT(DISTINCT CASE WHEN LOWER(TRIM(dr.status)) IN ('submitted','pending','en_attente') THEN dr.id END) AS pendingReports,
              COUNT(DISTINCT CASE WHEN LOWER(TRIM(dr.status)) IN ('rejected','refused','rejete','rejeté') THEN dr.id END) AS rejectedReports
         FROM users u
         LEFT JOIN daily_reports dr ON dr.user_id = u.id AND dr.report_date BETWEEN ? AND ?
         LEFT JOIN report_activities ra ON ra.daily_report_id = dr.id
        WHERE u.id IN (${placeholders}) AND u.department = ? AND LOWER(TRIM(u.role)) = 'agent'`,
      params
    );
    const metrics = metricRows[0] || {};
    const completionRate = Number(metrics.activitiesTotal) ? Number(metrics.completedActivities || 0) / Number(metrics.activitiesTotal) * 100 : 0;
    const approvalRate = Number(metrics.reportCount) ? Number(metrics.approvedReports || 0) / Number(metrics.reportCount) * 100 : 0;
    const normalizedMetrics = {
      reportCount: Number(metrics.reportCount || 0),
      approvedReports: Number(metrics.approvedReports || 0),
      pendingReports: Number(metrics.pendingReports || 0),
      rejectedReports: Number(metrics.rejectedReports || 0),
      activitiesTotal: Number(metrics.activitiesTotal || 0),
      completedActivities: Number(metrics.completedActivities || 0),
      pendingActivities: Number(metrics.pendingActivities || 0),
      totalHours: Number(metrics.totalHours || 0),
      activeAgents: Number(metrics.activeAgents || 0),
      selectedAgents: selectedAgents.length,
      completionRate: Math.round(completionRate * 10) / 10,
      approvalRate: Math.round(approvalRate * 10) / 10,
    };

    const [categoryRows] = await db.query(
      `SELECT ra.category, COUNT(*) AS total
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
        WHERE dr.report_date BETWEEN ? AND ? AND dr.user_id IN (${placeholders})
          AND ra.category IS NOT NULL AND TRIM(ra.category) <> ''
        GROUP BY ra.category ORDER BY total DESC, ra.category ASC LIMIT 3`,
      [startDate, endDate, ...selectedIds]
    );
    const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const displayDate = value => formatter.format(new Date(`${value}T12:00:00`));
    const scope = agentIds.length === 1
      ? `l’agent ${selectedAgents[0].name || selectedAgents[0].username}`
      : agentIds.length
        ? `le groupe de ${selectedAgents.length} agents sélectionnés`
        : `l’ensemble des agents actifs du département ${department}`;
    const startLabel = displayDate(startDate);
    const endLabel = displayDate(endDate);
    const hoursLabel = `${normalizedMetrics.totalHours.toFixed(1)} heure${normalizedMetrics.totalHours === 1 ? '' : 's'}`;
    const categoryDetails = categoryRows.map(row => `${row.category} (${Number(row.total)} activité${Number(row.total) === 1 ? '' : 's'})`);
    let narrative;
    if (!normalizedMetrics.reportCount && !normalizedMetrics.activitiesTotal) {
      narrative = [
        `Périmètre et période : du ${startLabel} au ${endLabel}, l’analyse porte sur ${scope}. Aucun rapport ni aucune activité n’a été enregistré dans ce périmètre pendant la période considérée.`,
        `Lecture du bilan : en l’absence de données, il n’est pas possible de calculer un volume horaire, un taux d’achèvement ou un taux de traitement des rapports. Cette absence de résultats ne permet pas, à elle seule, de conclure à une absence de travail ; elle indique que le tableau ne dispose d’aucune saisie correspondant aux critères sélectionnés.`,
        `Point de suivi : vérifiez que les agents concernés ont transmis leurs rapports et que les dates sélectionnées couvrent bien les journées à analyser. Élargissez la période ou le groupe d’agents si nécessaire, puis actualisez la synthèse.`
      ].join('\n\n');
    } else {
      const pendingActivityRate = normalizedMetrics.activitiesTotal
        ? Math.round((normalizedMetrics.pendingActivities / normalizedMetrics.activitiesTotal) * 1000) / 10
        : 0;
      const reportStatusSummary = normalizedMetrics.reportCount
        ? `${normalizedMetrics.approvedReports} rapport${normalizedMetrics.approvedReports === 1 ? ' a été' : 's ont été'} approuvé${normalizedMetrics.approvedReports === 1 ? '' : 's'}, ${normalizedMetrics.pendingReports} ${normalizedMetrics.pendingReports === 1 ? 'reste' : 'restent'} en attente de traitement et ${normalizedMetrics.rejectedReports} ${normalizedMetrics.rejectedReports === 1 ? 'a été rejeté' : 'ont été rejetés'}. Le taux d’approbation s’établit à ${normalizedMetrics.approvalRate} % des rapports enregistrés sur la période.`
        : `Aucun rapport n’a été soumis sur la période ; le taux d’approbation n’est donc pas calculable.`;
      const categorySummary = categoryDetails.length
        ? `Les catégories les plus représentées sont : ${categoryDetails.join(' ; ')}. Ce classement décrit la répartition des activités saisies et aide à repérer les principaux domaines d’intervention.`
        : `Aucune catégorie n’est renseignée pour les activités recensées ; leur répartition thématique ne peut pas être établie à partir des données disponibles.`;
      const followUp = normalizedMetrics.pendingActivities || normalizedMetrics.pendingReports
        ? `Pour le suivi managérial, ${normalizedMetrics.pendingActivities} activité${normalizedMetrics.pendingActivities === 1 ? ' reste' : 's restent'} à achever et ${normalizedMetrics.pendingReports} rapport${normalizedMetrics.pendingReports === 1 ? ' demeure' : 's demeurent'} en attente de traitement. Ces éléments constituent les principaux points à examiner lors du prochain suivi, en tenant compte des échéances et des éventuelles observations consignées dans les rapports.`
        : `À la date de cette consultation, aucune activité n’est signalée en attente et aucun rapport ne reste à traiter dans le périmètre retenu. Le bilan peut être utilisé comme état de situation pour la période, puis comparé aux périodes précédentes pour suivre l’évolution de la charge et de l’avancement.`;
      narrative = [
        `Périmètre et période : du ${startLabel} au ${endLabel}, cette synthèse porte sur ${scope}. Elle recense ${normalizedMetrics.reportCount} rapport${normalizedMetrics.reportCount === 1 ? '' : 's'} et ${normalizedMetrics.activitiesTotal} activité${normalizedMetrics.activitiesTotal === 1 ? '' : 's'}${normalizedMetrics.selectedAgents ? ` pour ${normalizedMetrics.selectedAgents} agent${normalizedMetrics.selectedAgents === 1 ? '' : 's'} dans le périmètre sélectionné` : ''}. Le temps déclaré représente un total de ${hoursLabel}. Ces indicateurs décrivent les saisies enregistrées dans l’application pour la période choisie.`,
        `Avancement des activités : ${normalizedMetrics.completedActivities} activité${normalizedMetrics.completedActivities === 1 ? ' est' : 's sont'} terminée${normalizedMetrics.completedActivities === 1 ? '' : 's'}, soit ${normalizedMetrics.completionRate} % des activités. ${normalizedMetrics.pendingActivities} activité${normalizedMetrics.pendingActivities === 1 ? ' reste' : 's restent'} en attente, ce qui représente ${pendingActivityRate} %. Le taux d’achèvement rapporte les activités terminées au nombre total d’activités recensées ; il permet de lire l’état d’avancement sans confondre celui-ci avec l’approbation des rapports.`,
        `Traitement des rapports : ${reportStatusSummary}`,
        `Répartition des travaux : ${categorySummary}`,
        `Points de suivi : ${followUp}`
      ].join('\n\n');
    }
    return res.json({
      success: true,
      department,
      period,
      startDate,
      endDate,
      scope,
      metrics: normalizedMetrics,
      categories: categoryRows.map(row => ({ name: row.category, total: Number(row.total) })),
      narrative,
    });
  } catch (error) {
    console.error('Erreur dans getChefServiceSynthesis:', error);
    next(error);
  }
};

// Liste paginée de toutes les activités report_activities du département.
exports.getChefServiceActivities = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service de votre département.' });

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const status = String(req.query.status || '').trim();
    const category = String(req.query.category || '').trim();
    const search = String(req.query.search || '').trim().slice(0, 100);
    const conditions = ["u.department = ?", "LOWER(TRIM(u.role)) = 'agent'"];
    const params = [department];
    if (status === 'approval_pending') {
      conditions.push("LOWER(TRIM(dr.status)) = 'submitted' AND (dr.submitted_to = ? OR dr.submitted_to IS NULL)");
      params.push(req.user.id);
    } else if (status) { conditions.push('ra.status = ?'); params.push(status); }
    if (category) { conditions.push('ra.category = ?'); params.push(category); }
    if (search) {
      conditions.push('(ra.description LIKE ? OR ra.category LIKE ? OR u.last_name LIKE ? OR u.username LIKE ? OR dr.general_comments LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }
    const where = conditions.join(' AND ');

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
         JOIN users u ON u.id = dr.user_id
        WHERE ${where}`, params
    );
    const total = Number(countRows[0]?.total || 0);
    const [pendingRows] = await db.query(
      `SELECT COUNT(*) AS total
         FROM daily_reports dr
         JOIN users u ON u.id = dr.user_id
        WHERE u.department = ? AND LOWER(TRIM(u.role)) = 'agent'
          AND LOWER(TRIM(dr.status)) = 'submitted'
          AND (dr.submitted_to = ? OR dr.submitted_to IS NULL)`,
      [department, req.user.id]
    );
    const [rows] = await db.query(
      `SELECT ra.id, dr.id AS reportId, ra.description, ra.objectives, ra.category,
              ra.status, ra.obsevations AS observations, ra.hours, ra.created_at AS createdAt,
              dr.user_id AS userId, dr.report_date AS reportDate, dr.general_comments AS reportComments,
              dr.status AS reportStatus,
              u.last_name AS agentName, u.username, u.job_title AS jobTitle
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
         JOIN users u ON u.id = dr.user_id
        WHERE ${where}
        ORDER BY ra.created_at DESC, ra.id DESC
        LIMIT ? OFFSET ?`, [...params, limit, offset]
    );
    const [categoryRows] = await db.query(
      `SELECT DISTINCT ra.category
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
         JOIN users u ON u.id = dr.user_id
        WHERE u.department = ? AND LOWER(TRIM(u.role)) = 'agent' ORDER BY ra.category`, [department]
    );
    return res.json({
      success: true,
      activities: rows.map(row => ({ ...row, reportDate: formatSqlDate(row.reportDate) })),
      categories: categoryRows.map(row => row.category).filter(Boolean),
      pendingApprovals: Number(pendingRows[0]?.total || 0),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error('Erreur dans getChefServiceActivities:', error);
    next(error);
  }
};

// Modifie l'avancement de l'activité sans toucher au statut d'approbation du rapport parent.
exports.updateChefServiceActivityStatus = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service de votre département.' });
    const activityId = Number.parseInt(req.params.activityId, 10);
    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    const status = requestedStatus === 'completed' ? 'Completed' : requestedStatus === 'pending' ? 'Pending' : null;
    if (!Number.isSafeInteger(activityId) || activityId < 1 || !status) {
      return res.status(400).json({ success: false, message: 'Identifiant ou statut invalide. Utilisez Completed ou Pending.' });
    }

    const [result] = await db.query(
      `UPDATE report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
         JOIN users u ON u.id = dr.user_id
          SET ra.status = ?
        WHERE ra.id = ? AND u.department = ? AND LOWER(TRIM(u.role)) = 'agent'
          AND LOWER(TRIM(ra.status)) <> LOWER(?)`,
      [status, activityId, department, status]
    );
    if (!result.affectedRows) {
      const [rows] = await db.query(
        `SELECT ra.status
           FROM report_activities ra
           JOIN daily_reports dr ON dr.id = ra.daily_report_id
           JOIN users u ON u.id = dr.user_id
          WHERE ra.id = ? AND u.department = ? AND LOWER(TRIM(u.role)) = 'agent'
          LIMIT 1`,
        [activityId, department]
      );
      if (!rows.length) return res.status(404).json({ success: false, message: 'Activité introuvable dans votre département.' });
      if (String(rows[0].status).toLowerCase() !== requestedStatus) {
        return res.status(409).json({ success: false, message: 'Le statut de cette activité a changé. Actualisez le tableau.' });
      }
      return res.json({ success: true, status: rows[0].status, unchanged: true });
    }
    return res.json({ success: true, status });
  } catch (error) {
    console.error('Erreur dans updateChefServiceActivityStatus:', error);
    next(error);
  }
};

// Décision sur le rapport parent. Le statut de report_activities reste l'avancement de l'activité.
exports.decideChefServiceActivity = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service de votre département.' });
    const activityId = Number.parseInt(req.params.activityId, 10);
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim().slice(0, 2000);
    if (!Number.isSafeInteger(activityId) || activityId < 1 || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Décision ou identifiant invalide.' });
    }
    if (decision === 'rejected' && !reason) {
      return res.status(400).json({ success: false, message: 'Un motif est requis pour rejeter une activité.' });
    }

    const [result] = await db.query(
      `UPDATE daily_reports dr
         JOIN users u ON u.id = dr.user_id
         JOIN report_activities ra ON ra.daily_report_id = dr.id
          SET dr.status = ?, dr.reviewed_by = ?, dr.reviewed_at = NOW(), dr.review_comment = ?
        WHERE ra.id = ? AND u.department = ? AND LOWER(TRIM(u.role)) = 'agent'
          AND LOWER(TRIM(dr.status)) = 'submitted'
          AND (dr.submitted_to = ? OR dr.submitted_to IS NULL)`,
      [decision, req.user.id, decision === 'rejected' ? reason : null, activityId, department, req.user.id]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, message: 'Cette activité n’est plus en attente ou ne relève pas de votre département.' });
    }
    return res.json({ success: true, message: decision === 'approved' ? 'Rapport approuvé.' : 'Rapport rejeté.', status: decision });
  } catch (error) {
    console.error('Erreur dans decideChefServiceActivity:', error);
    next(error);
  }
};

// Détail d'une activité : vérifie également le département via le rapport et son agent.
exports.getChefServiceActivityDetails = async (req, res, next) => {
  try {
    const department = await getChefServiceDepartment(req);
    if (!department) return res.status(403).json({ success: false, message: 'Accès réservé au chef de service de votre département.' });
    const activityId = Number.parseInt(req.params.activityId, 10);
    if (!Number.isSafeInteger(activityId) || activityId < 1) {
      return res.status(400).json({ success: false, message: 'Identifiant d’activité invalide.' });
    }
    const [rows] = await db.query(
      `SELECT ra.id, dr.id AS reportId, ra.description, ra.objectives, ra.category,
              ra.status, ra.obsevations AS observations, ra.hours, ra.created_at AS createdAt,
              dr.user_id AS userId, dr.report_date AS reportDate, dr.general_comments AS reportComments,
              dr.status AS reportStatus, dr.review_comment AS reviewComment,
              dr.created_at AS reportCreatedAt,
              u.last_name AS agentName, u.username,
              u.email, u.phone, u.job_title AS jobTitle, u.department
         FROM report_activities ra
         JOIN daily_reports dr ON dr.id = ra.daily_report_id
         JOIN users u ON u.id = dr.user_id
        WHERE ra.id = ? AND u.department = ? AND LOWER(TRIM(u.role)) = 'agent'
        LIMIT 1`, [activityId, department]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Activité introuvable dans votre département.' });
    return res.json({ success: true, activity: { ...rows[0], reportDate: formatSqlDate(rows[0].reportDate) } });
  } catch (error) {
    console.error('Erreur dans getChefServiceActivityDetails:', error);
    next(error);
  }
};
