// arch-2: the panel action seam — dispatch goes through the registry, so
// tests hit the same interface the browser does (replace the old tautology
// guard that only checked the table contains its own strings).
import { describe, expect, it } from 'vitest';
import { PANEL_RPC, action, registerPanel } from '../../lib/panel.js';

const fakeRuntime = overrides => ({
  reloadWorkspace: async () => ({}),
  updateWorkspaceConfig: async () => ({}),
  digestRunNow: async planId => ({ planId }),
  ttsProbe: async () => ({ ok: true }),
  ...overrides,
});

describe('面板动作注册表（arch-2 seam 直测）', () => {
  it('未知动作拒绝（不再落同义反复断言）', async () => {
    await expect(action(fakeRuntime(), { type: 'nope.nope' })).rejects.toThrow(/只提供/);
    await expect(action(fakeRuntime(), { type: '' })).rejects.toThrow(/只提供/);
  });

  it('注册表覆盖 PANEL_RPC.actions 全部词汇（词汇表与 dispatch 面等价）', async () => {
    // actions 里的每个名字都可被 dispatch（未知名才被拒）——用受控 runtime
    // 逐名打点，拒绝信息必须是业务校验而非「只提供」。
    for (const name of Object.values(PANEL_RPC.actions)) {
      const rt = fakeRuntime();
      let caught;
      try {
        await action(rt, { type: name });
      } catch (error) {
        caught = error;
      }
      // 要么成功，要么是 handler 自身的业务校验错——不能是注册表缺失
      expect(caught ? caught.message : '').not.toMatch(/只提供/);
    }
  });

  it('handler 自带 payload 校验：缺配置补丁在 seam 拒绝', async () => {
    await expect(action(fakeRuntime(), { type: PANEL_RPC.actions.workspaceConfigUpdate })).rejects.toThrow(/缺少配置补丁/);
    await expect(action(fakeRuntime(), { type: PANEL_RPC.actions.workspaceSecretUpdate, values: [] })).rejects.toThrow(/缺少密钥补丁/);
    await expect(action(fakeRuntime(), { type: PANEL_RPC.actions.roleRegister })).rejects.toThrow(/缺少角色定义/);
  });

  it('payload 经 handler 传达到 runtime（空 planId 如实转发）', async () => {
    const calls = [];
    const rt = fakeRuntime({ digestRunNow: async planId => { calls.push(planId); return {}; } });
    await action(rt, { type: PANEL_RPC.actions.digestRunNow });
    expect(calls).toEqual(['']);
  });

  it('sources RPC 传递 workspaceBinding 并返回同一绑定', async () => {
    let route, received;
    const runtime = {
      inspectWorkspace: async work => work(),
      sourcesSnapshot: async payload => { received = payload; return { workspaceBinding: payload.workspaceBinding, entries: [] }; },
    };
    registerPanel({ effect: setup => setup(), connection: { fetch: { register: value => { route = value; } } } }, runtime);
    const response = await route.fetch(new Request('http://localhost/api/24pa', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: PANEL_RPC.endpoints.sources, payload: { workspaceBinding: 'binding-a' } }) }));
    expect(received).toEqual({ workspaceBinding: 'binding-a' });
    expect(await response.json()).toEqual({ ok: true, value: { workspaceBinding: 'binding-a', entries: [] } });
  });

  it('重载失败经 RPC 传输结构化 saved_not_applied 证据', async () => {
    let route;
    const evidence = { state: 'saved_not_applied', savedHash: 'disk-hash', activeHash: 'runtime-hash' };
    const runtime = {
      inspectWorkspace: async work => work(),
      updateWorkspaceConfig: async () => { throw Object.assign(new Error('reload failed'), { code: 'workspace_config_not_applied', evidence }); },
    };
    registerPanel({ effect: setup => setup(), connection: { fetch: { register: value => { route = value; } } } }, runtime);
    const response = await route.fetch(new Request('http://localhost/api/24pa', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'action',
        payload: { type: PANEL_RPC.actions.workspaceConfigUpdate, workspaceBinding: 'binding-a', config: { sources: {} } },
      }) }));
    expect(await response.json()).toEqual({ ok: false, error: { message: 'reload failed', code: 'workspace_config_not_applied', evidence } });
  });
});
