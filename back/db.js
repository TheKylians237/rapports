const mysql = require('mysql2');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.DB_PASSWORD?.trim()) {
  throw new Error('DB_PASSWORD est absent ou vide dans back/.env. Renseignez le mot de passe MySQL après le signe =.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'rprts_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rprts',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: false
});

// IMPORTANT : Exporter la version promise
module.exports = pool.promise();
