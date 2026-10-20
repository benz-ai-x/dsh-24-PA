import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/sqlite.js';
import { PaDatabase } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/pg.js';
import { MIGRATIONS } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/db.js';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';

// The old-schema fixture uses the repository's historical DDL prefix in this
// isolated process. Production files and the full migration implementation are
// unchanged. Only the migration-version INSERT is rejected by real SQL triggers.
const allMigrations = [...MIGRATIONS];
const results = [];
for (const storage of ['sqlite', 'postgres']) {
  for (const oldVersion of [14, 15]) {
    let db, cluster, root;
    try {
      root = await mkdtemp(join(tmpdir(), 'pa24-p0-migrate-'));
      if (storage === 'postgres') cluster = await startPgCluster();
      const make = () => storage === 'sqlite' ? new SqliteDb(join(root, 'ledger.db')) : new PaDatabase(cluster.dsn);
      db = make();
      MIGRATIONS.splice(0, MIGRATIONS.length, ...allMigrations.filter(m => m.version <= oldVersion));
      try { assert.equal(await db.migrate(), oldVersion); }
      finally { MIGRATIONS.splice(0, MIGRATIONS.length, ...allMigrations); }
      await db.query('insert into pa24.memo (id,topic,content,source) values ($1,$2,$3,$4)', ['memo-original','P0 migration check','committed owner memo','owner']);
      await db.query('insert into pa24.task (id,task_guid,summary) values ($1,$2,$3)', ['task-original','guid-original','committed task']);
      await db.query('insert into pa24.work_item (id,title,role,instruction,origin,parent_session_id,delivery,status) values ($1,$2,$3,$4,$5,$6,$7,$8)', ['work-original','committed work','memo','owner instruction','local','local-test','local','completed']);
      const snapshot = async () => ({
        memo: (await db.query('select id,topic,content,source from pa24.memo order by id')).rows,
        task: (await db.query('select id,task_guid,summary,status from pa24.task order by id')).rows,
        work: (await db.query('select id,title,role,instruction,status from pa24.work_item order by id')).rows,
      });
      const before = await snapshot();
      const failedVersion = oldVersion + 1;
      if (storage === 'sqlite') {
        await db.query(`create trigger audit_migration_fault before insert on pa24.schema_migrations when new.version = ${failedVersion} begin select raise(abort, 'AUDIT_MIGRATION_MARKER_FAILURE'); end`);
      } else {
        await db.query(`create function pa24.audit_migration_fault() returns trigger language plpgsql as $$ begin if new.version = ${failedVersion} then raise exception 'AUDIT_MIGRATION_MARKER_FAILURE'; end if; return new; end; $$`);
        await db.query('create trigger audit_migration_fault before insert on pa24.schema_migrations for each row execute function pa24.audit_migration_fault()');
      }
      let fault;
      try { await db.migrate(); } catch (e) { fault = e.message; }
      assert.match(fault ?? '', /AUDIT_MIGRATION_MARKER_FAILURE/);
      assert.equal(await db.schemaVersion(), oldVersion);
      assert.deepEqual(await snapshot(), before);
      const names = oldVersion === 14 ? ['skill','skill_definition'] : ['schedule_generation'];
      const table = oldVersion === 14 ? 'work_item' : 'digest_plan';
      const columns = async () => storage === 'sqlite'
        ? (await db.query(`select name from pragma_table_info('pa24_${table}')`)).rows.map(x => x.name)
        : (await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2', ['pa24',table])).rows.map(x => x.column_name);
      const afterFailureColumns = await columns();
      assert(names.every(n => !afterFailureColumns.includes(n)));
      await db.close(); db = make();
      assert.deepEqual(await snapshot(), before);
      await db.query(storage === 'sqlite' ? 'drop trigger audit_migration_fault' : 'drop trigger audit_migration_fault on pa24.schema_migrations');
      assert.equal(await db.migrate(), 16);
      assert.equal(await db.migrate(), 16);
      assert.deepEqual(await snapshot(), before);
      const afterRecoveryColumns = await columns();
      assert(names.every(n => afterRecoveryColumns.includes(n)));
      await db.query('insert into pa24.memo (id,topic,content,source) values ($1,$2,$3,$4)', ['memo-after','recovered','post-migration writes work','owner']);
      await assert.rejects(db.withTransaction(async tx => {
        await tx.query('update pa24.memo set content=$1 where id=$2', ['should rollback','memo-original']);
        throw new Error('AUDIT_TX_ROLLBACK');
      }), /AUDIT_TX_ROLLBACK/);
      const final = await snapshot();
      assert.equal(final.memo.find(x => x.id === 'memo-original').content, 'committed owner memo');
      assert.equal(final.memo.length, 2);
      let integrity;
      if (storage === 'sqlite') {
        integrity = (await db.query('select integrity_check from pragma_integrity_check')).rows;
        assert.equal(integrity[0].integrity_check, 'ok');
      }
      results.push({ storage, oldVersion, failedVersion, injectedError:fault, schemaAfterFailure:oldVersion, failedMigrationColumnsAbsent:true, committedRowsPreservedAfterFailure:true, committedRowsPreservedAfterReopen:true, schemaAfterRetry:16, repeatedMigrate:16, postRecoveryWrite:true, postRecoveryRollback:true, ...(integrity ? {integrity} : {}) });
    } finally {
      MIGRATIONS.splice(0, MIGRATIONS.length, ...allMigrations);
      await db?.close(); await cluster?.stop();
      if (root) await rm(root, {recursive:true,force:true});
    }
  }
}
const output = { scope:'Real adapter migration and SQL triggers on isolated SQLite/PostgreSQL; historical schema fixture built from repository DDL prefix; no host startup, process-kill, power-loss or platform network in this probe.',results };
await writeFile('/tmp/pa24-final-p0-migration-results.json', JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
