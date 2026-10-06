// F10 end-to-end: meeting prep packages bound to a calendar event, and
// post-meeting minutes with selectively adopted candidate actions.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, hostRoot, localSessionId;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const inject = (event) => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, extra = {}) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', chatType: 'p2p', ...extra });
const waitWorkItem = async (title, label, timeoutMs = 180_000) =>
  host.waitUntil(s => (s.work ?? []).some(w => w.title === title && w.status === 'completed'), { timeoutMs, label });
const unescapeJsonish = text => text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const waitToolResult = async (toolName, substr, label, timeoutMs = 60_000, since = 0) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
    if (last && unescapeJsonish(last.toolResults.join('')).includes(substr)) return unescapeJsonish(last.toolResults.join(''));
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? unescapeJsonish(last.toolResults.join('')).slice(0, 500) : '无'}`);
};
const waitOutbox = async (prefix, label, timeoutMs = 60_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const snap = await host.api('snapshot');
    const row = (snap.outbox ?? []).find(o => o.dedup_key.startsWith(prefix) && o.status === 'sent');
    if (row) return row;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待发送（${label}）超时`);
};
const rows = async (sql) => JSON.parse(await cluster.query(`select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`));
const baseConfig = {
  version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
  folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
  appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
  maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'reminders', 'calendar', 'digest'], workerModels: {},
};
const calScript = (title, workerAction) => ({
  mode: 'dispatch',
  delegate: { worker: 'calendar', title, instruction: title },
  leadReply: '已交给日程 Worker。',
  workerAction,
  workerReply: '已完成。',
});
const memoScript = (title, workerAction) => ({
  mode: 'dispatch',
  delegate: { worker: 'memo', title, instruction: title },
  leadReply: '已交给备忘 Worker。',
  workerAction,
  workerReply: '已完成。',
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f10-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner' }));
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  await writeFile(join(workspace, 'AGENTS.md'), `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify(baseConfig, null, 2)}\n\`\`\`\n`);
  bootEnv = {
    PA24_WORKSPACE: workspace,
    PA24_PG_DSN: cluster.dsn,
    PA24_FEISHU_APP_ID: 'cli_test_app',
    PA24_FEISHU_APP_SECRET: 'test_secret',
    PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url,
    DEEPSEEK_API_KEY: 'test-key',
    PA24_LARK_STUB_STATE: stubStatePath,
    PATH: `${binDir}:${process.env.PATH}`,
  };
  host = await bootHost({ env: bootEnv });
  hostRoot = host.root;
  const snap = await host.waitUntil(
    s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
    { label: '插件就绪' },
  );
  localSessionId = snap.workspace.localSessionId;
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F10 会议资料与纪要行动（真实 Loader + 隔离 PG）', () => {
  it('P26：会前准备包绑定会议，发送前复查状态；资料缺失如实说明；会议取消联动停止', async () => {
    // 建会议（3 分钟后开始，提前 1 分钟准备 → 2 分钟后触发，太久；改为直接把计划 at 设近：会议开始 = now+40s，lead 30s → 10s 后触发）
    const start = new Date(Date.now() + 95_000).toISOString();
    const end = new Date(Date.now() + 125_000).toISOString();
    await writeScript(calScript('建评审会', { action: 'calendar_create', summary: '季度评审会', start, end }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-mp0', { text: '40 秒后开季度评审会，半小时' }));
    await waitWorkItem('建评审会', '评审会建立');
    const created = await waitToolResult('pa24_work', 'eventId', '评审会回执', 60_000, before);
    const eventId = (created.match(/"eventId":"(evtstub-[^"]+)"/) || [])[1];

    // 绑定会前准备（提前 30 分钟已过期 → 用提前 30 秒；fireAt = start-30s = now+10s）
    await writeScript(calScript('安排会前准备', { action: 'meeting_prep_enable', eventId, leadMinutes: 1 }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mp1', { text: '会前 1 分钟给我准备包' }));
    await waitWorkItem('安排会前准备', '准备安排完成');
    const enabled = await waitToolResult('pa24_work', 'planId', '准备计划回执', 60_000, before);
    const planId = (enabled.match(/"planId":"(prep-[^"]+)"/) || [])[1];
    expect(enabled).toContain('不会发送过时准备包');

    // Schedule 到点唤醒 → Lead 委派 calendar Worker 生成准备包
    await writeScript(calScript('生成会前准备', { action: 'meeting_prep_build', planId }));
    await waitWorkItem('生成会前准备', '准备包生成', 180_000);
    const built = await waitToolResult('pa24_work', '准备包已生成', '准备包回执', 60_000, llm.log.length - 5);
    expect(built).toContain(eventId);
    const out = await waitOutbox(`digest:${planId}:${eventId}`, '准备包发送', 30_000);
    const text = out.content?.text ?? '';
    expect(text).toContain('会前准备');
    expect(text).toContain('发送前已复查会议状态');
    expect(text).toContain('没有找到与该会议相关的备忘'); // 资料缺失如实
    expect(text).toContain('不编造议程');
    expect(text).toContain('WorkItem');

    // 重复触发同窗 → 不重复发送
    await writeScript(calScript('重复会前准备', { action: 'meeting_prep_build', planId }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mp2', { text: '再生成一次准备包' }));
    await waitWorkItem('重复会前准备', '重复准备完成');
    await waitToolResult('pa24_work', '不重复发送', '重复拒绝', 60_000, before);

    // 会议改期 → 准备计划联动停止（不发送过时准备包），再 build 明确说明已停止
    const movedStart = new Date(Date.now() + 3600_000).toISOString();
    const movedEnd = new Date(Date.now() + 3900_000).toISOString();
    await writeScript(calScript('改期评审会', { action: 'calendar_update', eventId, start: movedStart, end: movedEnd }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mp3', { text: '评审会改到一小时后' }));
    await waitWorkItem('改期评审会', '改期完成');
    await waitToolResult('pa24_work', '日程已修改', '改期回执', 60_000, before);
    expect((await rows(`select status from pa24.digest_plan where id='${planId}'`))[0].status).toBe('stopped');
    await writeScript(calScript('停止后再build', { action: 'meeting_prep_build', planId }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mp4', { text: '再试一次准备包' }));
    await waitWorkItem('停止后再build', '停止后build完成');
    await waitToolResult('pa24_work', '计划已停止', '停止说明', 60_000, before);
  });

  it('P26：准备包含上次纪要与相关任务（带出处），范围可绑定', async () => {
    // 先造一份纪要和相关任务
    await writeScript(memoScript('生成旧纪要', {
      action: 'minutes_build',
      topic: '季度评审',
      eventId: null,
      content: '上次评审决定推进 B 稿。',
      candidates: [{ index: 0, summary: '上次行动：确认供应商', sourceQuote: '先确认供应商' }],
    }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-mp5', { text: '整理上次季度评审的纪要' }));
    await waitWorkItem('生成旧纪要', '旧纪要完成');
    await waitToolResult('pa24_work', 'minutesId', '旧纪要回执', 60_000, before);

    await writeScript({ mode: 'dispatch', delegate: { worker: 'tasks', title: '建相关任务', instruction: 'x' }, leadReply: 'ok', workerAction: { action: 'task_create', summary: '季度评审材料打包' }, workerReply: 'ok' });
    before = llm.log.length;
    await inject(ownerEvent('evt-mp6', { text: '建任务：季度评审材料打包' }));
    await waitWorkItem('建相关任务', '相关任务完成');

    const start = new Date(Date.now() + 95_000).toISOString();
    const end = new Date(Date.now() + 125_000).toISOString();
    await writeScript(calScript('建第二次评审', { action: 'calendar_create', summary: '季度评审会第二轮', start, end }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mp7', { text: '40 秒后开季度评审会第二轮' }));
    await waitWorkItem('建第二次评审', '二轮会议建立');
    const created2 = await waitToolResult('pa24_work', 'eventId', '二轮回执', 60_000, before);
    const eventId2 = (created2.match(/"eventId":"(evtstub-[^"]+)"/) || [])[1];

    await writeScript(calScript('安排二轮准备', { action: 'meeting_prep_enable', eventId: eventId2, leadMinutes: 1 }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mp8', { text: '二轮会前 1 分钟也给我准备包' }));
    await waitWorkItem('安排二轮准备', '二轮准备安排完成');
    const enabled2 = await waitToolResult('pa24_work', 'planId', '二轮准备回执', 60_000, before);
    const planId2 = (enabled2.match(/"planId":"(prep-[^"]+)"/) || [])[1];

    await writeScript(calScript('生成二轮准备', { action: 'meeting_prep_build', planId: planId2 }));
    await waitWorkItem('生成二轮准备', '二轮准备生成', 180_000);
    await waitToolResult('pa24_work', '准备包已生成', '二轮准备回执', 60_000, llm.log.length - 5);
    const out2 = await waitOutbox(`digest:${planId2}:${eventId2}`, '二轮准备发送', 60_000);
    const text2 = out2.content?.text ?? '';
    expect(text2).toContain('上次纪要');
    expect(text2).toContain('上次行动：确认供应商');
    expect(text2).toContain('相关未完成任务');
    expect(text2).toContain('季度评审材料打包');
  });

  it('P27：会后纪要保存文档＋候选行动分离；选择性采纳幂等、信息不足不执行', async () => {
    const candidates = [
      { index: 0, summary: '本周五前确认预算数字', sourceQuote: '周五前把预算定下来', owner: '我', due: null },
      { index: 1, summary: '待定：客户拜访时间', sourceQuote: '下周去一趟客户那边', owner: null, due: null, start: null, end: null, unknown: '时间未定' },
    ];
    await writeScript(memoScript('生成会议纪要', {
      action: 'minutes_build',
      topic: '季度评审会',
      eventId: null,
      content: '决定：预算方案按 B 稿推进。讨论：交付排期延后一周。行动：周五前把预算定下来；下周去一趟客户那边（时间未定）。',
      candidates,
    }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-mn1', { text: '这是刚才季度评审会的记录，整理成纪要' }));
    await waitWorkItem('生成会议纪要', '纪要生成完成');
    const built = await waitToolResult('pa24_work', 'minutesId', '纪要回执', 60_000, before);
    const minutesId = (built.match(/"minutesId":"(min-[^"]+)"/) || [])[1];
    expect(built).toContain('未执行任何行动');
    expect(built).toContain('docUrl');
    const minutes = (await rows(`select status, doc_url, jsonb_array_length(candidates) as n from pa24.minutes where id='${minutesId}'`))[0];
    expect(minutes.status).toBe('draft');
    expect(minutes.n).toBe(2);
    expect(minutes.doc_url).toContain('example.feishu.cn');

    // 选择性采纳：只选 0（信息足够）；候选 1 含未知项 → 单独选时拒绝
    await writeScript(memoScript('执行选定行动', { action: 'minutes_adopt_actions', minutesId, indexes: [0], instruction: '本人确认执行第 0 项' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mn2', { text: '纪要里第一条行动去执行' }));
    await waitWorkItem('执行选定行动', '行动执行完成');
    const adopted = await waitToolResult('pa24_work', '已按你的选择执行 1 项', '采纳回执', 60_000, before);
    expect(adopted).toContain('tskstub');
    const taskCount = await rows(`select id, summary from pa24.task where summary like '%预算数字%'`);
    expect(taskCount).toHaveLength(1);
    expect((await rows(`select status from pa24.minutes where id='${minutesId}'`))[0].status).toBe('actions_taken');

    // 重复选择同一编号 → 幂等返回已有对象，不重复创建
    await writeScript(memoScript('重复执行', { action: 'minutes_adopt_actions', minutesId, indexes: [0], instruction: '本人再次确认' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mn3', { text: '再执行一次第一条' }));
    await waitWorkItem('重复执行', '重复执行完成');
    await waitToolResult('pa24_work', '重复选择同一编号返回已有对象', '幂等回执', 60_000, before);
    expect((await rows(`select count(*)::int as n from pa24.task where summary like '%预算数字%'`))[0].n).toBe(1);

    // 日历候选（新纪要）：start/end → 时间块；跨会话重复返回已有日程
    const calCandidates = [
      { index: 0, summary: '复盘会时间块', sourceQuote: '周五下午复盘', start: new Date(Date.now() + 48 * 3600_000).toISOString(), end: new Date(Date.now() + 49 * 3600_000).toISOString() },
    ];
    await writeScript(memoScript('生成日历候选纪要', { action: 'minutes_build', topic: '排期会', content: '定周五复盘。', candidates: calCandidates }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mn5', { text: '这是排期会的记录' }));
    await waitWorkItem('生成日历候选纪要', '日历纪要完成');
    const calBuilt = await waitToolResult('pa24_work', 'minutesId', '日历纪要回执', 60_000, before);
    const calMinutesId = [...calBuilt.matchAll(/"minutesId":"(min-[^"]+)"/g)].at(-1)?.[1];
    await writeScript(memoScript('执行日历候选', { action: 'minutes_adopt_actions', minutesId: calMinutesId, indexes: [0], instruction: '本人确认排周五复盘' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mn6', { text: '把复盘会排上' }));
    await waitWorkItem('执行日历候选', '日历候选执行完成');
    const calAdopted = await waitToolResult('pa24_work', '已按你的选择执行 1 项', '日历采纳回执', 60_000, before);
    expect(calAdopted).toContain('kind');
    const firstCount = (await rows(`select count(*)::int as n from pa24.calendar_event where summary like '%复盘会时间块%'`))[0].n;
    expect(firstCount).toBe(1);
    await writeScript(memoScript('重复日历候选', { action: 'minutes_adopt_actions', minutesId: calMinutesId, indexes: [0], instruction: '本人再次确认' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mn7', { text: '复盘会再执行一遍试试' }));
    await waitWorkItem('重复日历候选', '重复日历执行完成');
    await waitToolResult('pa24_work', '返回已有日程', '日历幂等回执', 60_000, before);
    expect((await rows(`select count(*)::int as n from pa24.calendar_event where summary like '%复盘会时间块%'`))[0].n).toBe(1);

    // 信息不足候选 → 明确拒绝执行
    await writeScript(memoScript('执行未知项', { action: 'minutes_adopt_actions', minutesId, indexes: [1], instruction: '试试第二条' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-mn4', { text: '第二条也执行' }));
    await waitWorkItem('执行未知项', '未知项执行完成');
    const refused = await waitToolResult('pa24_work', '信息不足不执行', '未知拒绝', 60_000, before);
    expect(refused).toContain('时间未定');
    expect((await rows(`select count(*)::int as n from pa24.task where summary like '%客户拜访%'`))[0].n).toBe(0);
  });
});
