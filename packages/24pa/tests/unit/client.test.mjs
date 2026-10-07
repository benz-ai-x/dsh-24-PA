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
    expect(client).toContain("['wecom', 'bot', 'green']");
    expect(client).toContain('function WecomView({ state, busy, button, openRobot })');
    expect(client).toContain("type: 'connection.wecom-check'");
    for (const anchor of ['正常', '未授权', '已过期', '企业不可用', 's.helpMessage', '下一步（nextSteps）']) {
      expect(client).toContain(anchor);
    }
  });

  it('UI 制度锚点（P53）：语义配色、单主按钮、统一状态词汇、可关闭提示与防溢出', () => {
    // tab 配色按设计文档语义：蓝日程 / 蓝绿接入 / 紫记忆 / 玫红手写审核
    expect(client).toContain("['feishu', 'plug', 'green']");
    expect(client).toContain("['memory', 'memory', 'violet']");
    expect(client).toContain("['review', 'pen', 'danger']");
    expect(client).toContain('.pa24-tone-green{');
    expect(client).toContain('.pa24-tone-violet{');
    // header 压缩：eyebrow 退役、口号并入标题行
    expect(client).not.toContain('pa24-eyebrow');
    expect(client).toContain('pa24-title-row');
    // 右列短卡收缩与设置模态防横向裁切
    expect(client).toContain('align-items:start');
    expect(client).toContain('.pa24-settings{padding:22px;height:auto;min-width:0;width:100%}');
    // 一屏一主按钮：仅页头对话、工作/记忆/企微空态 CTA、设置分区绑定五处为实心
    expect((client.match(/className: 'pa24-primary'/g) || []).length).toBe(5);
    expect(client).toContain("{ disabled: busy || !path, className: 'pa24-primary' }");
    // 统一状态词汇与名称/状态徽章分离、长 ID 截断、提示可关闭
    expect(client).toContain("'正常'");
    expect(client).not.toContain("'长连接已启动'");
    expect(client).toContain('pa24-ellip');
    expect(client).toContain('关闭体验模式提示');
    expect(client).toContain('待发消息');
  });

  it('设置分区跳转面板走 layout 服务并保留关闭兜底', () => {
    expect(client).toContain("'layout'");
    expect(client).toContain("ctx.layout.selectPanel('pa24')");
    expect(client).toContain('console.warn');
    expect(client).toContain('close()');
  });
});
