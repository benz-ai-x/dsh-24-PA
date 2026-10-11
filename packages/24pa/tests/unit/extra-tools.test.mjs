// F18: extraLocalTools 存在性过滤——配置点名的工具在并入 restrict() 白名单前，
// 必须按活挂载信号解析；未挂载项被过滤并保序可观测，绝不让 restrict() 抛错。
import { describe, expect, it } from 'vitest';
import { resolveExtraLocalTools } from '../../lib/tools.js';

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
