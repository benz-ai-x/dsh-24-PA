import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { WorkspaceBackup } from '../../lib/backup.js';
import { SqliteDb } from '../../lib/sqlite.js';

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
  await db.migrate();
  cleanup.push(() => db.close());
  return { root, sources, assets, backup: new WorkspaceBackup(sources, db), db };
}
const create = f => f.backup.create(join(f.root, 'backups'), { credentialReferences: ['PA24_PG_DSN'], watermarks: [] });

describe('workspace backup recovery coverage', () => {
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
