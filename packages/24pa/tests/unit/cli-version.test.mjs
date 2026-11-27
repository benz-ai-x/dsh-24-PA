// What the access checks say when the one harmless start of a CLI — asking its
// version — fails (#306, #307). Each failure names the executable, so that the
// message is the next step on its own. Stand-ins stand in for the CLI; nothing
// real is run.
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliVersion } from '../../lib/cli-gateway.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

/** A stand-in executable that runs the given shell lines. */
async function standIn(lines) {
  const dir = await mkdtemp(join(tmpdir(), 'pa24-cli-version-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'lark-cli');
  await writeFile(path, `#!/bin/sh\n${lines}\n`, { mode: 0o755 }); await chmod(path, 0o755);
  return path;
}

describe('cliVersion：问 CLI 的版本', () => {
  it('答了就是版本号，首尾空白去掉', async () => {
    const path = await standIn("echo '  stub-lark-cli 1.0.87-test  '");
    expect(await cliVersion({ path }, { timeoutMs: 5000 })).toEqual({ ok: true, version: 'stub-lark-cli 1.0.87-test' });
  });

  it('启动不了：点名可执行文件和原因', async () => {
    const path = join(tmpdir(), 'no-such-lark-cli');
    const probe = await cliVersion({ path }, { timeoutMs: 5000 });
    expect(probe.ok).toBe(false);
    expect(probe.problem).toContain(`无法启动 ${path}（`);
  });

  it('非零退出：点名可执行文件和退出码', async () => {
    const path = await standIn('exit 3');
    expect(await cliVersion({ path }, { timeoutMs: 5000 })).toEqual({ ok: false, problem: `${path} 的版本检查退出码 3` });
  });

  it('超时：点名可执行文件', async () => {
    const path = await standIn('sleep 5');
    expect(await cliVersion({ path }, { timeoutMs: 300 })).toEqual({ ok: false, problem: `${path} 的版本检查未完成（timeout）` });
  });
});
