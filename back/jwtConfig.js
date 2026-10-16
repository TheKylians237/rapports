require('dotenv').config({ path: require('path').join(__dirname, '.env') });
// Une seule clé doit signer et vérifier tous les JWT de l'application.
// En production, JWT_SECRET doit être défini dans l'environnement.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET doit être défini et contenir au moins 32 caractères.');
}

module.exports = process.env.JWT_SECRET;
