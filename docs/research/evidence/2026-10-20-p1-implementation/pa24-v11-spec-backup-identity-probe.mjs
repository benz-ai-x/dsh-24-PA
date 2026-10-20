import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { mkdtemp, mkdir, cp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const outer = await mkdtemp(join(tmpdir(), 'pa24-v11-backup-identity-'));
const roots = Object.fromEntries(['sessions', 'storages', 'attachments'].map(k => [k, join(outer, k)]));
for (const path of Object.values(roots)) await mkdir(path);
const f = await fixture({ backupSessionsRoot: roots.sessions, backupStoragesRoot: roots.storages, backupAttachmentsRoot: roots.attachments });
const result = { node: process.version, controls: [] };
try {
  const path = await f.workspace('source', { ownerOpenId: 'owner-a' });
  await f.rt.bind(path);
  await f.rt.repos.memos.insert({ id: 'marker', topic: 'backup', content: 'recoverable business row', source: 'spec-review' });
  const normal = await f.rt.maintenanceBackupCreate({ targetDir: join(outer, 'backups') });
  await rm(join(path, '.24pa', 'ledger-identity.json'));
  const missing = await f.rt.maintenanceBackupCreate({ targetDir: join(outer, 'backups') });
  await f.rt.stop();
  for (const [kind, backup] of [['normal', normal], ['missing-identity', missing]]) {
    const restoredPath = join(outer, 'restore-' + kind);
    await cp(join(backup.backupDir, 'workspace'), restoredPath, { recursive: true });
    await mkdir(join(restoredPath, 'data'));
    await cp(join(backup.backupDir, 'pa24.db'), join(restoredPath, 'data', 'pa24.db'));
    const restored = f.make();
    let bindResult;
    try {
      await restored.bind(restoredPath);
      bindResult = { accepted: true, rows: (await restored.repos.memos.search({ query: 'backup' })).map(row => row.id) };
    } catch (error) { bindResult = { accepted: false, error: error.message }; }
    result.controls.push({ kind, backupComplete: backup.complete, failures: backup.failures, bindResult });
    await restored.stop();
  }
} finally { await f.cleanup(); await rm(outer, { recursive: true, force: true }); }
console.log(JSON.stringify(result, null, 2));
