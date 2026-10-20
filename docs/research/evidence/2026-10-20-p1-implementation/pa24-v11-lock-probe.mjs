import { createRequire } from 'node:module';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';
const require = createRequire('/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/package.json');
const pg = require('pg'); const cluster = await startPgCluster(); const pool = new pg.Pool({ connectionString: cluster.dsn });
try {
 const version = (await pool.query('show server_version')).rows[0].server_version;
 const admission = async owner => { const c = await pool.connect(); try { await c.query('begin'); await c.query('select pg_advisory_xact_lock(842289217, 1)'); await c.query('create schema if not exists proof'); await c.query('create table if not exists proof.owner (id int primary key, owner text)'); const old = (await c.query('select owner from proof.owner')).rows[0]; if (old && old.owner !== owner) throw new Error('owner conflict'); await c.query('insert into proof.owner values (1,$1) on conflict do nothing', [owner]); await c.query('commit'); return owner; } catch(e) { await c.query('rollback'); throw e; } finally { c.release(); } };
 const results = (await Promise.allSettled([admission('a'), admission('b')])).map(r => ({ status:r.status, value:r.value, error:r.reason?.message }));
 const c = await pool.connect(); try { await c.query('begin'); await c.query('create table proof.rollback_probe (id int)'); await c.query('insert into proof.owner values (1,\'duplicate\')'); } catch { await c.query('rollback'); } finally { c.release(); }
 console.log(JSON.stringify({version,results,rows:(await pool.query('select * from proof.owner')).rows,rolledBackDdl:(await pool.query("select to_regclass('proof.rollback_probe') is null as ok")).rows[0].ok},null,2));
} finally { await pool.end(); await cluster.stop(); }
