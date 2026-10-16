const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 1. Correction des imports locaux avec './'
const authRoutes = require('./authRoutes');
const dashRoutes = require('./dashRoutes');
const authController = require('./authController');
const rateLimit = require('./rateLimit');

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
app.use(cors({ origin(origin, callback) {
  if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origine non autorisée'));
} }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Exposer tous les sous-dossiers de 'front'
app.use(express.static(path.join(__dirname, '../front')));

// Exposer 'front/html' pour accéder directement aux pages
app.use(express.static(path.join(__dirname, '../front/html')));

// Charger les routes de l'API (ex: /api/auth/login, /api/auth/register, etc.)
app.use('/api/auth', authRoutes);

// Si vous voulez garder une route directe /api/login (conseillé d'utiliser POST pour du login)
app.post('/api/login', rateLimit({ max: 8 }), authController.login);


// Montage des routes sur le préfixe /api
app.use('/api', dashRoutes);

// Route racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../front/html/index.html'));
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
app.listen(PORT, () => {
  console.log(`Serveur d'authentification démarré sur http://localhost:${PORT}`);
});
