import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/sqlite.js';
import { PaDatabase } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/pg.js';
import { createRepos } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/repo.js';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';
const pg = await startPgCluster(), dir = await mkdtemp(join(tmpdir(), 'pa24-deep2-data-tx-'));
const output = { scenario: 'Controlled real-engine statement failures via SQL triggers; exercise repository transactions and then retry through same interface.', results: [] };
async function fault(db, table, event, work) {
  if (db.kind === 'postgres') {
    await db.query(`create or replace function pa24.audit_fail() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_INJECTED_WRITE_FAILURE'; end; $$`);
    await db.query(`create trigger audit_fail before ${event} on pa24.${table} for each row execute function pa24.audit_fail()`);
  } else await db.query(`create trigger audit_fail before ${event} on pa24.${table} begin select raise(abort, 'AUDIT_INJECTED_WRITE_FAILURE'); end`);
  let error = null;
  try { await work(); } catch (e) { error = e.message; }
  finally { await db.query(db.kind === 'postgres' ? `drop trigger audit_fail on pa24.${table}` : 'drop trigger audit_fail'); }
  if (!error?.includes('AUDIT_INJECTED_WRITE_FAILURE')) throw new Error('fault did not hit: ' + error);
  return error;
}
try {
  for (const storage of ['sqlite', 'postgres']) {
    const db = storage === 'sqlite' ? new SqliteDb(join(dir, 'ledger.db')) : new PaDatabase(pg.dsn);
    try {
      await db.migrate(); const repos = createRepos(db); const tests = [];
      await repos.workItems.insert({ id: 'work', title: 'work', role: 'memo', instruction: 'x', origin: 'local', parent_session_id: 'parent', delivery: 'local:parent', status: 'running' });
      const delivery = { dedupKey: 'work-delivery', channel: 'local', target: 'parent', kind: 'text', content: { text: 'done' } };
      await fault(db, 'outbox', 'insert', () => repos.workItems.finishWithDelivery('work', 'done', false, delivery));
      tests.push({ name: 'WorkItem result + Outbox atomic', statusAfterFault: (await repos.workItems.get('work')).status, outboxesAfterFault: (await repos.outbox.recent()).length });
      await repos.workItems.finishWithDelivery('work', 'done', false, delivery);
      Object.assign(tests.at(-1), { statusAfterRetry: (await repos.workItems.get('work')).status, outboxesAfterRetry: (await repos.outbox.recent()).length });

      await repos.notes.insertNote({ id: 'N-AUDIT', title: '待审', origin: 'local' });
      await repos.notes.insertVersion({ id: 'N-AUDIT:v1', note_id: 'N-AUDIT', version: 1, doc_id: 'doc', doc_url: null, doc_revision: '1', fingerprint: 'fp', normalized_text: 'x', content: {}, doc_snapshot: 'x', status: 'pending_review' });
      await repos.notes.insertToken({ token: 'tok', note_id: 'N-AUDIT', version_id: 'N-AUDIT:v1', action: 'approve', owner_open_id: 'owner', fingerprint: 'fp', expires_at: new Date(Date.now() + 60000) });
      const decision = { decisionId: 'dec', noteId: 'N-AUDIT', versionId: 'N-AUDIT:v1', versionStatus: 'approved', noteStatus: 'approved', decision: 'approve', reviewerOpenId: 'owner', token: 'tok', fingerprint: 'fp', notifyDedupKey: 'review-result', notifyTarget: 'owner', notifyText: 'approved' };
      const decide = () => db.withTransaction(tx => repos.notes.decideVersion(tx, decision));
      await fault(db, 'outbox', 'insert', decide);
      tests.push({ name: 'Review token + decision + note/version + Outbox atomic', tokenUsedAfterFault: !!(await repos.notes.getToken('tok')).used_at, decisionsAfterFault: (await repos.notes.decisionsOf('N-AUDIT')).length, versionAfterFault: (await repos.notes.getVersion('N-AUDIT:v1')).status, noteAfterFault: (await repos.notes.getNote('N-AUDIT')).status });
      await decide();
      Object.assign(tests.at(-1), { tokenUsedAfterRetry: !!(await repos.notes.getToken('tok')).used_at, decisionsAfterRetry: (await repos.notes.decisionsOf('N-AUDIT')).length, versionAfterRetry: (await repos.notes.getVersion('N-AUDIT:v1')).status });

      await repos.reminders.insertRule({ id: 'rule', kind: 'once', text: 'x', record: {}, status: 'active', next_due_at: new Date(Date.now()+60000), time_zone: 'Asia/Shanghai', origin_expression: null, source: null, work_item_id: null, link_source_type: null, link_source_id: null, link_fingerprint: null });
      await repos.reminders.insertOccurrence({ id: 'occ', ruleId: 'rule', dueAt: new Date(Date.now()+60000) });
      await repos.outbox.enqueue({ dedupKey: 'reminder:occ', channel: 'feishu', target: 'owner', kind: 'text', content: { text: 'x' } });
      await fault(db, 'outbox', 'update', () => repos.reminders.stopRule('rule', 'stop'));
      tests.push({ name: 'Reminder rule + occurrence + Outbox stop atomic', ruleAfterFault: (await repos.reminders.getRule('rule')).status, occurrenceAfterFault: (await repos.reminders.occurrence('occ')).status, outboxAfterFault: (await repos.outbox.recent()).find(r=>r.dedup_key==='reminder:occ').status });
      await repos.reminders.stopRule('rule', 'stop');
      Object.assign(tests.at(-1), { ruleAfterRetry: (await repos.reminders.getRule('rule')).status, occurrenceAfterRetry: (await repos.reminders.occurrence('occ')).status, outboxAfterRetry: (await repos.outbox.recent()).find(r=>r.dedup_key==='reminder:occ').status });
      output.results.push({ storage, tests });
    } finally { await db.close(); }
  }
} finally { await pg.stop(); await rm(dir, { recursive: true, force: true }); }
await writeFile('/tmp/pa24-deep2-data-transactions-result.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
