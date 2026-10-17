import { describe, expect, it } from 'vitest';
import { PANEL_RPC } from '../../lib/panel.js';

// F19 前置（RPC 常量化）：endpoint/action 表是面板 RPC 面的单一来源，
// 新动作必须进表而不是散装字符串；死端点（memo）不回潮。
describe('面板 RPC 常量表', () => {
  it('endpoint 表稳定（memo 死端点已删）', () => {
    expect(Object.values(PANEL_RPC.endpoints)).toEqual(['snapshot', 'action', 'memory', 'health', 'notes.queue', 'roles']);
    expect(Object.values(PANEL_RPC.endpoints)).not.toContain('memo');
  });

  it('action 表覆盖既有动作且无重复', () => {
    const actions = Object.values(PANEL_RPC.actions);
    expect(new Set(actions).size).toBe(actions.length);
    for (const known of ['workspace.bind', 'workspace.reload', 'connection.check', 'connection.wecom-check', 'digest.supervise', 'tts.probe', 'tts.test', 'test.inject']) {
      expect(actions).toContain(known);
    }
  });
});
