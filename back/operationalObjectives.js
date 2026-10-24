'use strict';

const DEFINITIONS = Object.freeze({
  availability_target: { label: 'Disponibilité cible', defaultValue: '99.5', unit: '% mensuel' },
  backup_frequency: { label: 'Fréquence des sauvegardes', defaultValue: 'quotidienne', unit: 'fréquence' },
  restore_target_minutes: { label: 'Temps cible de restauration', defaultValue: '240', unit: 'minutes' },
  recovery_point_minutes: { label: 'Perte de données maximale (RPO)', defaultValue: '60', unit: 'minutes' },
  audit_retention_days: { label: 'Rétention des journaux', defaultValue: '365', unit: 'jours' },
  data_protection_level: { label: 'Niveau de protection des données', defaultValue: 'standard', unit: 'niveau' },
});

function fromEnvironment() {
  return {
    availability_target: process.env.SLO_AVAILABILITY_TARGET || DEFINITIONS.availability_target.defaultValue,
    backup_frequency: process.env.SLO_BACKUP_FREQUENCY || DEFINITIONS.backup_frequency.defaultValue,
    restore_target_minutes: process.env.SLO_RESTORE_TARGET_MINUTES || DEFINITIONS.restore_target_minutes.defaultValue,
    recovery_point_minutes: process.env.SLO_RECOVERY_POINT_MINUTES || DEFINITIONS.recovery_point_minutes.defaultValue,
    audit_retention_days: process.env.AUDIT_LOG_RETENTION_DAYS || DEFINITIONS.audit_retention_days.defaultValue,
    data_protection_level: process.env.SLO_DATA_PROTECTION_LEVEL || DEFINITIONS.data_protection_level.defaultValue,
  };
}

function validate(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new TypeError('Les objectifs opérationnels sont invalides.');
  const output = {};
  for (const key of Object.keys(DEFINITIONS)) {
    if (values[key] === undefined) continue;
    const value = String(values[key]).trim().slice(0, 120);
    if (!value) throw new TypeError(`La valeur de ${key} est vide.`);
    if (
      ['availability_target', 'restore_target_minutes', 'recovery_point_minutes', 'audit_retention_days'].includes(
        key,
      ) &&
      !/^\d+(?:\.\d+)?$/.test(value)
    ) {
      throw new TypeError(`La valeur de ${key} doit être numérique.`);
    }
    output[key] = value;
  }
  return output;
}

function definitions() {
  return Object.fromEntries(Object.entries(DEFINITIONS).map(([key, definition]) => [key, { ...definition }]));
}

module.exports = { definitions, fromEnvironment, validate };
