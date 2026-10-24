import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { workspaceLedgerIdentity } from '../../lib/ledger-identity.js';
import { WorkspaceBackup, assertLiveWorkspace } from '../../lib/backup.js';
import { BackupService } from '../../lib/backup-service.js';
import { previewRestore, inspectRecovery } from '../../lib/backup-restore.js';
import { openBackupLedger } from '../../lib/backup-ledger.js';
import { MemoryStore, parseMemoryFile } from '../../lib/memory.js';
import { makeSkillPackage } from '../../lib/skill-package.js';
import { startPgCluster } from '../helpers/pg.mjs';
const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fs = { resolve: async path => ({ path }), stat: async ({ path }) => { try { return { version: sha(await readFile(path)) }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }, readText: ({ path }) => readFile(path, 'utf8'), writeText: async (target, text, intent) => { const prior = await fs.stat(target); if (intent?.kind === 'replaceIfVersion' && prior?.version !== intent.version) throw Error('STALE'); await writeFile(target.path, text); return { ok: true }; } };
async function fixture(kind = 'sqlite') {
  const root = await mkdtemp(join(tmpdir(), 'pa24-m09-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const sources = Object.fromEntries(['workspace', 'stateDirectory', 'sessions', 'storages', 'attachments'].map(name => [name, join(root, name)]));
  for (const path of Object.values(sources)) await mkdir(path);
  await mkdir(join(sources.workspace, '.24pa'));
  await writeFile(join(sources.workspace, 'AGENTS.md'), '# Owner workspace');
  const identity = await workspaceLedgerIdentity(sources.workspace, 'owner');
  let db;
  if (kind === 'postgres') { const cluster = await startPgCluster(); cleanup.push(() => cluster.stop()); db = new PaDatabase(cluster.dsn); }
  else db = new SqliteDb(join(root, 'ledger.db'));
  await db.migrate(identity); cleanup.push(() => db.close());
  const repo = createRepos(db);
  const context = { workspace: sources.workspace, workspaceId: identity.workspaceId, ownerOpenId: 'owner', binding: 'binding-a', host: { fs, get: () => null }, sourceRoots: Object.values(sources), sources, db, repo: repo.backups, credentialReferences: ['PA24_SECRET'], watermarks: () => repo.maintenance.watermarks() };
  const service = new BackupService(() => context);
  const create = () => new WorkspaceBackup(sources, db).create(join(root, 'backups'), { credentialReferences: [], watermarks: [] });
  return { root, sources, db, repo, context, service, create };
}
const record = id => ({ id, category: 'fact', topic: id, content: `deleted-secret-body-${id}`, source: 'owner', status: 'unverified', updatedAt: '2026-10-23T00:00:00Z', updatedBy: 'owner', reason: 'owner' });
const opts = revision => ({ expectedRevision: revision, actor: 'owner', reason: 'owner requested' });

for (const kind of ['sqlite', 'postgres']) describe(`M09 ${kind} durable records and isolated restore`, () => {
  it('separate durable create/verify facts, repeat request has one artifact; interrupt stays unresolved', async () => {
    const f = await fixture(kind);
    const input = { workspaceBinding: 'binding-a', requestId: 'same-create-request', targetDir: join(f.root, 'backups') };
    const first = await f.service.run('create', input, 'local');
    const repeated = await f.service.run('create', input, 'local');
    expect(first.record.status).toBe('succeeded'); expect(repeated.record.id).toBe(first.record.id); expect(repeated.repeated).toBe(true);
    expect(await readdir(join(f.root, 'backups'))).toHaveLength(1);
    const verify = await f.service.run('verify', { workspaceBinding: 'binding-a', requestId: 'verify-request', backupDir: first.backupDir }, 'local');
    expect(verify.record.id).not.toBe(first.record.id);
    expect(verify.steps.find(step => step.id === 'ledger').status).toBe('passed');
    expect(verify.steps.find(step => step.id === 'sessions').status).toBe('not_checked');
    expect(verify.complete).toBe(false); expect((await f.repo.backups.get(first.record.id, f.context.workspaceId)).status).toBe('succeeded');
    const active = await f.repo.backups.begin({ requestId: 'interrupted-request', requestHash: 'abc', workspaceId: f.context.workspaceId, actor: 'local', operation: 'verify' });
    await f.repo.backups.interrupted(); expect((await f.repo.backups.get(active.row.id, f.context.workspaceId)).status).toBe('interrupted');
    await expect(f.service.list({ workspaceBinding: 'foreign' })).rejects.toThrow('切换');
    expect((await f.service.list({ workspaceBinding: 'binding-a', operation: 'create' })).total).toBe(1);
    await expect(f.service.run('create', { ...input, targetDir: '/different' }, 'local')).rejects.toThrow('标识');
  }, 180_000);
  it('actual native ledger import is readable under restricted role; source bytes unchanged', async () => {
    const f = await fixture(kind);
    await f.db.query("insert into pa24.memo (id,topic,content,source) values ('memo-one','topic','actual durable content','test')");
    const created = await f.create();
    const native = await openBackupLedger(created.backupDir, kind);
    try {
      expect((await native.query('select content from pa24.memo where id=$1', ['memo-one'])).rows[0].content).toBe('actual durable content');
      expect(await native.integrity()).toEqual([]);
      if (kind === 'postgres') expect(native.versions.applicationRole).toContain('restricted');
    } finally { await native.close(); }
    expect((await f.db.query('select count(*) as n from pa24.memo')).rows[0].n).toBeTruthy();
  }, 180_000);
  it('actual owner and linked original/Skill content, not rewritten manifest hashes, determine integrity', async () => {
    const f = await fixture(kind);
    await f.db.query("insert into pa24.note (id,title,status,origin) values ('n1','actual note','collecting','feishu')");
    await f.db.query(`insert into pa24.note_page (id,note_id,page_no,message_id,media_type,byte_size,sha256,storage_path,status) values ('page1','n1',1,'om1','image/png',3,$1,$2,'saved')`, [sha('abc'), join(f.sources.workspace, '.24pa/originals/n1/missing.png')]);
    const created = await f.create();
    const result = await inspectRecovery(f.context, created.backupDir, join(f.root, 'verify-missing'), false);
    expect(result.steps.find(step => step.id === 'materials')).toMatchObject({ status: 'failed' });
    expect(result.complete).toBe(false);
    const other = { ...f.context, workspaceId: randomUUID() };
    const wrong = await inspectRecovery(other, created.backupDir, join(f.root, 'verify-other'), false);
    expect(wrong.steps.find(step => step.id === 'ledger').message).toContain('归属');
    expect(wrong.steps.find(step => step.id === 'remote-reconciliation').evidence).toBeUndefined();
  }, 180_000);
});

it('old backup merge retains current changes and purges old derived bodies, without modifying authority or backup', async () => {
  const f = await fixture(); const store = new MemoryStore(f.sources.workspace, { fs });
  await store.put(record('purged'), opts(0)); await store.put(record('kept'), opts(1));
  const created = await f.create(), oldBytes = await readFile(join(created.backupDir, 'workspace/.24pa/memory.json'));
  await store.remove('purged', opts(2)); await store.transition('purged', 'purge', opts(3));
  await store.put({ ...record('kept'), content: 'newest-current-value' }, opts(4));
  const currentBytes = await readFile(join(f.sources.workspace, '.24pa/memory.json'));
  const preview = await previewRestore(f.context, created.backupDir);
  expect(preview).toMatchObject({ protectedIds: ['purged'], conflicts: ['kept'] });
  const result = await inspectRecovery(f.context, created.backupDir, join(f.root, 'restored'), true, preview.previewToken);
  expect(result.steps.find(step => step.id === 'memory').status).toBe('passed');
  const copied = parseMemoryFile(await readFile(join(result.targetDir, 'workspace/.24pa/memory.json'), 'utf8'));
  expect(copied.records).toMatchObject([{ id: 'kept', content: 'newest-current-value' }]); expect(copied.tombstones[0].id).toBe('purged');
  for (const name of await readdir(join(result.targetDir, 'workspace/.24pa/changesets'))) expect(await readFile(join(result.targetDir, 'workspace/.24pa/changesets', name), 'utf8')).not.toContain('deleted-secret-body-purged');
  expect(await readFile(join(f.sources.workspace, '.24pa/memory.json'))).toEqual(currentBytes); expect(await readFile(join(created.backupDir, 'workspace/.24pa/memory.json'))).toEqual(oldBytes);
  await expect(assertLiveWorkspace(join(result.targetDir, 'workspace'))).rejects.toThrow('恢复隔离');
  await expect(assertLiveWorkspace(join(created.backupDir, 'workspace'))).rejects.toThrow('恢复隔离');
  await store.put({ ...record('kept'), content: 'changed again' }, opts(5));
  await expect(inspectRecovery(f.context, created.backupDir, join(f.root, 'stale'), true, preview.previewToken)).rejects.toThrow('预览');
  await expect(readFile(join(f.root, 'stale/backup-manifest.json'))).rejects.toThrow();
});

it('corrupt current JSON and pending audit block restoration; existing or source targets are untouched', async () => {
  const f = await fixture(); const created = await f.create();
  await writeFile(join(f.sources.workspace, '.24pa/memory.json'), '{bad');
  await expect(previewRestore(f.context, created.backupDir)).rejects.toThrow('JSON');
  await rm(join(f.sources.workspace, '.24pa/memory.json'));
  await writeFile(join(f.sources.workspace, '.24pa/memory-audit-pending.json'), '{}');
  await expect(previewRestore(f.context, created.backupDir)).rejects.toThrow('待核对');
  await rm(join(f.sources.workspace, '.24pa/memory-audit-pending.json'));
  await expect(inspectRecovery(f.context, created.backupDir, f.sources.workspace, false)).rejects.toThrow('隔离');
  await mkdir(join(f.root, 'existing')); await writeFile(join(f.root, 'existing/keep'), 'safe');
  await expect(inspectRecovery(f.context, created.backupDir, join(f.root, 'existing'), false)).rejects.toThrow();
  expect(await readFile(join(f.root, 'existing/keep'), 'utf8')).toBe('safe');
});

it('PG dump meta-command and server-program escape attempts fail in isolated restricted import', async () => {
  const f = await fixture('postgres'), created = await f.create();
  const file = join(created.backupDir, 'pa24.sql');
  const marker = join(f.root, 'must-not-exist');
  const original = await readFile(file);
  await writeFile(file, Buffer.concat([Buffer.from(`\\! touch ${marker}\n`), original]));
  await expect(openBackupLedger(created.backupDir, 'postgres')).rejects.toThrow('退出码');
  await expect(readFile(marker)).rejects.toThrow();
  await writeFile(file, Buffer.from(`COPY (SELECT 1) TO PROGRAM 'touch ${marker}';\n`));
  await expect(openBackupLedger(created.backupDir, 'postgres')).rejects.toThrow('退出码');
  await expect(readFile(marker)).rejects.toThrow();
}, 180_000);
