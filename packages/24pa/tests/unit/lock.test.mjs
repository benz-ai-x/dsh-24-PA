import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir, rename, mkdir } from 'node:fs/promises';
import { fork } from 'node:child_process';
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
    const second = await acquireHostLock(dir); await second.release();
  });

  it('崩溃残留（死进程 pid）被接管', async () => {
    const path = join(dir, 'host.lock');
    await writeFile(path, JSON.stringify({ pid: 999999999, startedAt: 'earlier' }));
    const lock = await acquireHostLock(dir);
    const lockDir = join(dir, 'host.lock.d');
    const record = JSON.parse(await readFile(join(lockDir, (await readdir(lockDir))[0]), 'utf8'));
    expect(record.pid).toBe(process.pid);
    await lock.release();
  });
  it('不完整的旧记录不能被当作死进程抢走', async () => {
    await writeFile(join(dir, 'host.lock'), '');
    await expect(acquireHostLock(dir)).rejects.toThrow('无法核实');
  });
  it('旧持有者迟到的 release 不删除新持有者', async () => {
    const old = await acquireHostLock(dir);
    await rename(join(dir, 'host.lock.d'), join(dir, 'abandoned'));
    const next = await acquireHostLock(dir);
    await old.release();
    await expect(acquireHostLock(dir)).rejects.toBeInstanceOf(HostAlreadyActive);
    await next.release();
  });
  it.each([false, true])('独立进程同时初始化/回收（stale=%s），恰好一个持有者；崩溃后可恢复', async stale => {
    const lockDir = join(dir, 'host.lock.d');
    if (stale) {
      await mkdir(lockDir);
      await writeFile(join(lockDir, 'owner-00000000-0000-0000-0000-000000000000.json'), JSON.stringify({ pid: 999999999, startedAt: 'crashed' }));
    }
    await mkdir(join(dir, '.host-lock-crashed-before-publication'));
    await writeFile(join(dir, '.host-lock-crashed-before-publication', 'owner-unused.json'), '');
    const script = join(dir, 'contender.mjs');
    await writeFile(script, `import { acquireHostLock } from ${JSON.stringify(new URL('../../lib/lock.js', import.meta.url).href)};
process.on('message', async message => {
  if (message !== 'acquire') return;
  try { await acquireHostLock(process.argv[2]); process.send({ acquired: true }); }
  catch (error) { process.send({ acquired: false, name: error.name }); }
});
process.send('ready');`);
    const children = Array.from({ length: 12 }, () => fork(script, [dir], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }));
    const next = child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
    try {
      await Promise.all(children.map(next));
      const results = children.map(next); children.forEach(child => child.send('acquire'));
      const messages = await Promise.all(results);
      expect(messages.filter(r => r.acquired)).toHaveLength(1);
      expect(messages.filter(r => !r.acquired).every(r => r.name === 'HostAlreadyActive')).toBe(true);
    } finally {
      await Promise.all(children.map(child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); })));
    }
    const recovered = await acquireHostLock(dir); await recovered.release();
  });

});
