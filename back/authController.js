const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { sendResetOTP } = require('./mailer'); // Assurez-vous que le chemin vers mailer.js est correct

const crypto = require('crypto'); // Natif dans Node.js pour générer les UUID v4
const db = require('./db'); // Remplacez par le chemin vers votre fichier de connexion MySQL
const { send2FACode } = require('./mailer');
const appSettings = require('./appSettings');
const JWT_SECRET = require('./jwtConfig');

// ==========================================
// 1. INSCRIPTION & CONNEXION
// ==========================================



// 1. Déclaration des fonctions de validation (OBLIGATOIRE)
/*const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

const isStrongPassword = (password) => {
  return password && password.length >= 8;
};*/

exports.register = async (req, res) => {
  try {
    await require('./adminController').ensureReferenceSchema();
    if (!(await appSettings.getRegistrationOpen())) return res.status(403).json({ success: false, message: 'La création de comptes est temporairement désactivée par l’administrateur.' });
    const { fullName, email, username, phone, department, role, password } = req.body;
    const departmentId = String(department || '').trim();
    const roleId = String(role || 'agent').trim().toLowerCase().replace(/[\s-]+/g, '_');

    // 1. Contrôle des champs obligatoires
    if (!fullName || !email || !username || !password || !departmentId || !['agent','manager','chef_service'].includes(roleId) ||
        typeof password !== 'string' || password.length < 12 || password.length > 200 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)) ||
        String(username).trim().length > 50 || String(fullName).trim().length > 50 ||
        departmentId.length > 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Veuillez remplir tous les champs obligatoires.' 
      });
    }

    const [departments] = await pool.query('SELECT id FROM departments WHERE id=? AND is_active=1 LIMIT 1', [departmentId]);
    const [roles] = await pool.query('SELECT id FROM roles WHERE id=? AND is_active=1 LIMIT 1', [roleId]);
    if (!departments.length || !roles.length) return res.status(400).json({ success:false,message:'Choisissez un rôle et un département actifs dans les listes.' });

    // 2. Vérification d'existence préalable (Email ou Username)
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE email = ? OR username = ?', 
      [email.toLowerCase().trim(), username.trim()]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'Un compte existe déjà avec cet email ou ce nom d\'utilisateur.' 
      });
    }

    // 3. Hachage du mot de passe
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4. Préparation des variables
    const userId = crypto.randomUUID();
    const userRole = roles[0].id;
    const userPhone = phone ? phone.trim() : null;

    // 5. Requête SQL d'insertion (Exactement 8 colonnes pour 8 valeurs)
    // Note : Vérifiez si la colonne dans MySQL s'appelle 'department' ou 'departement'
    await pool.query(
      `INSERT INTO users (id, last_name, username, email, phone, password_hash, role, department, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        userId,
        fullName.trim(),
        username.trim(),
        email.toLowerCase().trim(),
        userPhone,
        passwordHash,
        userRole,
        departments[0].id
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Compte créé. Il sera accessible après activation par un administrateur.'
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Un compte existe déjà avec cet e-mail ou ce nom d’utilisateur.' });
    // Affiche le détail précis de l'erreur dans la console du terminal Node.js
    console.error('Erreur SQL ou serveur :', error);
    
    return res.status(500).json({ 
      success: false, 
      message: 'Erreur interne du serveur lors de la création du compte.', 
    });
  }
};

exports.registrationOptions = async (_req,res) => {
  try {
    await require('./adminController').ensureReferenceSchema();
    const [departments] = await pool.query('SELECT id,name FROM departments WHERE is_active=1 ORDER BY name');
    const [roles] = await pool.query("SELECT id,name FROM roles WHERE is_active=1 AND id IN ('agent','manager','chef_service') ORDER BY CASE id WHEN 'agent' THEN 1 ELSE 2 END");
    return res.json({success:true,departments,roles});
  } catch(error) {
    console.error('Chargement des options d’inscription impossible:',error.message);
    return res.status(503).json({success:false,message:'Les options d’inscription sont temporairement indisponibles.'});
  }
};

exports.registrationStatus = async (_req,res) => {
  try { return res.json({success:true,enabled:await appSettings.getRegistrationOpen()}); }
  catch(error) { console.error('Lecture du réglage inscription impossible:',error.message); return res.status(503).json({success:false,message:'État des inscriptions temporairement indisponible.'}); }
};

exports.login = async (req, res) => {
    const { identity, password, rememberMe } = req.body;

    if (!identity || !password) {
        return res.status(400).json({ 
            success: false, 
            message: "L'identifiant et le mot de passe sont requis." 
        });
    }

    try {
        // 1. Recherche de l'utilisateur
        const sql = 'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1';
        const [rows] = await db.execute(sql, [identity, identity]);

        if (rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: "Identifiant ou mot de passe incorrect." 
            });
        }

        const user = rows[0];

        if (Number(user.is_active) !== 1) {
            return res.status(401).json({ success: false, message: "Identifiant ou mot de passe incorrect." });
        }

        // 2. Vérification du mot de passe
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ 
                success: false, 
                message: "Identifiant ou mot de passe incorrect." 
            });
        }

        // 3. Génération du code 2FA (10 min)
    const otpCode = crypto.randomInt(100000, 1000000).toString();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // 4. Enregistrement en BDD
        const updateSql = 'UPDATE users SET two_factor_code = ?, two_factor_expires = ? WHERE id = ?';
        await db.execute(updateSql, [otpCode, otpExpiresAt, user.id]);

        // 5. Envoi de l'e-mail
        await send2FACode(user.email, otpCode);

        // 6. Génération d'un Jeton Temporaire 2FA (Valide 10 minutes uniquement)
        const jwtSecret = JWT_SECRET;
        
        const tempToken = jwt.sign(
            { id: user.id, isTemp2FA: true },
            jwtSecret,
            { expiresIn: '10m' }
        );

        // 7. Réponse envoyée au client (avec tempToken explicite)
        return res.status(200).json({
            success: true,
            requires2FA: true,
            message: "Code de vérification envoyé par e-mail.",
            tempToken: tempToken, // ✅ Requis par le script frontend
            token: tempToken,     // ✅ Pour rétrocompatibilité
            userId: user.id,
            username: user.username,
            rememberMe: !!rememberMe
        });

    } catch (error) {
        console.error("Erreur d'authentification :", error);
        return res.status(500).json({ 
            success: false, 
            message: "Erreur serveur lors de la connexion." 
        });
    }
};





// ==========================================
// 2. AUTHENTIFICATION À DEUX FACTEURS (2FA)
// ==========================================

// Configuration initiale / Génération du QR Code
exports.setup2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    const secret = authenticator.generateSecret();
    
    const otpauth = authenticator.keyuri(req.user.email, 'AppRapports', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    // Sauvegarder temporairement le secret dans la BD
    await pool.query('UPDATE users SET two_factor_secret = ? WHERE id = ?', [secret, userId]);

    res.json({ secret, qrCodeUrl });
  } catch (error) {
    console.error('Échec configuration 2FA:', error.message);
    res.status(500).json({ message: 'Erreur serveur lors de la configuration 2FA.' });
  }
};

// Activation définitive après validation du 1er code
exports.verifyAndEnable2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body; // Code à 6 chiffres

    const [users] = await pool.query('SELECT two_factor_secret, username FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!users.length || !users[0].two_factor_secret) {
      return res.status(400).json({ message: 'Configuration 2FA introuvable.' });
    }
    const user = users[0];
    const secret = user.two_factor_secret;

    const isValid = authenticator.verify({ token, secret });
    if (!isValid) {
      return res.status(400).json({ message: 'Code TOTP invalide.' });
    }

    // Générer des codes de secours (Backup Codes)
    const backupCodes = Array.from({ length: 5 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());

    await pool.query(
      'UPDATE users SET is_2fa_enabled = 1, backup_codes = ? WHERE id = ?',
      [JSON.stringify(backupCodes), userId]
    );

    res.json({ message: '2FA activé avec succès.', backupCodes, username: user.username });
  } catch (error) {
    console.error('Échec validation 2FA:', error.message);
    res.status(500).json({ message: 'Erreur serveur lors de la validation 2FA.' });
  }
};

// Validation lors de la connexion (Login Step 2)
exports.validate2FA = async (req, res) => {
  try {
    const { preAuthToken, otpCode } = req.body;

    // Vérifier le token temporaire
    const decoded = jwt.verify(preAuthToken, JWT_SECRET);
    if (!decoded.is2FAPending && !decoded.isTemp2FA) {
      return res.status(400).json({ message: 'Session invalide.' });
    }

    const [users] = await pool.query('SELECT * FROM users WHERE id = ? AND is_active = 1 LIMIT 1', [decoded.id]);
    if (!users.length) return res.status(401).json({ message: 'Compte inactif ou introuvable.' });
    const user = users[0];
    if (!user.is_2fa_enabled || !user.two_factor_secret) {
      return res.status(400).json({ message: 'La validation par application 2FA n’est pas configurée.' });
    }

    // Vérifier si c'est un code TOTP ou un code de secours
    const normalizedCode = String(otpCode || '').trim().toUpperCase();
    const isValidTOTP = /^\d{6}$/.test(normalizedCode) && authenticator.verify({ token: normalizedCode, secret: user.two_factor_secret });
    let backupCodes = [];
    try {
      backupCodes = user.backup_codes ? JSON.parse(user.backup_codes) : [];
    } catch (_) {}
    if (!Array.isArray(backupCodes)) backupCodes = [];
    const isBackupMatch = backupCodes.includes(normalizedCode);

    if (!isValidTOTP && !isBackupMatch) {
      return res.status(401).json({ message: 'Code 2FA invalide.' });
    }

    // Si code de secours utilisé, le supprimer de la liste
    if (isBackupMatch) {
      backupCodes = backupCodes.filter(c => c !== normalizedCode);
      await pool.query('UPDATE users SET backup_codes = ? WHERE id = ?', [JSON.stringify(backupCodes), user.id]);
    }

    // Token final
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { userId: user.id, username: user.username, email: user.email, role: user.role }
    });
    console.log('L’enregistrement du rapport :', user.id);
  } catch (error) {
    res.status(401).json({ message: 'Session expirée ou invalide.' });
  }
};

exports.verify2FA = async (req, res) => {
    const { userId, code } = req.body;

    if (!userId || !code) {
        return res.status(400).json({ success: false, message: "Données incomplètes." });
    }

    try {
        // Vérification de l'utilisateur, du code et de l'expiration
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE id = ? AND two_factor_code = ? AND two_factor_expires > NOW() LIMIT 1',
            [userId, code]
        );

        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: "Code OTP invalide ou expiré." });
        }

        const user = rows[0];

        // Consommer l’OTP atomiquement : une même vérification concurrente ne peut pas émettre deux sessions.
        const [consumed] = await db.execute('UPDATE users SET two_factor_code = NULL, two_factor_expires = NULL WHERE id = ? AND two_factor_code = ? AND two_factor_expires > NOW()', [user.id, code]);
        if (!consumed.affectedRows) return res.status(401).json({ success: false, message: 'Code OTP déjà utilisé ou expiré.' });

        // Génération du Token JWT définitif avec le RÔLE
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.status(200).json({
            success: true,
            message: "Authentification réussie.",
            token: token,
            role: user.role,
            username: user.username,
            userId: user.id
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Erreur serveur." });
    }
};

exports.resend2FA = async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  const preAuthToken = String(req.body?.preAuthToken || '');
  if (!userId || !preAuthToken) return res.status(400).json({ success: false, message: 'Session de connexion invalide.' });

  try {
    const decoded = jwt.verify(preAuthToken, JWT_SECRET);
    if (!decoded.isTemp2FA || String(decoded.id) !== userId) {
      return res.status(401).json({ success: false, message: 'Session de connexion invalide.' });
    }
    const [rows] = await db.execute('SELECT id, email FROM users WHERE id = ? AND is_active = 1 LIMIT 1', [userId]);
    if (!rows.length) return res.status(400).json({ success: false, message: 'Session de connexion invalide.' });

    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.execute('UPDATE users SET two_factor_code = ?, two_factor_expires = ? WHERE id = ?', [code, expiresAt, userId]);
    await send2FACode(rows[0].email, code);
    return res.json({ success: true, message: 'Un nouveau code de vérification a été envoyé.' });
  } catch (error) {
    console.error('Erreur renvoi 2FA :', error.message);
    return res.status(500).json({ success: false, message: 'Impossible de renvoyer le code pour le moment.' });
  }
};


// ==========================================
// 3. MOT DE PASSE OUBLIÉ
// ==========================================

// Étape 1 : Demande d'OTP par email
// Étape 1 : Demande d'OTP par email
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(200).json({ message: "Si l'adresse existe, un code a été envoyé." });
    }
    // 1. Vérification de l'utilisateur
    const [users] = await pool.query('SELECT id FROM users WHERE email = ? AND is_active = 1 LIMIT 1', [email]);

    if (users.length === 0) {
      return res.status(200).json({ message: "Si l'adresse existe, un code a été envoyé." });
    }
    const userId = users[0].id;

    // 2. Génération de l'OTP et expiration (15 min)
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // 3. Enregistrement en base de données
    await pool.query('DELETE FROM password_resets WHERE email = ?', [email]);
    await pool.query(
      'INSERT INTO password_resets (user_id, email, otp_code, expires_at) VALUES (?, ?, ?, ?)',
      [userId, email, otp, expiresAt]
    );

    // 4. Envoi de l'e-mail
    await sendResetOTP(email, otp);

    // 5. Réponse JSON au client (Frontend)
    return res.status(200).json({ message: "Si l'adresse existe, un code a été envoyé." });

  } catch (error) {
    console.error('Erreur forgotPassword:', error);
    return res.status(500).json({ message: "Erreur lors du traitement de la demande." });
  }
};


// Étape 2 : Validation OTP + Nouveau mot de passe
exports.resetPassword = async (req, res) => {
  let connection;
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const { newPassword } = req.body;
    if (!email || !/^\d{6}$/.test(code) || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({ message: 'Code invalide ou mot de passe trop faible.' });
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [resetRows] = await connection.query(
      'SELECT user_id, expires_at FROM password_resets WHERE email = ? AND otp_code = ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [email, code]
    );
    if (!resetRows.length || new Date(resetRows[0].expires_at) < new Date()) {
      await connection.rollback();
      return res.status(400).json({ message: 'Code invalide ou expiré.' });
    }
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);
    const userId = resetRows[0].user_id;
    const [result] = await connection.query('UPDATE users SET password_hash = ?, two_factor_code = NULL, two_factor_expires = NULL WHERE id = ?', [newPasswordHash, userId]);
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(400).json({ message: 'Compte introuvable.' });
    }
    await connection.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
    await connection.commit();
    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Erreur de réinitialisation:', error.message);
    res.status(500).json({ message: 'Erreur de réinitialisation.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.resetOTP = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(200).json({ message: "Si l'adresse existe, un code a été envoyé." });
    }

    // 1. Vérifier si l'utilisateur existe
    const [users] = await pool.query('SELECT id FROM users WHERE email = ? AND is_active = 1 LIMIT 1', [email]);
    if (users.length === 0) {
      return res.status(200).json({ message: "Si l'adresse existe, un code a été envoyé." });
    }

    const userId = users[0].id;

    // 2. Générer le nouvel OTP et l'expiration
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // 3. SUPPRIMER l'ancien code s'il existe pour cet e-mail
    await pool.query('DELETE FROM password_resets WHERE email = ? AND user_id = ?', [email, userId]);

    // 4. INSÉRER le nouveau code
    await pool.query(
      'INSERT INTO password_resets (user_id, email, otp_code, expires_at) VALUES (?, ?, ?, ?)',
      [userId, email, otp, expiresAt]
    );

    // 5. Envoyer l'email
    await sendResetOTP(email, otp);

    return res.status(200).json({ message: "Si l'adresse existe, un code a été envoyé." });

  } catch (error) {
    console.error('Erreur forgotPassword:', error);
    return res.status(500).json({ message: "Erreur d'envoi email." });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // 1. Validation basique des entrées
    if (!email || !otp) {
      return res.status(400).json({ 
        message: "L'adresse e-mail et le code OTP sont requis." 
      });
    }

    // 2. Recherche du dernier OTP valide émis pour cet utilisateur
    const [rows] = await pool.query(
      `SELECT * FROM password_resets 
       WHERE email = ? AND otp_code = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    // Si aucun enregistrement ne correspond au couple email + otp
    if (rows.length === 0) {
      return res.status(400).json({ 
        message: "Code OTP incorrect." 
      });
    }

    const resetRecord = rows[0];

    // 3. Vérification de l'expiration du code
    const now = new Date();
    if (new Date(resetRecord.expires_at) < now) {
      return res.status(400).json({ 
        message: "Le code OTP a expiré. Veuillez en demander un nouveau." 
      });
    }

    // 4. (Optionnel) Vérifier si le code a déjà été utilisé (si la colonne existe)
    if (resetRecord.is_used) {
      return res.status(400).json({ 
        message: "Ce code OTP a déjà été utilisé." 
      });
    }

    // Si tout est valide
    return res.status(200).json({ 
      success: true,
      message: "Code OTP vérifié avec succès.",
    });

  } catch (error) {
    console.error("Erreur lors de la vérification de l'OTP :", error);
    return res.status(500).json({ 
      message: "Erreur serveur lors de la vérification de l'OTP."
    });
  }
};
