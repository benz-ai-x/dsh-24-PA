import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// The dsh web Host has no built-in second-instance guard, so the plugin
// refuses to become the active writer when another live process still holds
// the state-directory lock (P01: a second active Host is rejected).

export class HostAlreadyActive extends Error {
  constructor(public readonly holder: { pid: number; startedAt: string; path: string }) {
    super(`已有活跃的24私助 Host（pid ${holder.pid}，自 ${holder.startedAt} 运行）；同一状态目录只允许一个写实例。`);
    this.name = 'HostAlreadyActive';
  }
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
  const record = { pid: process.pid, startedAt: new Date().toISOString() };
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let previous: { pid?: number; startedAt?: string };
    try {
      previous = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      previous = {};
    }
    const pid = Number(previous.pid);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      throw new HostAlreadyActive({ pid, startedAt: String(previous.startedAt ?? '未知时间'), path });
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
