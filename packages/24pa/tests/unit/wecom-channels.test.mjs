// F30 interface-level tests for the WeCom channel module: the module's own
// seam, no Host involved. Deep coverage stays in the f16 e2e (stub-wecom-cli);
// these pin the contract edges cheapest to assert here.
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WecomChannels } from '../../lib/wecom-channels.js';
import { makeBaseDeps } from '../helpers/channel-deps.mjs';

const makeDeps = (over = {}) => ({
  ...makeBaseDeps({
    config: () => ({ calendarChannel: 'wecom', todoChannel: 'feishu', notifyChannel: 'feishu', timeZone: 'Asia/Shanghai' }),
    cli: () => ({ bin: 'definitely-missing-wecom-cli-bin', timeoutMs: 2000 }),
  }),
  notifySourceChanged: async () => {},
  gate: (_key, work) => work(),
  stagedOperationWithId: async () => { throw new Error('not needed'); },
  linkedEventIdsInWindow: async () => [],
  isClosed: () => false,
  ...over,
});

describe('#306：没有 wecom-cli 时的说法', () => {
  it('检查进行中、以及刚失败之后的退避期里，推送目标的解析都直接说出缺的是哪个插件', async () => {
    const { CliUnavailableError } = await import('../../lib/cli-source.js');
    const { chmod, mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const message = '需要官方企业微信插件提供的 wecom-cli：当前实例未安装官方企业微信插件（@deepseek-ai/dsh-wecom）';
    // A wecom-cli that answers nothing until released, so that the check started with it stays in progress.
    const dir = await mkdtemp(join(tmpdir(), 'pa24-wecom-hanging-')), release = join(dir, 'release'), hanging = join(dir, 'wecom-cli');
    await writeFile(hanging, '#!/usr/bin/env node\nimport { existsSync } from "node:fs";\n'
      + `while (!existsSync(${JSON.stringify(release)})) await new Promise(resolve => setTimeout(resolve, 50));\nprocess.exit(1);\n`, { mode: 0o755 });
    await chmod(hanging, 0o755);
    try {
      let cli = { bin: hanging, timeoutMs: 10_000 };
      const channels = new WecomChannels(makeDeps({ cli: () => { if (typeof cli === 'string') throw new CliUnavailableError(cli, 'wecom'); return cli; } }));
      const checking = channels.wecomCheck();
      await new Promise(resolve => setTimeout(resolve, 300));
      // Meanwhile the CLI is gone, as when the plugin row changes or the connector is removed.
      cli = message;
      await expect(channels.wecomOwnerUserid()).rejects.toThrow(message);
      await writeFile(release, ''); await checking;
      // That check failed, which starts its minute of not looking the target up again.
      await expect(channels.wecomOwnerUserid()).rejects.toThrow(message);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('F30：WecomChannels 接口直测', () => {
  it('wecomCheck：CLI 缺失时降级为 error 诊断并给出 nextSteps，不抛错', async () => {
    const channels = new WecomChannels(makeDeps());
    const diagnostics = await channels.wecomCheck();
    expect(diagnostics.cli.state).toBe('error');
    expect(diagnostics.cli.message).toContain('definitely-missing-wecom-cli-bin');
    // Said once: the executable's own failure to start, not that failure said again after the executable.
    expect(diagnostics.cli.message).toBe(`无法启动 definitely-missing-wecom-cli-bin（spawn definitely-missing-wecom-cli-bin ENOENT）`);
    expect(diagnostics.nextSteps.length).toBeGreaterThan(0);
    // 诊断快照可经 wecomDiagnosticsSnapshot 读取（面板/健康面契约）
    expect(channels.wecomDiagnosticsSnapshot()).toBe(diagnostics);
    expect(channels.diagnostics).toBe(diagnostics);
  });

  it('wecomCheck：未绑定工作区（无 config）时显式报错', async () => {
    const channels = new WecomChannels(makeDeps({ config: () => null }));
    await expect(channels.wecomCheck()).rejects.toThrow('尚未绑定工作区。');
  });

  it('invalidate：旧检查快照失效，不触发新的平台探测', async () => {
    const channels = new WecomChannels(makeDeps());
    await channels.wecomCheck();
    expect(channels.diagnostics).not.toBeNull();
    channels.invalidate();
    expect(channels.diagnostics).toBeNull();
  });
});
