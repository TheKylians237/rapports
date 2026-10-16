// authMiddleware.js
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = require('./jwtConfig');

/**
 * Extraction unifiée du token depuis l'en-tête Authorization (Bearer) ou les Cookies
 */
const extractToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
};

/**
 * Middleware principal de protection des routes (Supporte Bearer + Cookie)
 */
const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        success: false,
        message: 'Accès refusé. Token manquant ou non fourni.',
      });
    }

    // Validation JWT
    const decoded = jwt.verify(token, JWT_SECRET);

    // Bloquer les jetons temporaires 2FA sur les routes métier
    if (decoded.isTemp2FA) {
      return res.status(401).json({
        success: false,
        message: 'Validation 2FA requise. Veuillez entrer votre code OTP.',
      });
    }

    if (!decoded.id) return res.status(401).json({ success: false, message: 'Session invalide.' });
    // Le rôle et l'état du compte sont relus en base à chaque requête protégée.
    const [users] = await db.execute('SELECT id, role, email, is_active FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (!users.length || Number(users[0].is_active) !== 1) {
      return res.status(401).json({ success: false, message: 'Compte inactif ou session révoquée.' });
    }
    req.user = { ...decoded, id: users[0].id, role: users[0].role, email: users[0].email };
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Session expirée ou invalide. Veuillez vous reconnecter.',
    });
  }
};

/**
 * Variante simple pour rétrocompatibilité (ex: routes 2FA setup)
 */
const verifyToken = (req, res, next) => {
  return protect(req, res, next);
};

/**
 * Alias de protect
 */
const authenticateToken = (req, res, next) => {
  return protect(req, res, next);
};

/**
 * Restreint l'accès aux rôles autorisés (Gère l'insensibilité à la casse & aliases)
 */
const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Aucun rôle identifié.',
      });
    }

    // Normalisation du rôle utilisateur (ex: "Chef_de_Service" -> "chef_service")
    const userRoleClean = String(req.user.role)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');

    // Normalisation de la liste des rôles autorisés
    const normalizedAllowedRoles = allowedRoles.map(r => 
      String(r).trim().toLowerCase().replace(/[\s-]+/g, '_')
    );

    // Mappage des équivalences courantes (ex: chef_de_service / manager)
    const isAllowed = normalizedAllowedRoles.some(role => {
      if (role === 'chef_service' || role === 'chef_de_service') {
        return ['chef_service', 'chef_de_service', 'chef', 'manager'].includes(userRoleClean);
      }
      return role === userRoleClean;
    });

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Privilèges insuffisants pour cette ressource.',
      });
    }

    next();
  };
};

// Exportation unifiée sous forme d'objet
module.exports = {
  verifyToken,
  protect,
  authenticateToken,
  restrictTo
};
