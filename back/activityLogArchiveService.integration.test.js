const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createActivityLogArchiveService } = require('./activityLogArchiveService');

function createFakeDatabase(initialRows, onSnapshotCommit) {
  const state = {
    rows: [...initialRows],
    manifest: null,
    commitHook: onSnapshotCommit,
    hookUsed: false
  };

  async function query(sql, _params = []) {
    if (sql.startsWith('CREATE TABLE')) return [{ affectedRows: 0 }, []];
    if (sql.includes('information_schema.COLUMNS')) {
      return [[
        { COLUMN_NAME: 'week_start' },
        { COLUMN_NAME: 'file_name' },
        { COLUMN_NAME: 'row_count' },
        { COLUMN_NAME: 'sha256' },
        { COLUMN_NAME: 'archived_at' },
        { COLUMN_NAME: 'deleted_at' }
      ], []];
    }
    throw new Error(`Requête base de données inattendue: ${sql}`);
  }

  const connection = {
    async query(sql, params = []) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
      if (sql.includes('information_schema.TABLES')) return [[{ TABLE_NAME: 'activity_logs' }], []];
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [[{ COLUMN_NAME: 'id' }], []];
      if (sql.startsWith('SELECT week_start,file_name')) {
        const found = state.manifest && state.manifest.week_start === params[0] ? state.manifest : null;
        return [[...(found ? [found] : [])], []];
      }
      if (sql.startsWith('SET TRANSACTION') || sql.startsWith('START TRANSACTION')) return [{ affectedRows: 0 }, []];
      if (sql === 'COMMIT') {
        if (!state.hookUsed && state.commitHook) {
          state.hookUsed = true;
          state.commitHook(state.rows);
        }
        return [{ affectedRows: 0 }, []];
      }
      if (sql === 'ROLLBACK') return [{ affectedRows: 0 }, []];
      if (sql.startsWith('SELECT * FROM `activity_logs`')) {
        const offset = Number(params[1]);
        const limit = Number(params[0]);
        const rows = [...state.rows].sort((a, b) => a.id - b.id).slice(offset, offset + limit);
        return [rows, []];
      }
      if (sql.startsWith('INSERT INTO activity_log_archives')) {
        state.manifest = {
          week_start: params[0],
          file_name: params[1],
          row_count: params[2],
          sha256: params[3],
          deleted_at: null
        };
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('DELETE FROM `activity_logs`')) {
        const ids = new Set(params.map(Number));
        const before = state.rows.length;
        state.rows = state.rows.filter(row => !ids.has(Number(row.id)));
        return [{ affectedRows: before - state.rows.length }, []];
      }
      if (sql.startsWith('SELECT COUNT(*) AS count FROM `activity_logs`')) {
        const ids = new Set(params.map(Number));
        return [[{ count: state.rows.filter(row => ids.has(Number(row.id))).length }], []];
      }
      if (sql.startsWith('UPDATE activity_log_archives SET deleted_at')) {
        if (state.manifest?.week_start === params[0]) state.manifest.deleted_at = new Date();
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Requête connexion inattendue: ${sql}`);
    },
    release() {}
  };

  return { database: { query, async getConnection() { return connection; } }, state };
}

async function withArchiveService(t, database) {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'rapports-activity-log-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  return {
    service: createActivityLogArchiveService({
      database,
      audit: { async ensureTable() {} },
      outputDirectory
    }),
    outputDirectory
  };
}

test('après validation du TXT, supprime les lignes qui ont été archivées', async t => {
  const { database, state } = createFakeDatabase([
    { id: 1, action: 'GET', route: '/one', status_code: 200 },
    { id: 2, action: 'POST', route: '/two', status_code: 201 }
  ]);
  const { service, outputDirectory } = await withArchiveService(t, database);

  const result = await service.archivePendingWeeks(new Date('2026-10-18T12:00:00'));

  assert.equal(result.archivedRows, 2);
  assert.equal(result.cleared, true);
  assert.deepEqual(state.rows, []);
  assert.equal(state.manifest.deleted_at instanceof Date, true);
  const archivedText = await fs.readFile(path.join(outputDirectory, result.file), 'utf8');
  assert.match(archivedText, /"route":"\/one"/);
  assert.match(archivedText, /"route":"\/two"/);
});

test('préserve les nouvelles lignes arrivées après la création de la copie', async t => {
  const { database, state } = createFakeDatabase([
    { id: 1, action: 'GET', route: '/before', status_code: 200 }
  ], rows => rows.push({ id: 2, action: 'POST', route: '/during', status_code: 201 }));
  const { service } = await withArchiveService(t, database);

  const result = await service.archivePendingWeeks(new Date('2026-10-18T12:00:00'));

  assert.equal(result.archivedRows, 1);
  assert.deepEqual(state.rows.map(row => row.id), [2]);
});
