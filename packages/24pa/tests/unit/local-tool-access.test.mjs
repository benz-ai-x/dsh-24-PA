import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../../lib/tools.js';

afterEach(() => vi.useRealTimers());

function plugin({ role = 'local-robot', extras = ['mcp__qwennote__*'] } = {}) {
  let mounted = [], created;
  const disposals = [], allowed = [], records = [];
  const runtime = { roleFor: () => role, configFor: () => ({ extraLocalTools: extras }), providerAvailable: () => false, noteExtraToolResolution: r => records.push(r), workspaceRulesSection: () => '' };
  const ctx = {
    get: () => runtime,
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') disposals.push(cleanup); },
    on: (name, fn) => { if (name === 'agent/created') created = fn; },
    tools: { schemas: () => mounted.map(name => ({ name })), register: () => () => {} },
    systemPrompt: { section: () => () => {} },
  };
  apply(ctx);
  return {
    mount: names => { mounted = names; }, allowed, records,
    create: () => created({ agent: { ctx: { plugin: spec => ({ await: async () => { spec.apply({ tools: { restrict: ({ allow }) => allowed.push(allow) } }); } }) } } }),
    dispose: () => disposals.forEach(fn => fn()),
  };
}

describe('本地工具扩展：真实插件 agent/created 生命周期', () => {
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
});
