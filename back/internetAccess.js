'use strict';

const db = require('./db');
const appSettings = require('./appSettings');
const { normalizeIp, normalizeMac, isLocalOrPrivateIp, validateAllowlist } = require('./ipAddress');
const { execFile } = require('node:child_process');
const os = require('node:os');
const { promisify } = require('node:util');

const CACHE_TTL_MS = 5000;
const MAC_CACHE_TTL_MS = 5000;
let cachedConfig = null;
let cacheExpiresAt = 0;
const macCache = new Map();
const execFileAsync = promisify(execFile);

function normalizeAccessAddress(value) {
  return normalizeIp(value) || normalizeMac(value);
}

function getLocalMacAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const network of interfaces || []) {
      if (network.internal) continue;
      const mac = normalizeMac(network.mac);
      if (mac && !addresses.includes(mac)) addresses.push(mac);
    }
  }
  return addresses;
}

function getLocalMacForIp(ip) {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const network of interfaces || []) {
      if (normalizeIp(network.address) !== ip) continue;
      const mac = normalizeMac(network.mac);
      if (mac) return mac;
    }
  }
  return null;
}

async function resolveClientMac(clientIp, platform = process.platform) {
  const ip = normalizeIp(clientIp);
  if (!ip || !isLocalOrPrivateIp(ip)) return null;
  const cacheKey = `${platform}:${ip}`;
  const cached = macCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.mac;
  const remember = mac => {
    macCache.set(cacheKey, { mac, expiresAt: Date.now() + MAC_CACHE_TTL_MS });
    return mac;
  };
  const localMac = getLocalMacForIp(ip);
  if (localMac) return remember(localMac);
  // A request from the same machine is usually reported as loopback and has
  // no ARP entry. In that case the local interface MAC is the only reliable
  // value available to the server.
  if (ip === '127.0.0.1' || ip === '::1') return remember(getLocalMacAddresses()[0] || null);
  const commands = platform === 'win32'
    ? [['arp', ['-a', ip]]]
    : platform === 'linux'
      ? [['ip', ['neigh', 'show', ip]], ['arp', ['-n', ip]]]
      : [['arp', ['-n', ip]]];
  for (const [command, args] of commands) {
    try {
      const { stdout } = await execFileAsync(command, args, { timeout: 1200, windowsHide: true, maxBuffer: 64 * 1024 });
      for (const line of String(stdout).split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        const rowIp = normalizeIp(columns[0]);
        if (rowIp !== ip) continue;
        for (const column of columns.slice(1)) {
          const mac = normalizeMac(column);
          if (mac) return remember(mac);
        }
      }
    } catch {
      // ARP/neighbor information can be unavailable or the platform command may not exist.
    }
  }
  return remember(null);
}

async function getConfig({ refresh = false } = {}) {
  if (!refresh && cachedConfig && Date.now() < cacheExpiresAt) return cachedConfig;
  await appSettings.ensureSettings();
  const [rows] = await db.query(
    "SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('internet_access_enabled','internet_allowlist_ips','network_access_configured','network_access_enabled','network_access_allowlist')",
  );
  const values = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  const legacyMode = values.network_access_configured !== '1';
  let storedAddresses = [];
  let invalid = false;
  try {
    const parsed = JSON.parse(legacyMode ? (values.internet_allowlist_ips || '[]') : (values.network_access_allowlist || '[]'));
    if (!Array.isArray(parsed)) invalid = true;
    else {
      storedAddresses = parsed.map(normalizeAccessAddress);
      invalid = storedAddresses.some(value => !value) || new Set(storedAddresses).size !== storedAddresses.length;
      storedAddresses = storedAddresses.filter(Boolean);
    }
  } catch {
    invalid = true;
  }
  if (legacyMode && values.internet_access_enabled === '1') {
    try { validateAllowlist(storedAddresses); }
    catch { invalid = true; }
  }
  const allowedAddresses = storedAddresses;
  const allowedIps = allowedAddresses.filter(value => normalizeIp(value));
  const allowedMacs = allowedAddresses.filter(value => normalizeMac(value));
  cachedConfig = {
    legacyMode,
    enabled: legacyMode ? values.internet_access_enabled === '1' : values.network_access_enabled === '1',
    allowedAddresses,
    allowedIps,
    allowedMacs,
    invalid: (legacyMode ? values.internet_access_enabled === '1' : values.network_access_enabled === '1') &&
      (invalid || allowedAddresses.length === 0),
  };
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedConfig;
}

async function saveConfig({ enabled, allowedAddresses, allowedIps, userId }) {
  await appSettings.ensureSettings();
  const addresses = (allowedAddresses || allowedIps || []).map(normalizeAccessAddress);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE app_settings SET setting_value=?,updated_by=? WHERE setting_key='network_access_configured'",
      ['1', userId],
    );
    await connection.query(
      "UPDATE app_settings SET setting_value=?,updated_by=? WHERE setting_key='network_access_enabled'",
      [enabled ? '1' : '0', userId],
    );
    await connection.query(
      "UPDATE app_settings SET setting_value=?,updated_by=? WHERE setting_key='network_access_allowlist'",
      [JSON.stringify(addresses), userId],
    );
    await connection.query(
      "UPDATE app_settings SET setting_value='0',updated_by=? WHERE setting_key='internet_access_enabled'",
      [userId],
    );
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
  cachedConfig = {
    legacyMode: false,
    enabled,
    allowedAddresses: addresses,
    allowedIps: addresses.filter(value => normalizeIp(value)),
    allowedMacs: addresses.filter(value => normalizeMac(value)),
    invalid: false
  };
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

function restrictionFailure(config, context, secure, addressAllowed) {
  if (context.trustProxy === true) {
    return { status: 503, message: 'Le filtrage par adresse ne peut pas être appliqué : configurez TRUST_PROXY avec les adresses exactes de votre proxy, jamais avec « true ».' };
  }
  if (!context.trustProxy && context.hasForwardedAddress) {
    return { status: 503, message: 'Le filtrage par adresse ne peut pas être appliqué : configurez TRUST_PROXY avec les adresses exactes de votre proxy.' };
  }
  if (config.invalid) {
    return { status: 503, message: 'La liste des adresses autorisées est invalide. Contactez un administrateur depuis le réseau local.' };
  }
  if (!addressAllowed) {
    return { status: 403, message: 'Cette adresse IP ou MAC ne figure pas dans la liste des appareils autorisés.' };
  }
  if (!isLocalOrPrivateIp(context.clientIp) && !secure) return { status: 426, message: 'La connexion depuis Internet doit utiliser HTTPS.' };
  return null;
}

function createMiddleware(app, loadConfig = getConfig, resolveMac = resolveClientMac) {
  return async function restrictInternetAccess(req, res, next) {
    const context = getRequestContext(req, app);
    let config;
    try {
      config = await loadConfig();
    } catch {
      return sendDenied(req, res, 503, 'Le contrôle d’accès est temporairement indisponible. Réessayez dans quelques instants.');
    }
    if (config.legacyMode && context.allowLocalAccess) return next();
    if (!config.enabled) return next();

    const addresses = config.allowedAddresses || config.allowedIps || [];
    let addressAllowed = Boolean(context.clientIp && (config.legacyMode ? (config.allowedIps || addresses) : addresses).includes(context.clientIp));
    if (!config.legacyMode && !addressAllowed && context.clientIp && isLocalOrPrivateIp(context.clientIp) && (config.allowedMacs || []).length) {
      const resolvedMac = await resolveMac(context.clientIp).catch(() => null);
      const clientMacs = [resolvedMac].filter(Boolean).map(normalizeMac).filter(Boolean);
      if (resolveMac === resolveClientMac && (context.clientIp === '127.0.0.1' || context.clientIp === '::1')) {
        clientMacs.push(...getLocalMacAddresses());
      }
      addressAllowed = clientMacs.some(mac => (config.allowedMacs || []).includes(mac));
    }
    const failure = restrictionFailure(config, context, req.secure, addressAllowed);
    return failure ? sendDenied(req, res, failure.status, failure.message) : next();
  };
}

module.exports = { getConfig, saveConfig, createMiddleware, resolveClientMac, getLocalMacAddresses };
