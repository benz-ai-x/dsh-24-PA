// F33 interface-level tests for the shared CLI process gateway. The lark and
// wecom suites exercise full envelopes through it end-to-end; these pin the
// skeleton's own contract edges.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliProcess, startChildrenThrough } from '../../lib/cli-gateway.js';

// The cases above run against this plugin's own processes; the #310 cases below
// run the same calls through a stand-in for the host's subprocess service.
afterEach(() => startChildrenThrough(undefined));

const fail = kind => new Error(`fail:${kind}`);

describe('F33：runCliProcess 骨架直测', () => {
  it('argv 含非字符串时经 fail(argv) 拒绝，不启动进程', async () => {
    await expect(runCliProcess({ bin: 'echo', argv: ['ok', 42], timeoutMs: 1000, fail }))
      .rejects.toThrow('fail:argv');
  });

  it('正常退出：stdout/stderr/exitCode 如实带回（信封判定留给域层）', async () => {
    const result = await runCliProcess({ bin: 'sh', argv: ['-c', 'printf out; printf err 1>&2'], timeoutMs: 5000, fail });
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(0);
  });

  it('spawn 失败：经 fail(spawn, cause) 拒绝且带原因', async () => {
    await expect(runCliProcess({ bin: 'definitely-missing-bin-xyz', argv: [], timeoutMs: 2000, fail }))
      .rejects.toThrow('fail:spawn');
  });

  it('stdin 载荷送入子进程', async () => {
    const result = await runCliProcess({ bin: 'cat', argv: [], timeoutMs: 5000, fail, stdinContent: 'payload' });
    expect(result.stdout).toBe('payload');
  });
});


describe('R3 CLI 有界终止', () => {
  it('真实子进程忽略 TERM 后强制退出，调用有限结束且进程消失', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa24-cli-kill-')), pidPath = join(dir, 'pid');
    try {
      const start = Date.now();
      await expect(runCliProcess({ bin: process.execPath, argv: ['-e', `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 100);`, pidPath], timeoutMs: 300, fail })).rejects.toThrow('fail:timeout');
      expect(Date.now() - start).toBeLessThan(2500);
      const pid = Number(await readFile(pidPath, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('主进程响应 TERM 先退出后，忽略 TERM 的独立 stdio 后代仍被 KILL 回收', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa24-cli-tree-')), pidPath = join(dir, 'descendant-pid'); let pid;
    try {
      const descendant = `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 100);`;
      const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, process.argv[1]], { stdio: 'ignore' }); setInterval(() => {}, 100);`;
      await expect(runCliProcess({ bin: process.execPath, argv: ['-e', parent, pidPath], timeoutMs: 400, fail })).rejects.toThrow('fail:timeout');
      pid = Number(await readFile(pidPath, 'utf8'));
      for (let n = 0; n < 20; n++) { try { process.kill(pid, 0); } catch { return; } await new Promise(r => setTimeout(r, 25)); }
      throw new Error('CLI descendant survived the termination deadline');
    } finally { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } await rm(dir, { recursive: true, force: true }); }
  });
  it('无限 stdout 在上限终止，连续 stderr 只保留定额字节', async () => {
    const start = Date.now();
    await expect(runCliProcess({ bin: process.execPath, argv: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write('x'.repeat(65536)), 1);"], timeoutMs: 5000, stdoutLimitBytes: 1024, fail })).rejects.toThrow('fail:limit');
    expect(Date.now() - start).toBeLessThan(2500);
    const result = await runCliProcess({ bin: process.execPath, argv: ['-e', "process.stderr.write('a'.repeat(200000));"], timeoutMs: 3000, fail });
    expect(Buffer.byteLength(result.stderr)).toBe(65536);
  });
  it('多字节文本跨 chunk 不被损坏', async () => {
    const result = await runCliProcess({ bin: process.execPath, argv: ['-e', "const b=Buffer.from('主人'); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.write(b.subarray(1)),20);"], timeoutMs: 3000, fail });
    expect(result.stdout).toBe('主人');
  });
});

/** The host service's contract, on top of node: a spec in, a handle whose `done` settles once, a managed range that terminate() ends. */
function fakeSubprocess({ terminateEnds = true } = {}) {
  const specs = [];
  return {
    specs,
    spawn(spec) {
      specs.push(spec);
      const [program, ...args] = spec.argv;
      const grouped = process.platform !== 'win32';
      const child = spawn(program, args, { cwd: spec.cwd, detached: grouped, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...spec.env },
        stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      const kill = name => { try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Already exited. */ } };
      return {
        get stdin() { return child.stdin ?? undefined; }, stdout: child.stdout, stderr: child.stderr,
        done: new Promise((resolve, reject) => {
          child.on('error', error => reject(error));
          child.on('close', (code, signal) => resolve({ exitCode: code, signal }));
        }),
        terminate() { if (!terminateEnds) return; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 500).unref?.(); },
      };
    },
  };
}

describe('#310：经宿主子进程服务起进程', () => {
  it('请求按服务的规格写：程序在 argv 首位、缺省目录是当前目录、无 stdin 载荷则不开管道、环境覆盖原样转交', async () => {
    const service = fakeSubprocess(); startChildrenThrough(service);
    await runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdout.write("a")'], timeoutMs: 5000, fail, env: { PA24_GATEWAY_PROBE: 'x', PA24_GATEWAY_GONE: undefined } });
    await runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdin.once("data", d => process.stdout.write(d))'], timeoutMs: 5000, fail, stdinContent: 'in', cwd: tmpdir() });
    expect(service.specs).toHaveLength(2);
    expect(service.specs[0]).toMatchObject({ argv: [process.execPath, '-e', 'process.stdout.write("a")'], cwd: process.cwd(), graceMs: 1500, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, env: { PA24_GATEWAY_PROBE: 'x', PA24_GATEWAY_GONE: undefined } });
    expect(service.specs[1]).toMatchObject({ cwd: tmpdir(), stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } });
    expect('env' in service.specs[1]).toBe(false);
  });

  it('调用方看到的与自家起进程时一样：输出、退出码、stdin、启动失败的原因', async () => {
    startChildrenThrough(fakeSubprocess());
    const result = await runCliProcess({ bin: process.execPath, argv: ['-e', "process.stdout.write(Buffer.from([0xe9,0x00,0xff,0x41])); process.stderr.write('err'); process.exitCode = 3"], timeoutMs: 5000, fail });
    expect(result.stdoutBytes.toString('hex')).toBe('e900ff41');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(3);
    expect((await runCliProcess({ bin: process.execPath, argv: ['-e', "process.stdin.once('data', d => process.stdout.write(d))"], timeoutMs: 5000, fail, stdinContent: 'payload' })).stdout).toBe('payload');
    // The cause reaches the caller through its own error factory, as it does for a process of this plugin's own.
    const withCause = (kind, cause) => new Error(`fail:${kind}`, { cause });
    const caught = await runCliProcess({ bin: '/definitely-missing-bin-for-the-gateway', argv: [], timeoutMs: 2000, fail: withCause }).catch(error => error);
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe('fail:spawn');
    expect(String(caught.cause?.message ?? '')).toContain('ENOENT');
  });

  it('超时与输出上限仍由网关判定：服务只负责结束进程，原因经 fail(timeout)／fail(limit) 带回', async () => {
    const service = fakeSubprocess(); startChildrenThrough(service);
    const dir = await mkdtemp(join(tmpdir(), 'pa24-gateway-host-')), pidPath = join(dir, 'pid');
    try {
      const started = Date.now();
      await expect(runCliProcess({ bin: process.execPath, argv: ['-e', `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 100);`, pidPath], timeoutMs: 300, fail }))
        .rejects.toThrow('fail:timeout');
      expect(Date.now() - started).toBeLessThan(2500);
      const pid = Number(await readFile(pidPath, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
      await expect(runCliProcess({ bin: process.execPath, argv: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write('x'.repeat(65536)), 1);"], timeoutMs: 5000, stdoutLimitBytes: 1024, fail }))
        .rejects.toThrow('fail:limit');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('服务迟迟不报告进程结束时，等待也有界地以原因结束', async () => {
    const service = fakeSubprocess({ terminateEnds: false }); startChildrenThrough(service);
    const dir = await mkdtemp(join(tmpdir(), 'pa24-gateway-stuck-')), pidPath = join(dir, 'pid');
    try {
      const started = Date.now();
      await expect(runCliProcess({ bin: process.execPath, argv: ['-e', `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 100);`, pidPath], timeoutMs: 200, fail }))
        .rejects.toThrow('fail:timeout');
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      // The stand-in left the process running on purpose.
      try { process.kill(Number(await readFile(pidPath, 'utf8').catch(() => '0')), 'SIGKILL'); } catch { /* Not started. */ }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('不再经服务时回到自家起进程', async () => {
    const service = fakeSubprocess(); startChildrenThrough(service);
    await runCliProcess({ bin: process.execPath, argv: ['-e', ''], timeoutMs: 5000, fail });
    startChildrenThrough(undefined);
    const result = await runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdout.write("own")'], timeoutMs: 5000, fail });
    expect(result.stdout).toBe('own');
    expect(service.specs).toHaveLength(1);
  });
});

