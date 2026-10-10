// Isolated PostgreSQL cluster for tests: initdb into a temp dir, start on a
// random port, create a dedicated non-superuser app role (mirroring the
// production "restricted account" requirement), and tear everything down.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { SqliteDb } from '../../lib/sqlite.js';

const run = promisify(execFile);

export async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

export async function startPgCluster() {
  const binDir = process.env.PA24_PG_BIN || '/opt/homebrew/bin';
  const dir = await mkdtemp(join(tmpdir(), 'pa24-pg-'));
  const port = await freePort();
  await run(join(binDir, 'initdb'), ['-D', dir, '--no-locale', '-E', 'UTF8'], { timeout: 120_000 });
  await run(
    join(binDir, 'pg_ctl'),
    ['-D', dir, '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, '-w', '-t', '60', '-l', join(dir, 'pg.log'), 'start'],
    { timeout: 120_000 },
  );
  const psql = (sql) => run(join(binDir, 'psql'), ['-h', '127.0.0.1', '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  await psql('create database pa24_test');
  await psql("create role pa24_app login password 'pa24_app'");
  await psql('grant all on database pa24_test to pa24_app');
  const dsn = `postgresql://pa24_app:pa24_app@127.0.0.1:${port}/pa24_test`;
  const superDsn = `postgresql://127.0.0.1:${port}/pa24_test`;
  let stopped = false;
  return {
    dsn,
    superDsn,
    port,
    dir,
    async query(sql) {
      // F25 matrix: under PA24_E2E_STORAGE=sqlite the ledger lives in the
      // workspace SQLite file; assertions keep their PG dialect because the
      // adapter translates it, and rows are formatted psql -At style.
      if (process.env.PA24_E2E_STORAGE === 'sqlite') {
        const db = openE2eSqlite();
        if (db) {
          // Test-side PG-isms: literal interval arithmetic on now().
          sql = sql.replace(/now\(\)\s*([-+])\s*interval\s*'(\d+) seconds'/gi,
            (_m, sign, n) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','${sign}${n} seconds')`);
          const plainBooleanAliases = booleanAliasesOf(sql);
          // The e2e `rows()` helper wraps assertions as
          // `select coalesce(json_agg(t), '[]'::json) as v from (INNER) t` —
          // unwrap it and return the JSON array json_agg would have given.
          const wrapped = /^select coalesce\(json_agg\(t\),\s*'[^']*'::json\) as v from \(([\s\S]+)\) t$/i.exec(sql.trim());
          if (wrapped) {
            let inner = wrapped[1].replace(/jsonb_array_length\(/gi, 'json_array_length(');
            // PG json arrow operators: col->'k' (json) and col->>'k' (text) —
            // sqlite's json_extract covers both shapes for assertions.
            inner = inner.replace(/([a-z_][a-z0-9_]*)\s*->>\s*'([a-z0-9_]+)'/gi, (_m, col, key) => `json_extract(${col}, '$.${key}')`);
            inner = inner.replace(/([a-z_][a-z0-9_]*)\s*->\s*'([a-z0-9_]+)'/gi, (_m, col, key) => `json_extract(${col}, '$.${key}')`);
            // Aliased boolean expressions: PG hands back true/false, sqlite 1/0.
            const booleanAliases = booleanAliasesOf(inner);
            const result = await db.query(inner);
            // PG would hand back structured json values; heal JSON-looking
            // strings from json_extract so deep-equal assertions match.
            for (const row of result.rows) {
              for (const [k, v] of Object.entries(row)) {
                if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
                  try { row[k] = JSON.parse(v); } catch { /* keep raw */ }
                } else if (booleanAliases.has(k) && (v === 1 || v === 0)) {
                  row[k] = v === 1;
                }
              }
            }
            return JSON.stringify(result.rows);
          }
          const result = await db.query(sql);
          return result.rows
            .map(row => {
              for (const [k, v] of Object.entries(row)) {
                if (plainBooleanAliases.has(k) && (v === 1 || v === 0)) row[k] = v === 1;
              }
              return row;
            })
            .map(row => Object.values(row).map(value => {
              if (value === null || value === undefined) return '';
              if (value === true) return 't';
              if (value === false) return 'f';
              if (value instanceof Date) return value.toISOString();
              if (typeof value === 'object') return JSON.stringify(value);
              return String(value);
            }).join('\t'))
            .join('\n');
        }
      }
      const { stdout } = await run(join(binDir, 'psql'), ['-h', '127.0.0.1', '-p', String(port), '-d', 'pa24_test', '-At', '-c', sql]);
      return stdout;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await run(join(binDir, 'pg_ctl'), ['-D', dir, '-m', 'immediate', 'stop']).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// ---- F25 sqlite-mode support --------------------------------------------------

/** Column aliases whose SELECT expression is an is(-not)-null boolean. */
function booleanAliasesOf(sql) {
  const names = new Set();
  for (const m of sql.matchAll(/(?:is\s+not\s+null|is\s+null)[^,]*?\s+as\s+([a-z_][a-z0-9_]*)\b/gi)) names.add(m[1]);
  return names;
}

let e2eSqliteWorkspace = null;
let e2eSqliteDb = null;

/** Set by bootHost when the suite runs against the SQLite backend. */
export function setE2eSqliteWorkspace(workspacePath) {
  e2eSqliteWorkspace = workspacePath;
  e2eSqliteDb = null;
}

function openE2eSqlite() {
  if (!e2eSqliteWorkspace) return null;
  if (!e2eSqliteDb) {
    e2eSqliteDb = new SqliteDb(join(e2eSqliteWorkspace, 'data', 'pa24.db'));
  }
  return e2eSqliteDb;
}
