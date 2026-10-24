'use strict';

const db = require('./db');
const operationalObjectives = require('./operationalObjectives');

function createAdminOperationalController({ audit }) {
  async function getOperationalObjectives(req, res, next) {
    try {
      const definitions = operationalObjectives.definitions();
      const [rows] = await db.query(
        'SELECT objective_key AS objectiveKey, objective_value AS objectiveValue, unit, description, updated_at AS updatedAt FROM operational_objectives ORDER BY objective_key',
      );
      const stored = Object.fromEntries(rows.map((row) => [row.objectiveKey, row]));
      const environment = operationalObjectives.fromEnvironment();
      const objectives = Object.entries(definitions).map(([key, definition]) => ({
        objectiveKey: key,
        label: definition.label,
        unit: definition.unit,
        description: stored[key]?.description || definition.label,
        objectiveValue: stored[key]?.objectiveValue || environment[key] || definition.defaultValue,
        updatedAt: stored[key]?.updatedAt || null,
      }));
      return res.json({ success: true, objectives });
    } catch (error) {
      return next(error);
    }
  }

  async function saveOperationalObjectives(req, res, next) {
    try {
      const values = operationalObjectives.validate(req.body?.objectives || req.body);
      if (!Object.keys(values).length)
        return res.status(400).json({ success: false, message: 'Aucun objectif opérationnel à enregistrer.' });
      const definitions = operationalObjectives.definitions();
      for (const [key, value] of Object.entries(values)) {
        const definition = definitions[key];
        await db.query(
          `INSERT INTO operational_objectives (objective_key, objective_value, unit, description, updated_by)
          VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE objective_value=VALUES(objective_value), updated_by=VALUES(updated_by)`,
          [key, value, definition.unit, definition.label, req.user.id],
        );
      }
      await audit(req, 'OPERATIONAL_OBJECTIVES_UPDATED', null, { objectives: values });
      return getOperationalObjectives(req, res, next);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ success: false, message: error.message });
      return next(error);
    }
  }

  return { getOperationalObjectives, saveOperationalObjectives };
}

module.exports = { createAdminOperationalController };
