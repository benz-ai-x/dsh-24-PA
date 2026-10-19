import { randomUUID } from 'node:crypto';
import { mkdir, lstat, readdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { PaDb } from './db.js';
import { sha256Hex } from './handwriting.js';

type FileEntry = { path: string; bytes: number; sha256: string };
type Collection = { id: string; root?: string; required: boolean; includes?: string[]; excludes?: string[] };
type Coverage = { id: string; required: boolean; state: 'copied' | 'absent' | 'unconfigured'; files: number };
const COLLECTION_IDS = ['workspace', 'dsh-state', 'sessions', 'storages', 'attachments'];

/** Owns both the collection policy and its evidence. A digest of an incomplete
 * file list is not proof that the required recovery assets were collected. */
export class WorkspaceBackup {
  constructor(private readonly sources: {
    workspace: string; stateDirectory: string;
    sessions?: string; storages?: string; attachments?: string;
  }, private readonly db: PaDb) {}

  async create(targetDir: string, metadata: { credentialReferences: string[]; watermarks: unknown }) {
    if (!isAbsolute(targetDir)) throw new Error('需要绝对目标目录 targetDir。');
    const collections: Collection[] = [
      { id: 'workspace', root: this.sources.workspace, required: true,
        includes: ['AGENTS.md', '.24pa', '.dsh/skills'], excludes: ['.24pa/secrets.json'] },
      { id: 'dsh-state', root: this.sources.stateDirectory, required: true, excludes: ['host.lock'] },
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
    for (const part of await this.db.backup()) await add(part.id, part.name, part.bytes);
    for (const collection of collections) {
      const { id, root, required } = collection;
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
      const walk = async (rel: string): Promise<void> => {
        const posix = rel.split(sep).join('/');
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
          await mkdir(dirname(join(dir, id, rel)), { recursive: true });
          await writeFile(join(dir, id, rel), bytes);
          files.push({ path: posix, bytes: bytes.length, sha256: sha256Hex(bytes) });
        } else throw new Error(`备份源含非普通文件：${id}/${posix}`);
      };
      await walk('');
      await add(`${id}-manifest`, `${id}-manifest.json`, Buffer.from(JSON.stringify({ root, directories, files }, null, 2)));
      coverage.push({ id, required, state: 'copied', files: files.length });
    }
    const manifest = {
      formatVersion: 2, createdAt: new Date().toISOString(), storage: this.db.kind,
      schemaVersion: await this.db.schemaVersion(), parts, coverage, ...metadata,
      consistency: 'live-copy',
      note: '在线文件快照；恢复前停止 Host，核对外部对象及旧 Outbox。凭据不包含在备份中。',
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
    if (manifest.formatVersion !== 2) failures.push('旧格式缺少集合覆盖证据，不能证明联合备份完整；请重新创建备份');
    const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
    const coverage: Coverage[] = Array.isArray(manifest.coverage) ? manifest.coverage : [];
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
            const data = await safeRead(join(dir, id), file.path);
            if (data.length !== file.bytes || sha256Hex(data) !== file.sha256) throw new Error(`文件摘要不符：${file.path}`);
          }
          for (const path of listing.directories) await safePath(join(dir, id), path, true);
          if (id === 'workspace' && (!paths.has('AGENTS.md') || !listing.directories.includes('.24pa'))) throw new Error('缺少 AGENTS.md 或 .24pa 工作区集合');
          if (id === 'workspace' && paths.has('.24pa/secrets.json')) throw new Error('工作区备份含凭据');
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
      complete: failures.length === 0, failures, parts: results, coverage,
      message: failures.length ? `备份不完整（${failures.join('；')}）。`
        : '备份完整：账本与全部清单/文件逐个摘要匹配。恢复顺序：停止 Host，恢复账本及各集合到清单原路径，补充凭据；核对外部对象和旧 Outbox 后再启动。在线快照不保证跨系统同一事务时点。' };
  }
}

function within(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
async function safePath(root: string, path: string, directory = false) {
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
async function safeRead(root: string, path: string) {
  return readFile(await safePath(root, path));
}
