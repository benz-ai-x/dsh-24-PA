// F33 interface-level tests for the shared CLI process gateway. The lark and
// wecom suites exercise full envelopes through it end-to-end; these pin the
// skeleton's own contract edges.
import { describe, expect, it } from 'vitest';
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
