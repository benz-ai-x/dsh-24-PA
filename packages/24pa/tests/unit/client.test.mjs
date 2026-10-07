import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 锚点守卫：浏览器半无 DOM 测试环境，这里只做「注册面与结构必须存在」的
// copy guard（与 prompts.test.mjs 的锚点思路一致）；交互验收走 T20 真机。
const client = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../client.js'), 'utf8');

describe('client.js 挂载面（F17/F20）', () => {
  it('语法可解析', () => {
    expect(() => new Function(client)).not.toThrow();
  });

  it('三个插槽注册齐全：主面板、侧栏图标、设置分区', () => {
    expect(client).toContain("ctx.slots.inject('main'");
    expect(client).toContain("ctx.slots.register({ name: 'main', key: 'pa24' }");
    expect(client).toContain("ctx.slots.inject('sidebar.panellist'");
    expect(client).toContain("ctx.slots.inject('settings.section'");
    expect(client).toMatch(/slots\.register\(\{ name: 'settings\.section', id: 'pa24', order: 25, label: \(\) => t\('settings'\) \}/);
  });

  it('工作区配置收进设置（F20）：主界面无 workspace tab/strip，设置分区承载 WorkspaceCards＋HealthBlock', () => {
    expect(client).toContain('function WorkspaceCards({ snapshot, busy, button, openRobot, path, onPathChange })');
    expect(client).not.toContain("tab === 'workspace'");
    expect(client).not.toContain('pa24-workspace-strip\', ');
    // WorkspaceCards 只在设置分区挂载（后续复用也合法，但不允许主面板私挂）
    expect(client.match(/h\(WorkspaceCards,/g)?.length).toBeGreaterThanOrEqual(1);
    expect(client).toContain('h(HealthBlock)));');
    // 动作外壳与机器人入口共享
    expect(client).toContain('function usePanelActions({ reloadAfter } = {})');
    expect(client.match(/const openRobot = async/g)?.length).toBe(1);
    // 面板 RPC 面不变（F19 的新动作走既有 action 端点）
    const endpoints = [...client.matchAll(/rpc\('([a-z.]+)'/g)].map(m => m[1]);
    expect(new Set(endpoints)).toEqual(new Set(['snapshot', 'action', 'memory', 'notes.queue', 'health']));
  });

  it('企微接入模块（F20）：tab、检查动作、诊断四态与 helpMessage 原文', () => {
    expect(client).toContain("['wecom', 'bot', 'blue']");
    expect(client).toContain('function WecomView({ state, busy, button, openRobot })');
    expect(client).toContain("type: 'connection.wecom-check'");
    for (const anchor of ['检查通过', '未授权', '已过期', '企业不可用', 's.helpMessage', '下一步（nextSteps）']) {
      expect(client).toContain(anchor);
    }
  });

  it('设置分区跳转面板走 layout 服务并保留关闭兜底', () => {
    expect(client).toContain("'layout'");
    expect(client).toContain("ctx.layout.selectPanel('pa24')");
    expect(client).toContain('console.warn');
    expect(client).toContain('close()');
  });
});
