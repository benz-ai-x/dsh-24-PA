import { open, readFile, rename, unlink } from 'node:fs/promises';
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

export async function acquireHostLock(stateDirectory: string): Promise<HostLock> {
  const path = join(stateDirectory, 'host.lock');
  const record = { pid: process.pid, startedAt: new Date().toISOString(), argv: process.argv, cwd: process.cwd() };
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let previous: { pid?: number; startedAt?: string; argv?: string[]; cwd?: string };
    try {
      previous = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      previous = {};
    }
    const pid = Number(previous.pid);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      throw new HostAlreadyActive({
        pid,
        startedAt: String(previous.startedAt ?? '未知时间'),
        path,
        ...(Array.isArray(previous.argv) ? { argv: previous.argv } : {}),
        ...(typeof previous.cwd === 'string' ? { cwd: previous.cwd } : {}),
      });
    }
    // Stale holder (crashed or unreadable record): archive and take over.
    await rename(path, `${path}.stale-${Date.now()}`).catch(() => {});
    handle = await open(path, 'wx', 0o600);
  }
  try {
    await handle.writeFile(JSON.stringify(record) + '\n');
  } finally {
    await handle.close();
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await unlink(path).catch(() => {});
    },
  };
}
