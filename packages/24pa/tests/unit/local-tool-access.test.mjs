import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../../lib/tools.js';

afterEach(() => vi.useRealTimers());

function plugin({ role = 'local-robot', businessRole = role, extras = ['mcp__qwennote__*'], codingTools = null, states = {} } = {}) {
  let mounted = [], created;
  const disposals = [], allowed = [], records = [], guards = [];
  const runtime = { skillRuns: { codingTools: async () => codingTools }, businessToolPolicy: () => null, roleFor: () => businessRole, roleForToolMount: () => role, configFor: () => ({ extraLocalTools: extras }), providerAvailable: () => false, noteExtraToolResolution: r => records.push(r), workspaceRulesSection: () => '' };
  const ctx = {
    get: () => runtime,
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') disposals.push(cleanup); },
    on: (name, fn) => { if (name === 'agent/created') created = fn; },
    tools: { schemas: () => mounted.map(name => ({ name })), register: () => () => {} },
    // The host's MCP manager, as far as these tests read it: each server's state.
    mcpManager: { list: () => Object.entries(states).map(([name, state]) => ({ name, status: { state } })) },
    systemPrompt: { section: () => () => {} },
  };
  apply(ctx);
  return {
    mount: names => { mounted = names; }, states, allowed, records, guards,
    create: () => created({ agent: { id: 'agent', ctx: { plugin: spec => ({ await: async () => { spec.apply({ tools: { restrict: ({ allow }) => allowed.push(allow), guard: check => guards.push(check) } }); } }) } } }),
    dispose: () => disposals.forEach(fn => fn()),
  };
}

describe('本地工具扩展：真实插件 agent/created 生命周期', () => {
  it('候选会话只使用工具构建角色，业务角色未激活时仍可完成挂载', async () => {
    const host = plugin({ businessRole: null });
    host.mount(['mcp__qwennote__list_minutes']); await host.create();
    expect(host.allowed[0]).toContain('pa24_memory'); expect(host.allowed[0]).toContain('mcp__qwennote__list_minutes');
    host.dispose();
  });
  it('挂载迟到时等待，再把工具和本地基本工具一起应用一次', async () => {
    vi.useFakeTimers();
    const host = plugin();
    const pending = host.create();
    expect(host.allowed).toEqual([]);
    await vi.advanceTimersByTimeAsync(4000);
    host.mount(['mcp__qwennote__list_minutes']);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(host.allowed).toHaveLength(1);
    expect(host.allowed[0]).toContain('mcp__qwennote__list_minutes');
    expect(host.allowed[0]).toContain('pa24_workspace');
    expect(host.records[0].filtered).toEqual([]);
    host.dispose();
  });
  it('腾讯文档还在连接时等它挂载，加载器随本地基本工具一起应用一次（#308）', async () => {
    // The server starts with the host and can connect after the first local session is created.
    vi.useFakeTimers();
    const host = plugin({ extras: ['mcp__tencent-docs__*'], states: { 'tencent-docs': 'connecting' } });
    const pending = host.create();
    expect(host.allowed).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    host.states['tencent-docs'] = 'connected'; host.mount(['mcp__tencent-docs__load_tools']);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(host.allowed).toHaveLength(1);
    expect(host.allowed[0]).toContain('mcp__tencent-docs__load_tools');
    expect(host.allowed[0]).toContain('pa24_workspace');
    expect(host.records[0].filtered).toEqual([]);
    host.dispose();
  });

  it.each([['不在管理器里', undefined], ['等主人授权', 'waiting-authorization'], ['等凭据', 'waiting-credentials'], ['已关闭', 'closed']])(
    '腾讯文档%s时建立会话不等它：立刻建立，条目记为被过滤（#308）', async (_label, state) => {
      vi.useFakeTimers();
      const host = plugin({ extras: ['mcp__tencent-docs__*'], ...(state ? { states: { 'tencent-docs': state } } : {}) });
      await host.create();
      expect(host.allowed[0]).toContain('pa24_workspace');
      expect(host.allowed[0].some(n => n.startsWith('mcp__tencent-docs__'))).toBe(false);
      expect(host.records[0].filtered).toEqual(['mcp__tencent-docs__*']);
      expect(vi.getTimerCount()).toBe(0);
      host.dispose();
    });
  it('超过有界等待仅开放本地基本工具并记录过滤原因', async () => {
    vi.useFakeTimers();
    const host = plugin();
    const pending = host.create();
    await vi.advanceTimersByTimeAsync(60000); await pending;
    expect(host.allowed[0]).toContain('pa24_workspace');
    expect(host.allowed[0].some(n => n.startsWith('mcp__qwennote__'))).toBe(false);
    expect(host.records[0].filtered).toEqual(['mcp__qwennote__*']);
    host.dispose();
  });
  it('dispose 立即结束等待，随后挂载也不再应用权限', async () => {
    vi.useFakeTimers();
    const host = plugin();
    const pending = host.create();
    host.dispose(); await pending;
    host.mount(['mcp__qwennote__list_minutes']);
    await vi.advanceTimersByTimeAsync(60000);
    expect(host.allowed).toEqual([]); expect(host.records).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['feishu-access', 'worker', null])('%s 不等待、不继承配置中的本地扩展', async role => {
    vi.useFakeTimers();
    const host = plugin({ role });
    host.mount(['mcp__qwennote__list_minutes']);
    await host.create();
    expect(host.allowed).toHaveLength(1);
    expect(host.allowed[0]).not.toContain('pa24_workspace');
    expect(host.allowed[0].some(n => n.startsWith('mcp__qwennote__'))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    host.dispose();
  });
  it('腾讯文档按需工具：本地会话放行加载器，门禁只认经已放行加载器载入的工具（#308）', async () => {
    const host = plugin({ extras: ['mcp__tencent-docs__*'] });
    host.mount(['mcp__tencent-docs__load_tools']); await host.create();
    expect(host.allowed[0]).toContain('mcp__tencent-docs__load_tools');
    const [guard] = host.guards;
    const denied = name => guard({ name, agent: { id: 'agent' } });
    expect(denied('mcp__tencent-docs__echo')).toBeUndefined();
    expect(denied('mcp__tencent-docs__load_tools')).toBeUndefined();
    expect(denied('read')).toBeUndefined();
    expect(denied('mcp__qwennote__list_minutes')).toBe('该 MCP 工具不在当前会话的放行范围内。');
    // Another agent's execution is not this session's to judge.
    expect(guard({ name: 'mcp__qwennote__list_minutes', agent: { id: 'other' } })).toBeUndefined();
    host.dispose();
  });
  it.each(['feishu-access', 'worker'])('%s 名下没有已放行的加载器，按需 MCP 工具执行时被门禁拒绝（#308）', async role => {
    const host = plugin({ role, extras: ['mcp__tencent-docs__*'] });
    host.mount(['mcp__tencent-docs__load_tools']); await host.create();
    expect(host.allowed[0].some(name => name.startsWith('mcp__'))).toBe(false);
    expect(host.guards[0]({ name: 'mcp__tencent-docs__echo', agent: { id: 'agent' } })).toBe('该 MCP 工具不在当前会话的放行范围内。');
    host.dispose();
  });
  it('Skill 运行只授权点名工具，按需载入的 MCP 工具同样被门禁拒绝（#308）', async () => {
    const host = plugin({ codingTools: ['read', 'skill'] });
    host.mount(['mcp__tencent-docs__load_tools']); await host.create();
    expect(host.allowed[0]).toEqual(['read', 'skill']);
    expect(host.guards[0]({ name: 'mcp__tencent-docs__echo', agent: { id: 'agent' } })).toBe('该 MCP 工具不在本次 Skill 授权范围内。');
    expect(host.guards[0]({ name: 'read', agent: { id: 'agent' } })).toBeUndefined();
    host.dispose();
  });
});
