const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { createReadStream } = require('node:fs');
const db = require('./db');
const activityAudit = require('./activityAudit');

const TABLES = new Set(['activity_log', 'activity_logs']);
const LOCK_NAME = 'rapports:activity-log-weekly-archive';
const PAGE_SIZE = 500;
const DELETE_BATCH_SIZE = 400;

function dateParts(value) {
  if (value instanceof Date) {
    return [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new TypeError(`Date d’archive invalide: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekStartForDate(value) {
  const [year, month, day] = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(value, count) {
  const [year, month, day] = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + count));
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Identifiant SQL inattendu.');
  return `\`${value}\``;
}

function createActivityLogArchiveService({
  database = db,
  audit = activityAudit,
  outputDirectory = path.resolve(__dirname, '..', 'activity_log')
} = {}) {
  async function ensureManifestTable() {
    await database.query(`CREATE TABLE IF NOT EXISTS activity_log_archives (
      week_start DATE NOT NULL PRIMARY KEY,
      file_name VARCHAR(255) NOT NULL,
      row_count BIGINT UNSIGNED NOT NULL,
      sha256 CHAR(64) NOT NULL,
      archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
    const [columns] = await database.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='activity_log_archives'`
    );
    const names = new Set(columns.map(column => column.COLUMN_NAME));
    const additions = [
      ['file_name', 'VARCHAR(255) NULL'],
      ['row_count', 'BIGINT UNSIGNED NOT NULL DEFAULT 0'],
      ['sha256', 'CHAR(64) NULL'],
      ['archived_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['deleted_at', 'TIMESTAMP NULL DEFAULT NULL']
    ];
    for (const [name, definition] of additions) {
      if (!names.has(name)) {
        await database.query(`ALTER TABLE activity_log_archives ADD COLUMN ${quoteIdentifier(name)} ${definition}`);
      }
    }
  }

  async function getSourceTables(connection) {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('activity_log','activity_logs')`
    );
    const sources = [];
    for (const { TABLE_NAME: table } of tables) {
      if (!TABLES.has(table)) continue;
      const [keys] = await connection.query(
        `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY'
         ORDER BY ORDINAL_POSITION`, [table]
      );
      if (keys.length !== 1) {
        throw new Error(`La table ${table} doit avoir une seule clé primaire pour être archivée sans perte.`);
      }
      sources.push({ table, primaryKey: keys[0].COLUMN_NAME });
    }
    return sources;
  }

  async function readArchive(filePath, expectedWeekStart, expectedSources) {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const hash = crypto.createHash('sha256');
    const idsByTable = new Map();
    let header;
    let rowCount = 0;
    try {
      for await (const line of lines) {
        hash.update(`${line}\n`, 'utf8');
        if (!line) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          throw new Error(`Le fichier d’archive est illisible: ${path.basename(filePath)}.`);
        }
        if (!header) {
          if (record.type !== 'activity-log-archive' || record.version !== 1 || record.weekStart !== expectedWeekStart) {
            throw new Error(`L’en-tête de l’archive ${path.basename(filePath)} ne correspond pas à sa période.`);
          }
          header = record;
          continue;
        }
        if (record.type !== 'row' || !expectedSources.some(source => source.table === record.sourceTable && source.primaryKey === record.primaryKey)) {
          throw new Error(`Une ligne d’archive contient une table ou une clé non autorisée.`);
        }
        if (!record.data || String(record.data[record.primaryKey]) !== String(record.key)) {
          throw new Error(`Une ligne d’archive a une clé incohérente.`);
        }
        if (!idsByTable.has(record.sourceTable)) idsByTable.set(record.sourceTable, new Set());
        idsByTable.get(record.sourceTable).add(record.key);
        rowCount += 1;
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    if (!header || rowCount === 0) throw new Error(`L’archive ${path.basename(filePath)} est vide ou incomplète.`);
    return { rowCount, sha256: hash.digest('hex'), idsByTable };
  }

  async function writeSnapshot(connection, sources, weekStart, temporaryPath) {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    let handle;
    let count = 0;
    const hash = crypto.createHash('sha256');
    const writeLine = async line => {
      const bytes = `${JSON.stringify(line)}\n`;
      await handle.writeFile(bytes, 'utf8');
      hash.update(bytes, 'utf8');
    };
    try {
      handle = await fs.open(temporaryPath, 'wx');
      await writeLine({
        type: 'activity-log-archive',
        version: 1,
        weekStart,
        archivedAt: new Date().toISOString(),
        tables: sources.map(source => source.table)
      });
      for (const source of sources) {
        const tableName = quoteIdentifier(source.table);
        const keyName = quoteIdentifier(source.primaryKey);
        let offset = 0;
        while (true) {
          const [rows] = await connection.query(
            `SELECT * FROM ${tableName} ORDER BY ${keyName} ASC LIMIT ? OFFSET ?`, [PAGE_SIZE, offset]
          );
          if (rows.length === 0) break;
          for (const row of rows) {
            await writeLine({
              type: 'row',
              sourceTable: source.table,
              primaryKey: source.primaryKey,
              key: row[source.primaryKey],
              data: row
            });
            count += 1;
          }
          offset += rows.length;
          if (rows.length < PAGE_SIZE) break;
        }
      }
      await handle.sync();
      await connection.query('COMMIT');
      await handle.close();
      handle = null;
      if (count === 0) {
        await fs.rm(temporaryPath, { force: true });
        return { rowCount: 0, sha256: null };
      }
      return { rowCount: count, sha256: hash.digest('hex') };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      if (handle) await handle.close().catch(() => {});
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function deleteArchivedRows(connection, archive, sources) {
    const sourceByTable = new Map(sources.map(source => [source.table, source]));
    for (const [table, values] of archive.idsByTable) {
      const source = sourceByTable.get(table);
      if (!source) throw new Error(`Suppression refusée: table d’archive non reconnue (${table}).`);
      const tableName = quoteIdentifier(table);
      const keyName = quoteIdentifier(source.primaryKey);
      const ids = [...values];
      for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
        const batch = ids.slice(index, index + DELETE_BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');
        await connection.query(`DELETE FROM ${tableName} WHERE ${keyName} IN (${placeholders})`, batch);
        const [[remaining]] = await connection.query(
          `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${keyName} IN (${placeholders})`, batch
        );
        if (Number(remaining.count) !== 0) {
          throw new Error(`Certaines lignes de ${table} n’ont pas pu être supprimées après archivage.`);
        }
      }
    }
  }

  async function registerArchive(connection, weekStart, fileName, archive) {
    await connection.query(
      `INSERT INTO activity_log_archives (week_start,file_name,row_count,sha256,archived_at,deleted_at)
       VALUES (?,?,?,?,NOW(),NULL)`,
      [weekStart, fileName, archive.rowCount, archive.sha256]
    );
  }

  async function finishArchive(connection, weekStart, filePath, sources, manifest) {
    const verified = await readArchive(filePath, weekStart, sources);
    if (verified.rowCount !== Number(manifest.row_count) || verified.sha256 !== manifest.sha256) {
      throw new Error(`Vérification SHA-256 échouée pour ${manifest.file_name}; aucune ligne n’a été supprimée.`);
    }
    await deleteArchivedRows(connection, verified, sources);
    await connection.query(
      'UPDATE activity_log_archives SET deleted_at=NOW() WHERE week_start=? AND deleted_at IS NULL', [weekStart]
    );
    return { weekStart, file: manifest.file_name, archivedRows: verified.rowCount, cleared: true };
  }

  async function archivePendingWeeks(now = new Date()) {
    await audit.ensureTable();
    await ensureManifestTable();
    await fs.mkdir(outputDirectory, { recursive: true });

    const currentWeekStart = weekStartForDate(now);
    const weekStart = addDays(currentWeekStart, -7);
    const connection = await database.getConnection();
    let lockAcquired = false;
    try {
      const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
      lockAcquired = Number(lock.acquired) === 1;
      if (!lockAcquired) return { skipped: true, reason: 'archive_in_progress' };

      const sources = await getSourceTables(connection);
      if (sources.length === 0) return { skipped: true, reason: 'activity_log_table_missing' };
      const [[existing]] = await connection.query(
        'SELECT week_start,file_name,row_count,sha256,deleted_at FROM activity_log_archives WHERE week_start=? LIMIT 1',
        [weekStart]
      );
      if (existing) {
        if (existing.deleted_at) return { skipped: true, reason: 'already_archived', weekStart };
        const filePath = path.join(outputDirectory, existing.file_name);
        return await finishArchive(connection, weekStart, filePath, sources, existing);
      }

      const fileName = `activity_log_${weekStart}.txt`;
      const finalPath = path.join(outputDirectory, fileName);
      const temporaryPath = `${finalPath}.tmp`;
      try {
        await fs.access(finalPath);
        // Récupère un fichier finalisé si le processus s’est arrêté avant son entrée en base.
        const recovered = await readArchive(finalPath, weekStart, sources);
        await registerArchive(connection, weekStart, fileName, recovered);
        return await finishArchive(connection, weekStart, finalPath, sources, {
          file_name: fileName,
          row_count: recovered.rowCount,
          sha256: recovered.sha256
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      await fs.rm(temporaryPath, { force: true });
      const snapshot = await writeSnapshot(connection, sources, weekStart, temporaryPath);
      if (snapshot.rowCount === 0) return { skipped: true, reason: 'no_activity_rows', weekStart };
      await fs.rename(temporaryPath, finalPath);
      const verified = await readArchive(finalPath, weekStart, sources);
      if (verified.rowCount !== snapshot.rowCount || verified.sha256 !== snapshot.sha256) {
        throw new Error(`Vérification de l’archive ${fileName} échouée; la base a été conservée.`);
      }
      await registerArchive(connection, weekStart, fileName, verified);
      return await finishArchive(connection, weekStart, finalPath, sources, {
        file_name: fileName,
        row_count: verified.rowCount,
        sha256: verified.sha256
      });
    } finally {
      if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
      connection.release();
    }
  }

  return { archivePendingWeeks };
}

const service = createActivityLogArchiveService();
module.exports = { ...service, createActivityLogArchiveService, weekStartForDate, addDays };
