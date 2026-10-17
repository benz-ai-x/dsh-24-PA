import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 锚点守卫：浏览器半无 DOM 测试环境，这里只做「注册面与结构必须存在」的
// copy guard（与 prompts.test.mjs 的锚点思路一致）；交互验收走 T20 真机。
const client = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../client.js'), 'utf8');

describe('client.js 挂载面', () => {
  it('语法可解析', () => {
    expect(() => new Function(client)).not.toThrow();
  });

  it('两个插槽注册齐全：主面板、侧栏图标（F35：settings.section 撤销）', () => {
    expect(client).toContain("ctx.slots.inject('main'");
    expect(client).toContain("ctx.slots.register({ name: 'main', key: 'pa24' }");
    expect(client).toContain("ctx.slots.inject('sidebar.panellist'");
    expect(client).not.toContain("ctx.slots.inject('settings.section'");
    expect(client).not.toContain('SettingsSection');
  });

  it('工作区管理在主面板系统维护（F35）：工作区与配置卡承载绑定/重载/生效配置/健康', () => {
    expect(client).toContain('function WorkspaceCards({ snapshot, busy, button, openRobot, path, onPathChange })');
    expect(client).not.toContain("tab === 'workspace'");
    // WorkspaceCards 只在「工作区与配置」卡详情挂载
    expect(client.match(/h\(WorkspaceCards,/g)?.length).toBeGreaterThanOrEqual(1);
    expect(client).toContain('function WorkspaceDetail({ helpers })');
    expect(client).toContain("id: 'workspace', cat: 'system'");
    expect(client).toContain("state.workspace ? 'ok' : 'missing'");
    // 动作外壳与机器人入口共享
    expect(client).toContain('function usePanelActions()');
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
    expect(ids).toEqual(['work', 'reminders', 'review', 'memory', 'digest', 'feishu', 'wecom', 'qwennote', 'wiki', 'workspace', 'healthcheck', 'storage', 'config', 'budget']);
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
    // 右列短卡收缩（设置模态样式随 F35 分区撤销一并移除）
    expect(client).toContain('align-items:start');
    expect(client).not.toContain('.pa24-settings{');
    // 一屏一主按钮：页头对话＋工作/记忆/企微空态 CTA＋工作区卡绑定＋F26 对话管理
    // 引导空态（提醒/晨报/知识库三卡详情各一）＋全量健康报告的一键检查＝10 处为实心
    expect((client.match(/className: 'pa24-primary'/g) || []).length).toBe(10); // F33 表单保存按钮
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
    // 深色黑底对齐 dsh 用色：底色挂 dsw alias 链回退 950 纯黑，
    // surface/soft 上调至 layer-2/3（卡片面板比宿主 flat 页面高一档分层）；
    // F34 走查校准：layer-2/3 基础上向白色 color-mix 提亮（surface 90%/soft 87%），
    // muted/line 同步提亮拉开深色层次与灰字对比（canvas 仍 950 纯黑）
    expect(client).toContain('--pa-canvas:var(--dsw-alias-bg-base,var(--dsw-static-neutral-bluish-950,rgb(21 21 23)))');
    expect(client).toContain('--pa-surface:color-mix(in srgb,var(--dsw-alias-bg-layer-2,var(--dsw-static-neutral-bluish-850,rgb(44 44 46))) 90%,#fff)');
    expect(client).toContain('--pa-soft:color-mix(in srgb,var(--dsw-alias-bg-layer-3,var(--dsw-static-neutral-bluish-800,rgb(53 54 56))) 87%,#fff)');
    expect(client).toContain('--pa-muted:color-mix(in srgb,var(--dsw-alias-label-caption,rgb(129 133 140)) 75%,#fff)');
  });

  it('F34 表单结构守卫：保存栏与分组卡同层级＋保存反馈随保存栏', () => {
    // 「运行参数」section 的 h( 调用区间不得吞掉后续兄弟节点（走查 P1：
    // 括号错位曾把存储/TTS/保存栏嵌进该 section，sticky 包含块被钳制，
    // 首屏保存栏不可见）。用括号深度走区间，字符串包含法测不出嵌套。
    const spanOf = (client, marker, back = "h('section'") => {
      const mi = client.indexOf(marker);
      expect(mi).toBeGreaterThan(0);
      const open = client.indexOf('(', client.lastIndexOf(back, mi));
      let depth = 0, inStr = null;
      for (let i = open; i < client.length; i++) {
        const c = client[i];
        if (inStr) { if (c === inStr && client[i - 1] !== '\\') inStr = null; }
        else if (c === '/' && client[i + 1] === '/') { while (i < client.length && client[i] !== '\n') i++; }
        else if (c === "'" || c === '"' || c === '`') inStr = c;
        else if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) return client.slice(open, i + 1); }
      }
      return null;
    };
    const runtime = spanOf(client, "L('运行参数', 'Runtime')");
    for (const swallowed of ['存储与密钥引用', '语音 TTS', 'form-actions']) {
      expect(runtime.includes(swallowed)).toBe(false);
    }
    // 保存/试听反馈（saveState）渲染在 .pa24-form-actions 区间内——
    // 用户在表单任意位置点保存，错误信息都在贴底常驻的保存栏里可见。
    const actions = spanOf(client, "className: 'pa24-form-actions'", "h('div");
    expect(actions.includes('saveState')).toBe(true);
    expect(actions.includes("role: saveState.ok ? 'status' : 'alert'")).toBe(true);
    // sticky 保存栏自带投影（贴底浮起的可供性）
    expect(client).toContain('box-shadow:0 -4px 14px color-mix(in srgb,var(--pa-ink) 9%,transparent)');
  });

  it('F34 走查第二轮：口径单位、接入进度、管理态键盘与反馈、表单双语 label', () => {
    // 健康卡口径：数字按检查项、说明静态聚合来源；tab 角标按卡片计（单位区分）
    expect(client).toContain('以上为就绪与能力健康的静态聚合');
    expect(client).toContain("L('该分类有 ' + chip.n + ' 张卡片需要关注");
    // 接入分类总进度行
    expect(client).toContain("cat === 'access' && !manage");
    expect(client).toContain('接入进度：就绪');
    // 管理态：Esc 退出＋隐藏轻反馈＋「完成」专用样式（不与页头主按钮抢主色）
    expect(client).toContain("if (e.key === 'Escape') setManage(false)");
    expect(client).toContain('已隐藏「');
    expect(client).toContain("className: manage ? 'pa24-manage-done' : 'pa24-quiet'");
    expect(client).toContain('.pa24-manage-done{');
    // 表单 label 双语化（中文语义＋括号内保留配置键名）；ownerOpenId 三态文案
    expect(client).toContain("L('模式（mode）', 'Mode (mode)')");
    expect(client).toContain("L('并发数（maxWorkers）', 'Parallelism (maxWorkers)')");
    expect(client).toContain("diagChecked ? '（检查过，尚未取得授权身份）' : '（在「接入」分类运行检查后可获取）'");
    // 表单不再双 h2：sectionHead 允许无标题（详情栏已有 entry.title）
    expect(client).toContain('title && h(\'h2\', null, title)');
    expect(client).toContain("sectionHead('code', null, L('保存＝校验");
    // 卡片注意态描边＋副标题两行显示
    expect(client).toContain('.pa24-cap-att{');
    expect(client).toContain('-webkit-line-clamp:2');
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

  it('参数配置表单（F33/P60）：system 分类卡＋六组表单＋config-update 动作', () => {
    expect(client).toContain("id: 'config', cat: 'system'");
    expect(client).toContain('function ConfigFormDetail({ helpers })');
    expect(client).toContain("type: 'workspace.config-update'");
    // 只读红线与一键应用授权值
    expect(client).toContain("readOnly: true, style: { flex: 1, minWidth: 0 }");
    expect(client).toContain('应用授权值');
    expect(client).toContain('切换存储后端涉及数据迁移');
    // 链接提取、试听复用、保存反馈
    expect(client).toContain('extractToken');
    expect(client).toContain("type: 'tts.test'");
    expect(client).toContain('已保存并重载生效');
    // 页脚口径：参数可经表单或对话维护
    expect(client).toContain('参数可经表单或对话维护');
  });

  it('F35：inject 面不再含 layout（设置分区撤销，面板内无跳转需求）', () => {
    expect(client).toContain("inject: ['slots', 'locale', 'connection', 'uiWorkspace']");
    expect(client).not.toContain("ctx.layout");
    expect(client).not.toContain('selectPanel');
  });
});
