'use strict';

const db = require('./db');
const appSettings = require('./appSettings');
const { normalizeIp, isLocalOrPrivateIp } = require('./ipAddress');

const CACHE_TTL_MS = 5000;
let cachedConfig = null;
let cacheExpiresAt = 0;

async function getConfig({ refresh = false } = {}) {
  if (!refresh && cachedConfig && Date.now() < cacheExpiresAt) return cachedConfig;
  await appSettings.ensureSettings();
  const [rows] = await db.query(
    "SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('internet_access_enabled','internet_allowlist_ips')",
  );
  const values = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  let allowedIps = [];
  try {
    const parsed = JSON.parse(values.internet_allowlist_ips || '[]');
    if (Array.isArray(parsed)) allowedIps = parsed.map(normalizeIp).filter(Boolean);
  } catch {
    // Invalid stored config fails closed below when access restrictions are active.
  }
  cachedConfig = {
    enabled: values.internet_access_enabled === '1',
    allowedIps,
    invalid: values.internet_access_enabled === '1' && allowedIps.length !== 2,
  };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedConfig;
}

async function saveConfig({ enabled, allowedIps, userId }) {
  await appSettings.ensureSettings();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE app_settings SET setting_value=?,updated_by=? WHERE setting_key='internet_access_enabled'",
      [enabled ? '1' : '0', userId],
    );
    await connection.query(
      "UPDATE app_settings SET setting_value=?,updated_by=? WHERE setting_key='internet_allowlist_ips'",
      [JSON.stringify(allowedIps), userId],
    );
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
  cachedConfig = { enabled, allowedIps, invalid: false };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedConfig;
}

function sendDenied(req, res, status, message) {
  if (req.path.startsWith('/api/')) return res.status(status).json({ success: false, message });
  return res.status(status).type('text').send(message);
}

function getRequestContext(req, app) {
  const peerIp = normalizeIp(req.socket?.remoteAddress || '');
  const clientIp = normalizeIp(req.ip || peerIp || '');
  const trustProxy = app.get('trust proxy');
  const hasForwardedAddress = Boolean(req.headers['x-forwarded-for'] || req.headers.forwarded);
  const allowLocalAccess = trustProxy !== true && isLocalOrPrivateIp(clientIp) && (trustProxy || !hasForwardedAddress);
  return { clientIp, trustProxy, hasForwardedAddress, allowLocalAccess };
}

function restrictionFailure(config, context, secure) {
  if (context.trustProxy === true) {
    return { status: 503, message: 'Accès Internet désactivé : configurez TRUST_PROXY avec les adresses exactes de votre proxy, jamais avec « true ».' };
  }
  if (!context.trustProxy && context.hasForwardedAddress) {
    return { status: 503, message: 'Accès Internet désactivé : configurez TRUST_PROXY avec les adresses exactes de votre proxy.' };
  }
  if (config.invalid) {
    return { status: 503, message: 'La liste blanche des adresses Internet est invalide. Contactez un administrateur depuis le réseau local.' };
  }
  if (!context.clientIp || !config.allowedIps.includes(context.clientIp)) {
    return { status: 403, message: 'Cette adresse IP ne fait pas partie des deux adresses autorisées pour l’accès Internet.' };
  }
  if (!secure) return { status: 426, message: 'La connexion depuis Internet doit utiliser HTTPS.' };
  return null;
}

function createMiddleware(app, loadConfig = getConfig) {
  return async function restrictInternetAccess(req, res, next) {
    // Private LAN clients stay available even when the database is temporarily down.
    // Do not trust forwarded headers unless Express was given a specific trusted proxy.
    const context = getRequestContext(req, app);
    if (context.allowLocalAccess) return next();

    let config;
    try {
      config = await loadConfig();
    } catch {
      return sendDenied(req, res, 503, 'Le contrôle d’accès est temporairement indisponible. Réessayez dans quelques instants.');
    }
    if (!config.enabled) return next();
    const failure = restrictionFailure(config, context, req.secure);
    return failure ? sendDenied(req, res, failure.status, failure.message) : next();
  };
}

module.exports = { getConfig, saveConfig, createMiddleware };
