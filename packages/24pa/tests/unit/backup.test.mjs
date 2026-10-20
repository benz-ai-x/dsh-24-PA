import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { WorkspaceBackup } from '../../lib/backup.js';
import { SqliteDb } from '../../lib/sqlite.js';
import { workspaceLedgerIdentity } from '../../lib/ledger-identity.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pa24-backup-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const sources = Object.fromEntries(['workspace', 'stateDirectory', 'sessions', 'storages', 'attachments'].map(k => [k, join(root, k)]));
  for (const dir of Object.values(sources)) await mkdir(dir);
  const assets = {
    'AGENTS.md': '# owner workspace', '.24pa/memory/memory.json': '{"revision":2}',
    '.24pa/originals/note/page.png': 'original-image', '.24pa/revisions/note/v1.json': '{"version":1}',
    '.dsh/skills/custom/SKILL.md': '# Custom skill', '.24pa/roles.json': '["custom-role"]',
  };
  for (const [path, content] of Object.entries(assets)) {
    await mkdir(dirname(join(sources.workspace, path)), { recursive: true });
    await writeFile(join(sources.workspace, path), content);
  }
  await writeFile(join(sources.workspace, '.24pa/secrets.json'), '{"appSecret":"never-backup"}');
  await writeFile(join(sources.workspace, '.24pa/secrets.json.pa24-tmp'), '{"appSecret":"interrupted-write"}');
  await writeFile(join(sources.sessions, 'session.jsonl'), '{"turn":1}');
  await writeFile(join(sources.attachments, 'image.bin'), 'image');
  await writeFile(join(sources.storages, 'schedule.json'), '[]');
  await writeFile(join(sources.stateDirectory, 'host.lock'), 'stale pid');
  await mkdir(join(sources.stateDirectory, 'host.lock.d'));
  await writeFile(join(sources.stateDirectory, 'host.lock.d/owner-test.json'), 'live owner');
  const db = new SqliteDb(join(root, 'ledger.db'));
  await db.migrate(await workspaceLedgerIdentity(sources.workspace, 'owner'));
  cleanup.push(() => db.close());
  return { root, sources, assets, backup: new WorkspaceBackup(sources, db), db };
}
const create = f => f.backup.create(join(f.root, 'backups'), { credentialReferences: ['PA24_PG_DSN'], watermarks: [] });

describe('workspace backup recovery coverage', () => {
  it.each(['missing', 'damaged', 'different'])('schema 17 backup cannot report complete with %s workspace identity', async state => {
    const f = await fixture();
    const file = join(f.sources.workspace, '.24pa', 'ledger-identity.json');
    if (state === 'missing') await rm(file);
    else await writeFile(file, state === 'damaged' ? '{broken' : JSON.stringify({ version: 1, workspaceId: '00000000-0000-4000-8000-000000000000' }));
    const result = await create(f);
    expect(result.complete).toBe(false);
    expect(result.failures.join(' ')).toMatch(/身份/);
  });

  it('concurrent external transactions leave a coherent two-table snapshot', async () => {
    const f = await fixture();
    await f.db.query('create table backup_left (version integer)');
    await f.db.query('create table backup_right (version integer)');
    await f.db.query('create table backup_payload (bytes blob)');
    await f.db.query('insert into backup_left values (0)');
    await f.db.query('insert into backup_right values (0)');
    await f.db.query('insert into backup_payload values (zeroblob(8388608))');
    const progress = new SharedArrayBuffer(8);
    const worker = new Worker(new URL('../helpers/sqlite-backup-writer.mjs', import.meta.url), { workerData: { path: f.db.filePath, progress } });
    cleanup.push(() => worker.terminate());
    const exit = once(worker, 'exit');
    await once(worker, 'message');
    const pending = create(f);
    worker.postMessage('write');
    const result = await pending;
    expect(Atomics.load(new Int32Array(progress), 0)).toBeGreaterThan(0);
    expect(await exit).toEqual([0]);
    expect(result.complete).toBe(true);
    const restored = new DatabaseSync(join(result.backupDir, 'pa24.db'));
    try {
      const left = restored.prepare('select version from backup_left').all()[0].version;
      const right = restored.prepare('select version from backup_right').all()[0].version;
      expect(left).toBe(right);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(25);
      expect(restored.prepare('select length(bytes) n from backup_payload').all()[0].n).toBe(8388608);
    } finally { restored.close(); }
  });
  it('restores committed business rows when a reader retires and the live WAL changes generation during backup', async () => {
    const f = await fixture();
    await f.db.query('pragma busy_timeout = 0');
    f.db.checkpoint();
    const reader = new DatabaseSync(f.db.filePath);
    const writer = new DatabaseSync(f.db.filePath);
    cleanup.push(() => reader.close(), () => writer.close());
    reader.exec('begin');
    reader.prepare('select * from pa24_memo').all();
    await f.db.query("insert into pa24.memo (id, topic, content, source) values ('before', 'backup', 'committed before backup', 'test')");

    // Coordinate a real external writer at the filesystem seam: once the
    // first database artifact has been read, retire the old read snapshot,
    // truncate the live WAL and commit into a new WAL generation.
    const originalRead = fs.promises.readFile;
    let switched = false;
    fs.promises.readFile = async (path, ...args) => {
      const bytes = await originalRead(path, ...args);
      if (!switched && String(path).endsWith('.db')) {
        switched = true;
        reader.exec('rollback');
        expect(writer.prepare('pragma wal_checkpoint(truncate)').all()[0].busy).toBe(0);
        writer.exec("insert into pa24_task (id, task_guid, summary) values ('after', 'after-guid', 'new WAL generation')");
      }
      return bytes;
    };
    syncBuiltinESMExports();
    let result;
    try { result = await create(f); }
    finally { fs.promises.readFile = originalRead; syncBuiltinESMExports(); }
    expect(switched).toBe(true);
    expect(result.complete).toBe(true);
    const restored = new DatabaseSync(join(result.backupDir, 'pa24.db'));
    try {
      expect(restored.prepare('select id, content from pa24_memo order by id').all()).toEqual([
        { id: 'before', content: 'committed before backup' },
      ]);
      expect(restored.prepare('pragma integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    } finally { restored.close(); }
    expect((await f.db.query('select id from pa24.memo')).rows).toEqual([{ id: 'before' }]);
    expect((await f.db.query('select id from pa24.task')).rows).toEqual([{ id: 'after' }]);
  });
  it('restores memory, originals, revisions, skills, host data and the real SQLite ledger; excludes secrets and live locks', async () => {
    const f = await fixture();
    const result = await create(f);
    expect(result.complete).toBe(true);
    const restore = join(f.root, 'restored');
    await cp(join(result.backupDir, 'workspace'), restore, { recursive: true });
    for (const [path, content] of Object.entries(f.assets)) expect(await readFile(join(restore, path), 'utf8')).toBe(content);
    await expect(readFile(join(restore, '.24pa/secrets.json'))).rejects.toThrow();
    await expect(readFile(join(restore, '.24pa/secrets.json.pa24-tmp'))).rejects.toThrow();
    await expect(readFile(join(result.backupDir, 'dsh-state/host.lock'))).rejects.toThrow();
    await expect(readFile(join(result.backupDir, 'dsh-state/host.lock.d/owner-test.json'))).rejects.toThrow();
    expect(await readFile(join(result.backupDir, 'sessions/session.jsonl'), 'utf8')).toContain('turn');
    const restored = new SqliteDb(join(result.backupDir, 'pa24.db'));
    try { expect(await restored.schemaVersion()).toBe(await f.db.schemaVersion()); } finally { await restored.close(); }
  });
  it('detects removed content and a modified file-list manifest', async () => {
    const f = await fixture();
    const result = await create(f);
    await rm(join(result.backupDir, 'workspace/.24pa/originals/note/page.png'));
    expect((await WorkspaceBackup.verify(result.backupDir)).complete).toBe(false);
    const path = join(result.backupDir, 'workspace-manifest.json');
    const listing = JSON.parse(await readFile(path, 'utf8'));
    listing.files = listing.files.filter(x => !x.path.includes('page.png'));
    await writeFile(path, JSON.stringify(listing));
    expect((await WorkspaceBackup.verify(result.backupDir)).failures.join()).toContain('摘要');
  });
  it('does not certify a legacy SQLite live-copy bundle as a consistent ledger snapshot', async () => {
    const f = await fixture();
    const result = await create(f);
    const path = join(result.backupDir, 'backup-manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.formatVersion = 2;
    delete manifest.ledgerConsistency;
    await writeFile(path, JSON.stringify(manifest));
    const checked = await WorkspaceBackup.verify(result.backupDir);
    expect(checked.complete).toBe(false);
    expect(checked.failures.join()).toContain('一致快照');
  });
  it.each(['snapshot-read', 'target-write'])('%s failure preserves the source and an earlier verified backup; retry is restorable', async fault => {
    const f = await fixture();
    const previous = await create(f);
    const previousManifest = await readFile(join(previous.backupDir, 'backup-manifest.json'));
    await f.db.query("insert into pa24.memo (id, topic, content, source) values ('survivor', 'backup', 'preserved', 'test')");
    const operation = fault === 'snapshot-read' ? 'readFile' : 'writeFile';
    const original = fs.promises[operation];
    let failedPath;
    fs.promises[operation] = async (path, ...args) => {
      if (!failedPath && String(path).endsWith('.db')) {
        failedPath = String(path);
        throw new Error('injected filesystem failure');
      }
      return original(path, ...args);
    };
    syncBuiltinESMExports();
    try { await expect(create(f)).rejects.toThrow('injected filesystem failure'); }
    finally { fs.promises[operation] = original; syncBuiltinESMExports(); }
    expect(failedPath).toBeTruthy();
    if (fault === 'snapshot-read') await expect(stat(dirname(failedPath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(previous.backupDir, 'backup-manifest.json'))).toEqual(previousManifest);
    expect((await WorkspaceBackup.verify(previous.backupDir)).complete).toBe(true);
    expect((await f.db.query('select id from pa24.memo')).rows).toEqual([{ id: 'survivor' }]);
    const retried = await create(f);
    expect(retried.complete).toBe(true);
    const restored = new DatabaseSync(join(retried.backupDir, 'pa24.db'));
    try { expect(restored.prepare('select content from pa24_memo').all()).toEqual([{ content: 'preserved' }]); }
    finally { restored.close(); }
  });
  it('does not certify old empty manifests or a missing required collection', async () => {
    const f = await fixture();
    await rm(f.sources.sessions, { recursive: true });
    const result = await create(f);
    expect(result.complete).toBe(false);
    expect(result.failures.join()).toContain('sessions');
    await writeFile(join(result.backupDir, 'backup-manifest.json'), JSON.stringify({ parts: [] }));
    expect((await WorkspaceBackup.verify(result.backupDir)).complete).toBe(false);
  });
  it('rejects credential temporary files even if their manifest hashes match', async () => {
    const f = await fixture();
    const result = await create(f);
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    const bytes = Buffer.from('{"appSecret":"must-not-restore"}');
    const secretPath = '.24pa/secrets.json.pa24-tmp';
    await writeFile(join(result.backupDir, 'workspace', secretPath), bytes);
    const listingPath = join(result.backupDir, 'workspace-manifest.json');
    const listing = JSON.parse(await readFile(listingPath, 'utf8'));
    listing.files.push({ path: secretPath, bytes: bytes.length, sha256: digest(bytes) });
    const listingBytes = Buffer.from(JSON.stringify(listing));
    await writeFile(listingPath, listingBytes);
    const manifestPath = join(result.backupDir, 'backup-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    Object.assign(manifest.parts.find(p => p.id === 'workspace-manifest'), { bytes: listingBytes.length, sha256: digest(listingBytes) });
    manifest.coverage.find(c => c.id === 'workspace').files++;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const checked = await WorkspaceBackup.verify(result.backupDir);
    expect(checked.complete).toBe(false);
    expect(checked.failures.join()).toContain('凭据');
  });
  it('rejects symlinks and recursive destinations instead of silently collecting unrelated content', async () => {
    const f = await fixture();
    await symlink(join(f.sources.workspace, '.24pa/secrets.json'), join(f.sources.workspace, '.24pa/alias.json'));
    await expect(create(f)).rejects.toThrow('符号链接');
    await expect(f.backup.create(join(f.sources.workspace, 'backups'), { credentialReferences: [], watermarks: [] })).rejects.toThrow('源目录');
  });
});
