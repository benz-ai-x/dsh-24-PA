// F18: extraLocalTools 存在性过滤——配置点名的工具在并入 restrict() 白名单前，
// 必须按活挂载信号解析；未挂载项被过滤并保序可观测，绝不让 restrict() 抛错。
import { describe, expect, it } from 'vitest';
import { resolveExtraLocalTools, qwennoteChannelState } from '../../lib/tools.js';

const signals = ({ globalToolNames = [], providers = [] } = {}) => ({
  globalToolNames: new Set(globalToolNames),
  providerAvailable: (name) => providers.includes(name),
});

describe('extraLocalTools 解析（F18）', () => {
  it('空配置零输出', () => {
    expect(resolveExtraLocalTools([], signals())).toEqual({ allow: [], filtered: [] });
  });

  it('委派工具按 provider 可用性放行或过滤', () => {
    expect(resolveExtraLocalTools(['subagent_codex'], signals({ providers: ['codex'] }))).toEqual({
      allow: ['subagent_codex'],
      filtered: [],
    });
    expect(resolveExtraLocalTools(['subagent_codex', 'subagent_claude_code'], signals({ providers: ['codex'] }))).toEqual({
      allow: ['subagent_codex'],
      filtered: ['subagent_claude_code'],
    });
  });

  it('通配条目展开为宿主面上全部 qwennote 工具（排序去重）', () => {
    const out = resolveExtraLocalTools(
      ['mcp__qwennote__*'],
      signals({ globalToolNames: ['mcp__qwennote__list_minutes', 'read', 'mcp__qwennote__get_transcript', 'mcp__other__x'] }),
    );
    expect(out).toEqual({
      allow: ['mcp__qwennote__get_transcript', 'mcp__qwennote__list_minutes'],
      filtered: [],
    });
  });

  it('通配条目无任何活工具时整体被过滤（profile 未配 mcp-client）', () => {
    expect(resolveExtraLocalTools(['mcp__qwennote__*'], signals({ globalToolNames: ['read', 'mcp__other__x'] }))).toEqual({
      allow: [],
      filtered: ['mcp__qwennote__*'],
    });
  });

  it('精确工具名按宿主面存在性过滤', () => {
    expect(
      resolveExtraLocalTools(['mcp__qwennote__list_minutes'], signals({ globalToolNames: ['mcp__qwennote__list_minutes'] })),
    ).toEqual({ allow: ['mcp__qwennote__list_minutes'], filtered: [] });
    expect(resolveExtraLocalTools(['mcp__qwennote__list_minutes'], signals())).toEqual({
      allow: [],
      filtered: ['mcp__qwennote__list_minutes'],
    });
  });

  it('通配与精确名混用时去重且互不重复计入', () => {
    const out = resolveExtraLocalTools(
      ['mcp__qwennote__list_minutes', 'mcp__qwennote__*'],
      signals({ globalToolNames: ['mcp__qwennote__list_minutes', 'mcp__qwennote__get_transcript'] }),
    );
    expect(out.allow).toEqual(['mcp__qwennote__list_minutes', 'mcp__qwennote__get_transcript']);
    expect(out.filtered).toEqual([]);
  });

  it('组合场景：委派缺失 provider＋通配与精确名命中同一工具去重', () => {
    const out = resolveExtraLocalTools(
      ['subagent_claude_code', 'mcp__qwennote__*', 'mcp__qwennote__list_minutes'],
      signals({ globalToolNames: ['mcp__qwennote__list_minutes'], providers: ['codex'] }),
    );
    expect(out).toEqual({
      allow: ['mcp__qwennote__list_minutes'],
      filtered: ['subagent_claude_code'],
    });
  });
});

describe('F18 WP3：听记通道三态诊断（qwennoteChannelState）', () => {
  it('配置＋挂载＝正常', () => {
    const out = qwennoteChannelState({ configured: true, mounted: true, tokenCache: { exists: true, updatedAt: new Date() } });
    expect(out.state).toBe('ok');
    expect(out.nextSteps).toEqual([]);
  });

  it('配置＋未挂载＋无缓存＝未授权（首次授权未完成）', () => {
    const out = qwennoteChannelState({ configured: true, mounted: false, tokenCache: { exists: false, updatedAt: null } });
    expect(out.state).toBe('error');
    expect(out.message).toContain('未授权');
    expect(out.nextSteps[0]).toContain('首次授权');
  });

  it('配置＋未挂载＋有缓存＝连接失败或 token 过期（携带缓存时间）', () => {
    const at = new Date('2026-10-10T08:00:00Z');
    const out = qwennoteChannelState({ configured: true, mounted: false, tokenCache: { exists: true, updatedAt: at } });
    expect(out.state).toBe('warn');
    expect(out.message).toContain('2026-10-10T08:00:00.000Z');
    expect(out.nextSteps[0]).toContain('重启宿主');
  });

  it('未配置＝不诊断态（warn＋指引配置）', () => {
    const out = qwennoteChannelState({ configured: false, mounted: false, tokenCache: { exists: false, updatedAt: null } });
    expect(out.state).toBe('warn');
    expect(out.message).toContain('未配置');
  });
});
