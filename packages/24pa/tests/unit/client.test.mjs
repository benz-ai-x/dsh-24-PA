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

  it('企微接入模块（F20→F26 卡片化）：接入卡片、检查动作、诊断四态与 helpMessage 原文', () => {
    expect(client).toContain("id: 'wecom', cat: 'access', tone: 'amber', icon: 'bot'");
    expect(client).toContain('function WecomView({ state, busy, button, openRobot })');
    expect(client).toContain("type: 'connection.wecom-check'");
    for (const anchor of ['正常', '未授权', '已过期', '企业不可用', 's.helpMessage', '下一步（nextSteps）']) {
      expect(client).toContain(anchor);
    }
  });

  it('能力卡片体系（F26/P58）：三分类 tab、12 卡注册表、角标聚合、管理态与详情导航', () => {
    // 一级导航＝三分类 tab（用户原型评审裁决，prototypes/pa24-card-panel v0.3）
    expect(client).toContain("const CATEGORY_TABS = [['biz', 'grid', 'blue'], ['access', 'plug', 'green'], ['system', 'shield', 'violet']];");
    expect(client).toContain("biz: '业务内容', access: '接入与通讯', system: '系统维护'");
    // 注册表驱动：注册即生卡；每卡必有 tier（角标聚合纯函数）＋body＋detail
    const ids = [...client.matchAll(/id: '([a-z]+)', cat: '(biz|access|system)'/g)].map(m => m[1]);
    expect(ids).toEqual(['work', 'reminders', 'review', 'memory', 'digest', 'feishu', 'wecom', 'qwennote', 'wiki', 'healthcheck', 'storage', 'budget']);
    expect((client.match(/^            tier: /gm) || []).length).toBe(ids.length);
    // tab 角标＝分类内 warn/error 卡片数，error 转红
    expect(client).toContain('const chipOf = cat =>');
    expect(client).toContain("chip.tone === 'error' ? ' error' : ''");
    // 管理态：显隐按分类记忆，localStorage 持久化
    expect(client).toContain("const CARD_HIDDEN_KEY = 'pa24.panelCards.hidden'");
    expect(client).toContain('pa24-manage');
    expect(client).toContain('管理卡片');
    // 二级详情：返回卡片导航＋原视图平移（飞书详情全量保留）
    expect(client).toContain("'返回卡片'");
    expect(client).toContain('function FeishuDetail({ state, busy, button, openRobot })');
    expect(client).toContain('function WorkDetail({ state, button, busy, workspace, openRobot })');
    expect(client).toContain('function ReadinessDetail({ state })');
    expect(client).toContain('function MinutesDetail({ state, extra, button, openRobot })');
    // 听记卡：F18 合流入口，状态来自维护健康 extra-local-tools
    expect(client).toContain("extraToolCap = extra => (extra.health?.capabilities || []).find(c => c.id === 'extra-local-tools')");
    // 未配置卡占位（知识库 F22 预留）
    expect(client).toContain("tier: () => 'missing', label: () => L('未配置', 'Not configured')");
    // 全应用健康检查卡（用户 2026-10-11 裁决）：聚合 tier＋一键全量检查含主动探测
    expect(client).toContain("id: 'healthcheck', cat: 'system', tone: 'blue', icon: 'shield'");
    expect(client).toContain('const healthAggregate = ({ state, extra }) =>');
    expect(client).toContain("'一键全量检查'");
    expect(client).toContain('helpers.run(helpers.runFullCheck)');
    // 快照轮询不变；卡片补充数据一次性读取并随手动刷新重取
    expect(client).toContain('const useExtra = (workspacePath, tick)');
    expect(client).toContain('setExtraTick');
    // 键盘 ←→/Home/End 三 tab 轮转
    expect(client).toContain('% CATEGORY_TABS.length');
  });

  it('UI 制度锚点（P53/F26）：语义配色、单主按钮、统一状态词汇、可关闭提示与防溢出', () => {
    // tab 配色语义（F26 三分类）：蓝业务 / 蓝绿接入 / 紫系统；卡片 tone 沿用同一语义色
    expect(client).toContain('.pa24-tone-green{');
    expect(client).toContain('.pa24-tone-violet{');
    expect(client).toContain("id: 'feishu', cat: 'access', tone: 'green', icon: 'plug'");
    expect(client).toContain("id: 'memory', cat: 'biz', tone: 'violet', icon: 'memory'");
    expect(client).toContain("id: 'review', cat: 'biz', tone: 'danger', icon: 'pen'");
    // header 压缩：eyebrow 退役、口号并入标题行
    expect(client).not.toContain('pa24-eyebrow');
    expect(client).toContain('pa24-title-row');
    // 右列短卡收缩与设置模态防横向裁切
    expect(client).toContain('align-items:start');
    expect(client).toContain('.pa24-settings{padding:22px;height:auto;min-width:0;width:100%}');
    // 一屏一主按钮：页头对话＋工作/记忆/企微空态 CTA＋设置分区绑定＋F26 对话管理
    // 引导空态（提醒/晨报/知识库三卡详情各一）＋全量健康报告的一键检查＝9 处为实心
    expect((client.match(/className: 'pa24-primary'/g) || []).length).toBe(9);
    expect(client).toContain("{ disabled: busy || !path, className: 'pa24-primary' }");
    // 统一状态语法：四档 STATUS 映射共享，诊断徽章仅覆盖原因词；
    // 「长连接已启动」为 SPEC §13 第 381 行锚定术语保留
    expect(client).toContain('const STATUS = {');
    expect(client).toContain('const statusBadge = (tier, label)');
    expect(client).not.toContain("'需注意'");
    expect(client).toContain("'长连接已启动'");
    expect(client).toContain('pa24-ellip');
    expect(client).toContain('关闭体验模式提示');
    expect(client).toContain('待发消息');
    // 浅色为主参考（F26 裁决）：主文字/次要双层令牌，暗色跟随不掉层级
    expect(client).toContain('--pa-ink:var(--dsw-alias-label-primary,#1f2937)');
    expect(client).toContain('body[data-ds-dark-theme] .pa24{');
  });

  it('中英双语（F27/P59）：en 命名空间注册＋resolveText L 通道＋无空英文', () => {
    expect(client).toContain("ctx.locale.register('pa24', { zh, en })");
    expect(client).toContain('const en = {');
    expect(client).toContain('const L = (zhText, enText) => ctx.locale.resolveText({ zh: zhText, en: enText });');
    // L() 无空英文参数（'…', '') 允许出现在 zh-only 后缀场景（如单位词），
    // 但成对文案不允许第二个参数为空串且无 CJK。
    const empties = [...client.matchAll(/L\('([^']*)', ''\)/g)].map(m => m[1]);
    for (const zhStr of empties) expect(zhStr.length).toBeLessThanOrEqual(4); // 仅单位词可空译
    // 状态词汇走字典键（P53 词汇双语）
    expect(client).toContain("'status.ok': '正常'");
    expect(client).toContain("'status.ok': 'OK'");
    // 切换即时生效：Panel 订阅 locale 快照
    expect(client).toContain('useSyncExternalStore(cb => ctx.locale.subscribe(cb), () => ctx.locale.getSnapshot())');
    // 卡片元数据消费点必须惰性解析（foot 曾漏改致中英拼接，回归锚点）
    expect(client).toContain('card.action ? L(...card.action) : L(\'查看详情\', \'Open\')');
    expect(client).toContain('h(\'b\', null, L(...card.title))');
    expect(client).toContain('L(...entry.title)');
    // zh/en 命名空间键集一致（解析两个字典块的键名）
    const dictKeys = name => {
      const block = client.split('const ' + name + ' = {')[1].split('\n    };')[0];
      return [...block.matchAll(/'?([A-Za-z][A-Za-z0-9_.-]*)'?\s*:/g)].map(m => m[1]).sort();
    };
    expect(dictKeys('en')).toEqual(dictKeys('zh'));
  });

  it('设置分区跳转面板走 layout 服务并保留关闭兜底', () => {
    expect(client).toContain("'layout'");
    expect(client).toContain("ctx.layout.selectPanel('pa24')");
    expect(client).toContain('console.warn');
    expect(client).toContain('close()');
  });
});
