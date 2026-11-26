// F30 interface-level tests for the WeCom channel module: the module's own
// seam, no Host involved. Deep coverage stays in the f16 e2e (stub-wecom-cli);
// these pin the contract edges cheapest to assert here.
import { describe, expect, it } from 'vitest';
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
  it('有检查在进行、或刚解析失败时，推送目标的解析仍直接说出缺的是哪个插件', async () => {
    const { CliUnavailableError } = await import('../../lib/cli-source.js');
    const message = '需要官方企业微信插件提供的 wecom-cli：当前实例未安装官方企业微信插件（@deepseek-ai/dsh-wecom）';
    const channels = new WecomChannels(makeDeps({ cli: () => { throw new CliUnavailableError(message, 'wecom'); } }));
    // A check that never settles, then the minute after a failed lookup: neither may replace the cause.
    channels.checking = new Promise(() => {});
    await expect(channels.wecomOwnerUserid()).rejects.toThrow(message);
    channels.checking = null;
    channels.wecomIdentityFailedAt = Date.now();
    await expect(channels.wecomOwnerUserid()).rejects.toThrow(message);
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
