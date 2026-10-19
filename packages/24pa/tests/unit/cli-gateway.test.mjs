// F33 interface-level tests for the shared CLI process gateway. The lark and
// wecom suites exercise full envelopes through it end-to-end; these pin the
// skeleton's own contract edges.
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliProcess } from '../../lib/cli-gateway.js';

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
