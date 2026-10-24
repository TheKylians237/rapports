const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 1. Correction des imports locaux avec './'
const authRoutes = require('./authRoutes');
const dashRoutes = require('./dashRoutes');
const activityAudit = require('./activityAudit');
const dailyReminderService = require('./dailyReminderService');
const maintenanceService = require('./maintenanceService');
const activityLogArchiveService = require('./activityLogArchiveService');
const monthlySummaryService = require('./monthlySummaryService');
const internetAccess = require('./internetAccess');

const app = express();

// Respecte les en-têtes X-Forwarded-* lorsqu'un reverse proxy (Nginx, IIS, ingress)
// est placé devant l'application. Sans cela, req.ip (donc le rate limiting) ne
// verrait que l'adresse du proxy.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined && trustProxy !== '') {
  const numeric = Number(trustProxy);
  app.set(
    'trust proxy',
    trustProxy === 'true' ? true : trustProxy === 'false' ? false : Number.isNaN(numeric) ? trustProxy : numeric,
  );
}

const configuredOrigins = (process.env.APP_ORIGINS || 'http://localhost:5000,http://127.0.0.1:5000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  const cspMode = String(process.env.CSP_MODE || 'legacy').toLowerCase();
  const scriptSource =
    cspMode === 'legacy'
      ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com"
      : `'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com`;
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSource}`,
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
    "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://api.dicebear.com",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ]
    .concat(cspMode === 'report-only' ? ['report-uri /api/security/csp-report'] : [])
    .join('; ');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0');
  if (cspMode === 'report-only') res.setHeader('Content-Security-Policy-Report-Only', policy);
  else res.setHeader('Content-Security-Policy', policy);
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (process.env.NODE_ENV === 'production' && req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});
app.use((req, res, next) =>
  cors({
    origin(origin, callback) {
      if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
      // Intranet frontend served from another port on the same LAN hostname/IP.
      // CORS is not an authentication mechanism; API routes still require JWT/roles.
      try {
        const originUrl = new URL(origin);
        const requestHost = String(req.headers.host || '')
          .split(':')[0]
          .toLowerCase();
        if (originUrl.protocol === 'http:' && requestHost && originUrl.hostname.toLowerCase() === requestHost)
          return callback(null, true);
      } catch {}
      return callback(Object.assign(new Error('Origine non autorisée'), { status: 403 }));
    },
  })(req, res, next),
);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.post('/api/security/csp-report', (req, res) => {
  if (process.env.CSP_REPORT_LOG === '1') console.warn('CSP violation:', JSON.stringify(req.body || {}).slice(0, 2000));
  return res.status(204).end();
});

// Analyse minimale des cookies afin que l'authentification par cookie fonctionne
// (en complément du jeton Bearer lu par authMiddleware).
app.use((req, _res, next) => {
  const jar = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      const key = part.slice(0, separator).trim();
      if (!key) continue;
      const rawValue = part.slice(separator + 1).trim();
      try {
        jar[key] = decodeURIComponent(rawValue);
      } catch {
        jar[key] = rawValue;
      }
    }
  }
  req.cookies = jar;
  next();
});

// La restriction s’applique à toutes les pages, fichiers statiques et API.
// Les anciennes configurations Internet-only conservent leur accès LAN ; une
// liste réseau configurée (IP ou MAC) est appliquée aux clients locaux aussi.
app.use(internetAccess.createMiddleware(app));

app.use(activityAudit.middleware);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// Exposer tous les sous-dossiers de 'front'
app.use((req, res, next) => {
  if (String(process.env.CSP_MODE || 'legacy').toLowerCase() !== 'strict' || !req.path.toLowerCase().endsWith('.html'))
    return next();
  const frontRoot = path.resolve(path.join(__dirname, '../front'));
  const candidate = path.resolve(frontRoot, `.${req.path}`);
  if (!candidate.startsWith(`${frontRoot}${path.sep}`)) return next();
  fs.readFile(candidate, 'utf8', (error, html) => {
    if (error) return next();
    const nonce = res.locals.cspNonce;
    const withNonces = html.replace(/<script(?![^>]*\bsrc=)(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
    return res.type('html').send(withNonces);
  });
});
app.use(express.static(path.join(__dirname, '../front')));
app.use(
  '/vendor/tesseract',
  express.static(path.join(__dirname, '../node_modules/tesseract.js/dist'), { immutable: true, maxAge: '1d' }),
);
app.use(
  '/vendor/tesseract-core',
  express.static(path.join(__dirname, '../node_modules/tesseract.js-core'), { immutable: true, maxAge: '1d' }),
);

// Exposer 'front/html' pour accéder directement aux pages
app.use(express.static(path.join(__dirname, '../front/html'), { index: false }));

// Charger les routes de l'API (ex: /api/auth/login, /api/auth/register, etc.)
app.use('/api/auth', authRoutes);

// Montage des routes sur le préfixe /api
app.use('/api', dashRoutes);

// La page d’accueil présente le site de téléchargement et permet d’ouvrir la connexion.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../front/html/download.html'));
});

// Rendre le dossier 'img' accessible publiquement via l'URL /img
app.use('/img', express.static(path.join(__dirname, '../img')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error('Erreur serveur:', err.message);
  res
    .status(status)
    .json({
      success: false,
      message: status === 413 ? 'Requête trop volumineuse.' : 'Une erreur serveur est survenue.',
    });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
if (require.main === module) {
  const keyPath = process.env.TLS_KEY_FILE,
    certPath = process.env.TLS_CERT_FILE;
  if (Boolean(keyPath) !== Boolean(certPath))
    throw new Error('TLS_KEY_FILE et TLS_CERT_FILE doivent être définis ensemble.');
  const listener = keyPath
    ? https
        .createServer(
          { key: fs.readFileSync(path.resolve(keyPath)), cert: fs.readFileSync(path.resolve(certPath)) },
          app,
        )
        .listen(Number(process.env.HTTPS_PORT) || PORT, HOST)
    : app.listen(PORT, HOST);
  listener.on('listening', () => {
    const protocol = keyPath ? 'https' : 'http',
      port = listener.address().port;
    console.log(`Serveur accessible sur ${protocol}://${HOST}:${port} (localhost ou adresse IP du réseau local)`);
    dailyReminderService
      .dispatchDailyReportReminders()
      .catch((error) => console.error('Rappels journaliers indisponibles:', error.message));
    maintenanceService
      .runDailyMaintenance()
      .catch((error) => console.error('Maintenance quotidienne indisponible:', error.message));
    activityLogArchiveService
      .archivePendingWeeks()
      .catch((error) => console.error('Archivage hebdomadaire des journaux indisponible:', error.message));
    monthlySummaryService
      .sendMonthlySummary()
      .catch((error) => console.error('Synthèse mensuelle indisponible:', error.message));
    const reminderTimer = setInterval(
      () => {
        dailyReminderService
          .dispatchDailyReportReminders()
          .catch((error) => console.error('Rappels journaliers indisponibles:', error.message));
        maintenanceService
          .runDailyMaintenance()
          .catch((error) => console.error('Maintenance quotidienne indisponible:', error.message));
        activityLogArchiveService
          .archivePendingWeeks()
          .catch((error) => console.error('Archivage hebdomadaire des journaux indisponible:', error.message));
        monthlySummaryService
          .sendMonthlySummary()
          .catch((error) => console.error('Synthèse mensuelle indisponible:', error.message));
      },
      15 * 60 * 1000,
    );
    reminderTimer.unref();
  });
}

module.exports = app;
