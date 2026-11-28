// F33 interface-level tests for the shared CLI process gateway. The lark and
// wecom suites exercise full envelopes through it end-to-end; these pin the
// skeleton's own contract edges.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliProcess, startChildrenThrough } from '../../lib/cli-gateway.js';
import { withExecutionSignal } from '../../lib/execution-cancellation.js';
import { installedSubprocess, subprocessDouble } from '../helpers/subprocess.mjs';

// Every case runs through a stand-in for the host's subprocess service, the
// one vitest installs for each test file (#310); the last group says what the
// gateway asks of that service.
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


// Ending a process is the service's; what these pin is that a call ends within
// the bound with its reason, and leaves no process behind, through the
// service's contract.
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
  it('主进程响应 TERM 先退出后，忽略 TERM 的独立 stdio 后代仍被 KILL 回收：调用等范围清空才返回', async () => {
    // The leader answers TERM at once and leaves a descendant that ignores it and beats a file. The call may only come back once that
    // descendant has stopped: this is what pins the gateway's wait for the range to be empty. A process that has just been killed can
    // still be seen for a moment, so what is checked is that it no longer runs, not that its pid is gone.
    const dir = await mkdtemp(join(tmpdir(), 'pa24-cli-tree-')), paths = join(dir, 'descendant'); let pid;
    try {
      const descendant = `require('node:fs').writeFileSync(process.argv[1] + '.pid', String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => require('node:fs').writeFileSync(process.argv[1] + '.beat', String(Date.now())), 20);`;
      const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, process.argv[1]], { stdio: 'ignore' }); setInterval(() => {}, 100);`;
      await expect(runCliProcess({ bin: process.execPath, argv: ['-e', parent, paths], timeoutMs: 400, fail })).rejects.toThrow('fail:timeout');
      const returnedAt = Date.now();
      pid = Number(await readFile(`${paths}.pid`, 'utf8'));
      // Had the call come back with the descendant still running, it would have gone on beating after the return.
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(Number(await readFile(`${paths}.beat`, 'utf8'))).toBeLessThan(returnedAt + 40);
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

afterEach(() => startChildrenThrough(installedSubprocess));

describe('#310：经宿主子进程服务起进程', () => {
  it('请求按服务的规格写：程序在 argv 首位、缺省目录是当前目录、无 stdin 载荷则不开管道、环境覆盖原样转交', async () => {
    const service = subprocessDouble(); startChildrenThrough(service);
    await runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdout.write("a")'], timeoutMs: 5000, fail, env: { PA24_GATEWAY_PROBE: 'x', PA24_GATEWAY_GONE: undefined } });
    await runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdin.once("data", d => process.stdout.write(d))'], timeoutMs: 5000, fail, stdinContent: 'in', cwd: tmpdir() });
    expect(service.specs).toHaveLength(2);
    expect(service.specs[0]).toMatchObject({ argv: [process.execPath, '-e', 'process.stdout.write("a")'], cwd: process.cwd(), graceMs: 1500, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, env: { PA24_GATEWAY_PROBE: 'x', PA24_GATEWAY_GONE: undefined } });
    expect(service.specs[1]).toMatchObject({ cwd: tmpdir(), stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } });
    expect('env' in service.specs[1]).toBe(false);
  });

  it('调用方看到的与自家起进程时一样：输出、退出码、stdin、启动失败的原因', async () => {
    startChildrenThrough(subprocessDouble());
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

  it('网关把宽限交给服务；服务报告的结算（被信号结束）不被当成成功，调用以原因结束', async () => {
    const service = subprocessDouble(); startChildrenThrough(service);
    const dir = await mkdtemp(join(tmpdir(), 'pa24-gateway-host-')), pidPath = join(dir, 'pid');
    try {
      const caught = await runCliProcess({ bin: process.execPath, argv: ['-e', `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 100);`, pidPath], timeoutMs: 300, fail }).catch(error => error);
      expect(String(caught)).toBe('Error: fail:timeout');
      expect(service.specs).toHaveLength(1);
      expect(service.specs[0].graceMs).toBe(1500);
      const pid = Number(await readFile(pidPath, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('执行中止：进程被结束，调用以 fail(timeout, 中止原因) 带回原因；执行已中止时不再启动任何进程', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa24-cli-abort-')), pidPath = join(dir, 'pid');
    const withCause = (kind, cause) => new Error(`fail:${kind}`, { cause });
    const unresponsive = ['-e', `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 100);`, pidPath];
    try {
      const over = new AbortController(); over.abort(new Error('执行已中止'));
      await expect(withExecutionSignal(over.signal, () => runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdout.write("ran")'], timeoutMs: 5000, fail: withCause })))
        .rejects.toThrow('执行已中止');
      const live = new AbortController(), started = Date.now();
      const call = withExecutionSignal(live.signal, () => runCliProcess({ bin: process.execPath, argv: unresponsive, timeoutMs: 20_000, fail: withCause }));
      // The process is up and will not answer; the execution is aborted.
      for (let n = 0; n < 250 && !(await readFile(pidPath, 'utf8').catch(() => '')); n++) await new Promise(resolve => setTimeout(resolve, 20));
      live.abort(new Error('执行已中止'));
      const caught = await call.catch(error => error);
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toBe('fail:timeout');
      expect(caught.cause?.message).toBe('执行已中止');
      expect(Date.now() - started).toBeLessThan(5000);
      const pid = Number(await readFile(pidPath, 'utf8')); expect(() => process.kill(pid, 0)).toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('服务迟迟不报告进程结束时，等待也有界地以原因结束', async () => {
    const service = subprocessDouble({ endsTerminated: false }); startChildrenThrough(service);
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

  it('没有安装服务时调用以启动失败结束，不起任何进程', async () => {
    startChildrenThrough(undefined);
    await expect(runCliProcess({ bin: process.execPath, argv: ['-e', 'process.stdout.write("ran")'], timeoutMs: 2000, fail }))
      .rejects.toThrow('fail:spawn');
  });
});
