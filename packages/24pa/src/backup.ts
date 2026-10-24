import { randomUUID } from 'node:crypto';
import { mkdir, lstat, readdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { PaDb } from './db.js';
import { sha256Hex } from './handwriting.js';
import { readLedgerOwner } from './repo/ledger.js';
import { parseWorkspaceIdentity } from './ledger-identity.js';

export type FileEntry = { path: string; bytes: number; sha256: string };
type Collection = { id: string; root?: string; required: boolean; includes?: string[]; excludes?: string[] };
export type Coverage = { id: string; required: boolean; state: 'copied' | 'absent' | 'unconfigured'; files: number; startedAt?: string; finishedAt?: string; changedFiles?: string[] };
const COLLECTION_IDS = ['workspace', 'dsh-state', 'sessions', 'storages', 'attachments'];
export const RESTORE_ISOLATION_FILE = '.24pa/restore-isolation.json';
const CREDENTIAL_FILE = /(?:^|\/)(?:\.credentials\.(?:yaml|yml|json)|\.env(?:\.[^/]*)?|secrets\.json(?:\.[^/]*)?|(?:access|refresh)[-_]token(?:\.[^/]*)?|auth[-_]cache(?:\.[^/]*)?)$/i;
const CREDENTIAL_PATHS = ['.24pa/secrets.json', '.24pa/secrets.json.pa24-tmp'];

/** Owns both the collection policy and its evidence. A digest of an incomplete
 * file list is not proof that the required recovery assets were collected. */
export class WorkspaceBackup {
  constructor(private readonly sources: {
    workspace: string; stateDirectory: string;
    sessions?: string; storages?: string; attachments?: string;
  }, private readonly db: PaDb) {}

  async create(targetDir: string, metadata: { credentialReferences: string[]; watermarks: unknown; versions?: Record<string, unknown> }) {
    if (!isAbsolute(targetDir)) throw new Error('需要绝对目标目录 targetDir。');
    const startedAt = new Date().toISOString();
    const schemaVersion = await this.db.schemaVersion();
    const ledgerOwner = schemaVersion >= 17 ? await readLedgerOwner(this.db) : null;
    const collections: Collection[] = [
      { id: 'workspace', root: this.sources.workspace, required: true,
        includes: ['AGENTS.md', '.24pa', '.dsh/skills'], excludes: CREDENTIAL_PATHS },
      { id: 'dsh-state', root: this.sources.stateDirectory, required: true, excludes: ['host.lock', 'host.lock.d'] },
      { id: 'sessions', root: this.sources.sessions, required: true },
      { id: 'storages', root: this.sources.storages, required: true },
      { id: 'attachments', root: this.sources.attachments, required: false },
    ];
    await mkdir(targetDir, { recursive: true });
    const target = await realpath(targetDir);
    for (const collection of collections) {
      if (collection.root && within(await realpath(collection.root).catch(() => resolve(collection.root!)), target)) {
        throw new Error(`备份目标不能位于源目录内：${collection.id}`);
      }
    }
    const dir = join(target, `pa24-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
    await mkdir(dir);
    const parts: (FileEntry & { id: string })[] = [];
    const coverage: Coverage[] = [];
    const add = async (id: string, path: string, bytes: Buffer) => {
      await writeFile(join(dir, path), bytes);
      parts.push({ id, path, bytes: bytes.length, sha256: sha256Hex(bytes) });
    };
    const ledgerStartedAt = new Date().toISOString();
    for (const part of await this.db.backup()) await add(part.id, part.name, part.bytes);
    const ledgerFinishedAt = new Date().toISOString();
    for (const collection of collections) {
      const { id, root, required } = collection;
      const collectionStartedAt = new Date().toISOString();
      const rootStat = root ? await lstat(root).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }) : null;
      if (!rootStat) {
        coverage.push({ id, required, state: root ? 'absent' : 'unconfigured', files: 0 });
        continue;
      }
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`备份源必须是实际目录：${id}`);
      const files: FileEntry[] = [];
      const directories: string[] = [];
      const changedFiles: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        const posix = rel.split(sep).join('/');
        if (CREDENTIAL_FILE.test(posix)) return;
        if (collection.excludes?.some(p => posix === p || posix.startsWith(`${p}/`))) return;
        if (collection.includes && !collection.includes.some(p => posix === p || posix.startsWith(`${p}/`) || p.startsWith(`${posix}/`)) && rel !== '') return;
        const path = join(root!, rel);
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw new Error(`备份拒绝符号链接：${id}/${posix}`);
        if (info.isDirectory()) {
          directories.push(posix);
          await mkdir(join(dir, id, rel), { recursive: true });
          for (const entry of (await readdir(path)).sort()) await walk(join(rel, entry));
        } else if (info.isFile()) {
          const bytes = await readFile(path);
          const after = await lstat(path);
          if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || !after.isFile() || after.isSymbolicLink()) changedFiles.push(posix);
          await mkdir(dirname(join(dir, id, rel)), { recursive: true });
          await writeFile(join(dir, id, rel), bytes);
          files.push({ path: posix, bytes: bytes.length, sha256: sha256Hex(bytes) });
        } else throw new Error(`备份源含非普通文件：${id}/${posix}`);
      };
      await walk('');
      if (id === 'workspace') {
        const marker = Buffer.from(JSON.stringify({ version: 1, state: 'isolated', createdAt: new Date().toISOString(), reason: '备份副本，禁止绑定运行；先在隔离位置校验并核对外部动作、旧投递和凭据。' }));
        await mkdir(join(dir, id, '.24pa'), { recursive: true });
        await writeFile(join(dir, id, RESTORE_ISOLATION_FILE), marker, { mode: 0o600 });
        const old = files.findIndex(file => file.path === RESTORE_ISOLATION_FILE);
        if (old >= 0) files.splice(old, 1);
        files.push({ path: RESTORE_ISOLATION_FILE, bytes: marker.length, sha256: sha256Hex(marker) });
      }
      await add(`${id}-manifest`, `${id}-manifest.json`, Buffer.from(JSON.stringify({ root, directories, files }, null, 2)));
      coverage.push({ id, required, state: 'copied', files: files.length, startedAt: collectionStartedAt, finishedAt: new Date().toISOString(), changedFiles });
    }
    const manifest = {
      formatVersion: 4, startedAt, ledgerStartedAt, ledgerFinishedAt, createdAt: new Date().toISOString(), storage: this.db.kind,
      schemaVersion, ledgerWorkspaceId: ledgerOwner?.workspace_id ?? null, parts, coverage, ...metadata,
      consistency: 'live-copy',
      ledgerConsistency: 'snapshot',
      note: '业务账本为一致快照，其余文件在线收集，不保证跨系统同一事务时点；恢复前停止 Host，核对外部对象及旧 Outbox。凭据不包含在备份中。',
    };
    await writeFile(join(dir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2));
    const checked = await WorkspaceBackup.verify(dir);
    return { ...checked, parts: parts.map(({ id, bytes }) => ({ id, bytes })),
      workspaceFiles: coverage.find(c => c.id === 'workspace')?.files ?? 0,
      sessionsFiles: coverage.find(c => c.id === 'sessions')?.files ?? 0,
      message: `联合备份已生成于 ${dir}；${checked.message}` };
  }

  static async verify(dir: string) {
    if (!isAbsolute(dir)) throw new Error('需要绝对 backupDir。');
    const manifest = JSON.parse((await safeRead(dir, 'backup-manifest.json')).toString());
    const failures: string[] = [];
    const results: { id: string; ok: boolean; files?: number }[] = [];
    if (![2, 3, 4].includes(manifest.formatVersion)) failures.push('不支持的格式或缺少集合覆盖证据，不能证明联合备份完整；请重新创建备份');
    if (manifest.schemaVersion >= 17 && typeof manifest.ledgerWorkspaceId !== 'string') failures.push('缺少已登记的账本工作区身份');
    const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
    if (manifest.storage === 'sqlite' && (![3, 4].includes(manifest.formatVersion) || manifest.ledgerConsistency !== 'snapshot'
      || parts.some((part: FileEntry & { id: string }) => part.id === 'sqlite-wal' || part.path === 'pa24.db-wal'))) {
      failures.push('SQLite 备份缺少独立一致快照证明；旧 DB/WAL 文件集合不能认证，请重新创建备份');
    }
    const coverage: Coverage[] = Array.isArray(manifest.coverage) ? manifest.coverage : [];
    for (const c of coverage) if (c.changedFiles?.length) failures.push(`${c.id}: 采集期间文件发生变化，时间范围不一致（${c.changedFiles.length} 项）`);
    const ids = new Set<string>();
    for (const part of parts) {
      if (ids.has(part.id)) failures.push(`重复的备份部分：${part.id}`);
      ids.add(part.id);
      let ok = true;
      let count: number | undefined;
      try {
        const bytes = await safeRead(dir, part.path);
        if (sha256Hex(bytes) !== part.sha256 || bytes.length !== part.bytes) throw new Error('摘要或大小不符');
        if (String(part.id).endsWith('-manifest')) {
          const id = String(part.id).replace(/-manifest$/, '');
          if (!COLLECTION_IDS.includes(id)) throw new Error('未知集合');
          const listing = JSON.parse(bytes.toString());
          if (!Array.isArray(listing.files) || !Array.isArray(listing.directories)) throw new Error('文件/目录清单缺失');
          count = listing.files.length;
          const paths = new Set<string>();
          for (const file of listing.files) {
            if (paths.has(file.path)) throw new Error('重复文件');
            paths.add(file.path);
            if (CREDENTIAL_FILE.test(file.path)) throw new Error('集合含凭据或授权缓存文件');
            const data = await safeRead(join(dir, id), file.path);
            if (data.length !== file.bytes || sha256Hex(data) !== file.sha256) throw new Error(`文件摘要不符：${file.path}`);
          }
          for (const path of listing.directories) await safePath(join(dir, id), path, true);
          if (id === 'workspace' && (!paths.has('AGENTS.md') || !listing.directories.includes('.24pa'))) throw new Error('缺少 AGENTS.md 或 .24pa 工作区集合');
          if (id === 'workspace' && manifest.schemaVersion >= 17) {
            const identityPath = '.24pa/ledger-identity.json';
            if (!paths.has(identityPath)) throw new Error('缺少账本恢复所需的工作区身份文件');
            const identity = parseWorkspaceIdentity((await safeRead(join(dir, id), identityPath)).toString());
            if (identity !== manifest.ledgerWorkspaceId) throw new Error('备份工作区身份与账本归属不符');
          }
          if (id === 'workspace' && CREDENTIAL_PATHS.some(path => paths.has(path))) throw new Error('工作区备份含凭据');
          if (coverage.find(c => c.id === id)?.files !== count) throw new Error('集合计数不符');
        }
      } catch (error) { ok = false; failures.push(`${part.id}: ${(error as Error).message}`); }
      results.push({ id: part.id, ok, ...(count === undefined ? {} : { files: count }) });
    }
    const ledgerName = manifest.storage === 'sqlite' ? 'pa24.db' : 'pa24.sql';
    if (!parts.some((p: FileEntry) => p.path === ledgerName)) failures.push('缺少账本备份');
    for (const id of COLLECTION_IDS) {
      const c = coverage.find(c => c.id === id);
      if (!c || c.state === 'unconfigured' || (id !== 'attachments' && c.state !== 'copied') || (c.state === 'copied' && !ids.has(`${id}-manifest`))) failures.push(`缺少集合覆盖：${id}`);
    }
    return { backupDir: dir, createdAt: manifest.createdAt, schemaVersion: manifest.schemaVersion,
      manifestHash: sha256Hex(await safeRead(dir, 'backup-manifest.json')),
      storage: manifest.storage,
      sourceVersion: { format: manifest.formatVersion, schema: manifest.schemaVersion, versions: manifest.versions ?? null },
      capturedAt: { startedAt: manifest.startedAt ?? null, ledgerStartedAt: manifest.ledgerStartedAt ?? null, ledgerFinishedAt: manifest.ledgerFinishedAt ?? null, finishedAt: manifest.createdAt, simultaneous: false },
      scope: 'file-integrity', complete: failures.length === 0, failures, parts: results, coverage,
      message: failures.length ? `备份不完整（${failures.join('；')}）。`
        : '备份完整：账本与全部清单/文件逐个摘要匹配。恢复顺序：停止 Host，先恢复到账本与文件的隔离暂存区，检查 schema、记忆 revision、来源与过期状态，并与目标比较；保留较新记忆，冲突由主人明确选择后再替换原路径，保留旧目录并补充凭据。核对外部对象和旧 Outbox 后再启动。在线快照不保证跨系统同一事务时点。' };
  }
}

export function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
export async function safePath(root: string, path: string, directory = false) {
  if (typeof path !== 'string' || isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('清单路径越界');
  const result = resolve(root, path);
  if (!within(resolve(root), result)) throw new Error('清单路径越界');
  let cursor = resolve(root);
  for (const segment of ['', ...relative(cursor, result).split(sep).filter(Boolean)]) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error('清单路径含符号链接');
  }
  const info = await lstat(result);
  if (directory ? !info.isDirectory() : !info.isFile()) throw new Error('清单路径类型不符');
  return result;
}
export async function safeRead(root: string, path: string) {
  return readFile(await safePath(root, path));
}

/** A recovery copy cannot be activated by ordinary restart/bind paths. */
export async function assertLiveWorkspace(path: string): Promise<void> {
  try { await lstat(join(path, RESTORE_ISOLATION_FILE)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('这是处于恢复隔离状态的工作区；禁止启动运行、日程调度、入站和旧投递。请查阅恢复演练记录，完成远端对账与凭据恢复后按引导人工切换。');
}
