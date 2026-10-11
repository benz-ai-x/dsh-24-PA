import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireHostLock, HostAlreadyActive } from '../../lib/lock.js';

describe('单 Host 锁', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pa24-lock-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('同一状态目录的第二个活跃 Host 被拒绝', async () => {
    const first = await acquireHostLock(dir);
    await expect(acquireHostLock(dir)).rejects.toBeInstanceOf(HostAlreadyActive);
    await first.release();
  });

  it('拒绝时报错带持锁方命令行、工作目录与锁文件路径', async () => {
    const path = join(dir, 'host.lock');
    const argv = ['node', '/usr/local/bin/dsh', 'web', '--profile', 'ops'];
    await writeFile(
      path,
      JSON.stringify({ pid: process.pid, startedAt: '2026-10-11T00:00:00.000Z', argv, cwd: '/Users/x/Ops-Space/24PA' }),
    );
    const error = await acquireHostLock(dir).then(
      () => undefined,
      (error) => error,
    );
    expect(error).toBeInstanceOf(HostAlreadyActive);
    expect(error.message).toContain('web --profile ops');
    expect(error.message).toContain('/Users/x/Ops-Space/24PA');
    expect(error.message).toContain(path);
  });

  it('旧格式锁文件（无命令行/目录字段）报错不缺字段', async () => {
    const path = join(dir, 'host.lock');
    await writeFile(path, JSON.stringify({ pid: process.pid, startedAt: '2026-10-11T00:00:00.000Z' }));
    const error = await acquireHostLock(dir).then(
      () => undefined,
      (error) => error,
    );
    expect(error).toBeInstanceOf(HostAlreadyActive);
    expect(error.message).toContain(`pid ${process.pid}`);
    expect(error.message).not.toContain('undefined');
    expect(error.message).not.toContain('，命令');
  });

  it('释放后可重新获得', async () => {
    const first = await acquireHostLock(dir);
    await first.release();
    await expect(acquireHostLock(dir)).resolves.toBeTruthy();
  });

  it('崩溃残留（死进程 pid）被接管', async () => {
    const path = join(dir, 'host.lock');
    await writeFile(path, JSON.stringify({ pid: 999999999, startedAt: 'earlier' }));
    const lock = await acquireHostLock(dir);
    const record = JSON.parse(await readFile(path, 'utf8'));
    expect(record.pid).toBe(process.pid);
    await lock.release();
  });
});
