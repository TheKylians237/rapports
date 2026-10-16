// Validation partagée entre les contrôleurs afin d'appliquer les mêmes règles
// d'entrée partout (inscription, création admin, réinitialisation, changement).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Une seule politique de robustesse pour tous les mots de passe de l'application.
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 200;

const isValidEmail = (value) => EMAIL_PATTERN.test(String(value ?? '').trim().toLowerCase());

const isValidPassword = (value) =>
  typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;

// Normalise un rôle : "Chef de Service" -> "chef_de_service".
const normalizeRole = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const isValidIsoDate = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

// Tronque proprement un texte optionnel, en renvoyant null si vide.
const clampText = (value, maxLength) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
};

module.exports = {
  EMAIL_PATTERN,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  isValidEmail,
  isValidPassword,
  normalizeRole,
  isValidIsoDate,
  clampText,
};
