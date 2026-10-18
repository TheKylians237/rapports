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
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // Bloquer les jetons temporaires 2FA sur les routes métier
    if (decoded.isTemp2FA) {
      return res.status(401).json({
        success: false,
        message: 'Validation 2FA requise. Veuillez entrer votre code OTP.',
      });
    }

    if (!decoded.id) return res.status(401).json({ success: false, message: 'Session invalide.' });
    if (decoded.jti) {
      const [sessions] = await db.execute(
        'SELECT id FROM user_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1',
        [decoded.jti, decoded.id]
      );
      if (!sessions.length) return res.status(401).json({ success: false, message: 'Session terminée ou expirée. Reconnectez-vous.' });
      await db.execute('UPDATE user_sessions SET last_seen=NOW() WHERE id=?', [decoded.jti]);
    }
    // Le rôle et l'état du compte sont relus en base à chaque requête protégée.
    const [users] = await db.execute('SELECT id, role, email, is_active FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (!users.length || Number(users[0].is_active) !== 1) {
      return res.status(401).json({ success: false, message: 'Compte inactif ou session révoquée.' });
    }
    req.user = { ...decoded, id: users[0].id, role: users[0].role, email: users[0].email };
    if (String(req.originalUrl || '').includes('/chef-dashboard') && !['manager','chef_service','chef_de_service','chef'].includes(String(users[0].role).trim().toLowerCase().replace(/[\s-]+/g,'_'))) {
      try {
        const [delegations] = await db.execute(`SELECT p.id FROM user_delegations d
          JOIN users p ON p.id=d.principal_user_id AND p.is_active=1
          JOIN users deputy ON deputy.id=d.delegate_user_id AND deputy.is_active=1
          WHERE d.delegate_user_id=? AND d.revoked_at IS NULL AND d.starts_at<=NOW() AND d.ends_at>NOW()
            AND deputy.department=p.department
            AND LOWER(REPLACE(REPLACE(TRIM(p.role),' ','_'),'-','_')) IN ('chef_service','chef_de_service','chef','manager')
          ORDER BY d.ends_at DESC LIMIT 1`, [req.user.id]);
        if (delegations.length) req.user.delegatedPrincipalId = delegations[0].id;
      } catch (error) {
        if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      }
    }
    next();
  } catch {
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
  return async (req, res, next) => {
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

    const delegatedRoleAllowed = !!req.user.delegatedPrincipalId && normalizedAllowedRoles.some(role => ['chef_service','chef_de_service'].includes(role));

    if (!isAllowed && !delegatedRoleAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Privilèges insuffisants pour cette ressource.',
      });
    }

    if (userRoleClean !== 'admin') {
      const path = `${req.baseUrl || ''}${req.path || ''}`;
      const moduleKey = path.includes('/admin/') ? 'admin' : path.includes('/big-manager/') ? 'big_manager' : path.includes('/chef-dashboard/') ? 'report_review' : path.includes('/agent/') || path.includes('/reports') ? 'reports' : null;
      if (moduleKey) {
        try {
          const [permissions] = await db.execute('SELECT is_allowed FROM module_permissions WHERE role_id=? AND module_key=? LIMIT 1', [userRoleClean, moduleKey]);
          if (permissions.length && Number(permissions[0].is_allowed) !== 1) return res.status(403).json({success:false,message:'Ce module est désactivé pour votre rôle.'});
        } catch (error) {
          if (error.code !== 'ER_NO_SUCH_TABLE') return res.status(503).json({success:false,message:'Permissions temporairement indisponibles.'});
        }
      }
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
