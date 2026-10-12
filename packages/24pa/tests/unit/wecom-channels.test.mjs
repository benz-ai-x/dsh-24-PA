// F30 interface-level tests for the WeCom channel module: the module's own
// seam, no Host involved. Deep coverage stays in the f16 e2e (stub-wecom-cli);
// these pin the contract edges cheapest to assert here.
import { describe, expect, it } from 'vitest';
import { WecomChannels } from '../../lib/wecom-channels.js';

const makeDeps = (over = {}) => ({
  repos: () => { throw new Error('not needed'); },
  config: () => ({ calendarChannel: 'wecom', todoChannel: 'feishu', notifyChannel: 'feishu', timeZone: 'Asia/Shanghai' }),
  cli: () => ({ wecomCliBin: 'definitely-missing-wecom-cli-bin', cliTimeoutMs: 2000 }),
  notifyOwner: async () => {},
  notifySourceChanged: async () => {},
  gate: (_key, work) => work(),
  stagedOperation: async () => { throw new Error('not needed'); },
  stagedOperationWithId: async () => { throw new Error('not needed'); },
  failStaged: async () => {},
  linkedEventIdsInWindow: async () => [],
  isClosed: () => false,
  ...over,
});

describe('F30：WecomChannels 接口直测', () => {
  it('wecomCheck：CLI 缺失时降级为 error 诊断并给出 nextSteps，不抛错', async () => {
    const channels = new WecomChannels(makeDeps());
    const diagnostics = await channels.wecomCheck();
    expect(diagnostics.cli.state).toBe('error');
    expect(diagnostics.cli.message).toContain('definitely-missing-wecom-cli-bin');
    expect(diagnostics.nextSteps.length).toBeGreaterThan(0);
    // 诊断快照可经 wecomDiagnosticsSnapshot 读取（面板/健康面契约）
    expect(channels.wecomDiagnosticsSnapshot()).toBe(diagnostics);
    expect(channels.diagnostics).toBe(diagnostics);
  });

  it('wecomCheck：未绑定工作区（无 config）时显式报错', async () => {
    const channels = new WecomChannels(makeDeps({ config: () => null }));
    await expect(channels.wecomCheck()).rejects.toThrow('尚未绑定工作区。');
  });

  it('authTick：已关停或未绑定时不做任何探测（静默短路）', async () => {
    let probeRan = false;
    const channels = new WecomChannels(makeDeps({ isClosed: () => true }));
    channels.wecomCheck = async () => { probeRan = true; return null; };
    await channels.authTick();
    expect(probeRan).toBe(false);
  });
});
