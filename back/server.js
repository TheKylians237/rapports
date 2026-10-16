const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 1. Correction des imports locaux avec './'
const authRoutes = require('./authRoutes');
const dashRoutes = require('./dashRoutes');
const authController = require('./authController');
const rateLimit = require('./rateLimit');
const activityAudit = require('./activityAudit');
const db = require('./db');

const app = express();

const configuredOrigins = (process.env.APP_ORIGINS || 'http://localhost:5000,http://127.0.0.1:5000')
  .split(',').map(origin => origin.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use((req, res, next) => cors({ origin(origin, callback) {
  if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
  // Intranet frontend served from another port on the same LAN hostname/IP.
  // CORS is not an authentication mechanism; API routes still require JWT/roles.
  try {
    const originUrl = new URL(origin);
    const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (originUrl.protocol === 'http:' && requestHost && originUrl.hostname.toLowerCase() === requestHost) return callback(null, true);
  } catch (_) {}
  return callback(Object.assign(new Error('Origine non autorisée'), { status: 403 }));
} })(req, res, next));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(activityAudit.middleware);

app.get('/api/health', async (_req, res) => {
  try { await db.query('SELECT 1'); return res.json({ success: true, status: 'ready' }); }
  catch (_) { return res.status(503).json({ success: false, status: 'starting', message: 'La base de données est momentanément indisponible.' }); }
});

// Exposer tous les sous-dossiers de 'front'
app.use(express.static(path.join(__dirname, '../front')));

// Exposer 'front/html' pour accéder directement aux pages
app.use(express.static(path.join(__dirname, '../front/html'), { index: false }));

// Charger les routes de l'API (ex: /api/auth/login, /api/auth/register, etc.)
app.use('/api/auth', authRoutes);

// Si vous voulez garder une route directe /api/login (conseillé d'utiliser POST pour du login)
app.post('/api/login', rateLimit({ max: 8, keyBy: req => req.body?.identity }), authController.login);


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
  res.status(status).json({ success: false, message: status === 413 ? 'Requête trop volumineuse.' : 'Une erreur serveur est survenue.' });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Serveur accessible sur http://${HOST}:${PORT} (localhost ou adresse IP du réseau local)`);
});
