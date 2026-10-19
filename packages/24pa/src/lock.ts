import { mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

// The dsh web Host has no built-in second-instance guard, so the plugin
// refuses to become the active writer when another live process still holds
// the state-directory lock (P01: a second active Host is rejected).

export interface HostLockHolder {
  pid: number;
  startedAt: string;
  path: string;
  /** Holder-recorded command line; absent in lock files from older releases. */
  argv?: string[];
  /** Holder-recorded working directory; absent in lock files from older releases. */
  cwd?: string;
}

export class HostAlreadyActive extends Error {
  constructor(public readonly holder: HostLockHolder) {
    super(
      `已有活跃的24私助 Host（pid ${holder.pid}，自 ${holder.startedAt} 运行` +
        describeHolder(holder) +
        `，锁文件 ${holder.path}）；同一状态目录只允许一个写实例。`,
    );
    this.name = 'HostAlreadyActive';
  }
}

function describeHolder(holder: HostLockHolder): string {
  const parts: string[] = [];
  if (holder.argv?.length) {
    const command = holder.argv.join(' ');
    parts.push(`，命令「${command.length > 300 ? `${command.slice(0, 300)}…` : command}」`);
  }
  if (holder.cwd) parts.push(`，工作目录 ${holder.cwd}`);
  return parts.join('');
}

export interface HostLock {
  release(): Promise<void>;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type Owner = Omit<HostLockHolder, 'path'>;

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function readOwner(path: string): Promise<Owner | null> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if (code(error) === 'ENOENT') return null; throw error; }
  let value: Owner;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`无法核实 Host 锁记录，请确认旧 Host 已退出后检查 ${path}。`); }
  if (!value || !Number.isInteger(value.pid) || value.pid <= 0) throw new Error(`无法核实 Host 锁持有进程：${path}。`);
  return value;
}

function rejectLive(owner: Owner, path: string): void {
  if (isAlive(owner.pid)) throw new HostAlreadyActive({ ...owner, startedAt: String(owner.startedAt ?? '未知时间'), path });
}

// Exact, unrepeatable owner names prevent late reapers from deleting a new
// owner. rmdir cannot remove the successor's nonempty directory.
async function removeOwner(directory: string, name: string): Promise<void> {
  await unlink(join(directory, name)).catch(error => { if (code(error) !== 'ENOENT') throw error; });
  await rmdir(directory).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(code(error) ?? '')) throw error;
  });
}

export async function acquireHostLock(stateDirectory: string): Promise<HostLock> {
  await mkdir(stateDirectory, { recursive: true });
  // Old files are read-only: supporting their format cannot make the old
  // blind-rename writer safe when running concurrently with an upgrade.
  const legacyPath = join(stateDirectory, 'host.lock');
  const legacy = await readOwner(legacyPath);
  if (legacy) rejectLive(legacy, legacyPath);
  const directory = join(stateDirectory, 'host.lock.d');
  const name = `owner-${randomUUID()}.json`;
  const candidate = await mkdtemp(join(stateDirectory, '.host-lock-'));
  const record: Owner = { pid: process.pid, startedAt: new Date().toISOString(), argv: process.argv, cwd: process.cwd() };
  try {
    await writeFile(join(candidate, name), JSON.stringify(record) + '\n', { mode: 0o600 });
    for (;;) {
      try { await rename(candidate, directory); break; }
      catch (error) { if (!['ENOTEMPTY', 'EEXIST'].includes(code(error) ?? '')) throw error; }
      const names = await readdir(directory).catch(error => { if (code(error) === 'ENOENT') return []; throw error; });
      // Empty means release/reaping completed its unlink; the already complete
      // candidate can atomically replace that empty directory on the next pass.
      if (!names.length) continue;
      if (names.length !== 1 || !/^owner-[0-9a-f-]+\.json$/.test(names[0]!)) throw new Error(`无法核实 Host 锁目录内容：${directory}。`);
      const previous = await readOwner(join(directory, names[0]!));
      if (!previous) continue;
      rejectLive(previous, directory);
      await removeOwner(directory, names[0]!);
    }
  } finally {
    await removeOwner(candidate, name);
  }
  let releasing: Promise<void> | undefined;
  return { release: () => releasing ??= removeOwner(directory, name) };
}
