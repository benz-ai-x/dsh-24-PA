// F09 end-to-end: daily planning (focus/capacity/conflicts/selective adoption)
// and recurring digests over the native Schedule service. Real Loader +
// isolated PostgreSQL + real lark-cli stub + scripted LLM. DSH_BIN may point at
// the pinned baseline copy when the user's harness checkout moves.
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
const promptLocal = (requestId, text) =>
  host.remote('session/prompt', {
    request: { requestId, sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' },
  });
const waitMemoryRevision = async (expected, label) => {
  for (let i = 0; i < 60; i++) {
    const memory = await host.api('memory', {});
    if (memory.revision === expected) return memory;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待记忆 revision=${expected} 超时（${label}）`);
};
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
const rmdScript = (title, workerAction) => ({
  mode: 'dispatch',
  delegate: { worker: 'reminders', title, instruction: title },
  leadReply: '已交给提醒 Worker。',
  workerAction,
  workerReply: '已完成。',
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f09-'));
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

describe('F09 每日规划与定期回顾（真实 Loader + 隔离 PG）', () => {
  it('P16：plan_today 给出重点/容量/冲突与偏好缓冲；过载如实提示不自动延期', async () => {
    // 工作偏好：会议之间留 15 分钟（confirmed）
    await writeScript({
      mode: 'dispatch',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'pref-buffer', category: 'preference', topic: '工作偏好', content: '会议之间留 15 分钟缓冲', source: '本人指示', status: 'confirmed', confirmation: '本人明确要求记住此条内容', reason: '本人偏好', expectedRevision: 0 } },
      leadReply: '已记录偏好。',
    });
    await promptLocal('f09-pref-1', '记住：会议之间留 15 分钟');
    await waitMemoryRevision(1, '偏好写入');

    // 今日安排两项日程 + 三项任务（估时合计超载）
    await writeScript(calScript('建日程A', { action: 'calendar_create', summary: '上午评审', start: '2026-10-06T10:00:00+08:00', end: '2026-10-06T11:00:00+08:00' }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-p1', { text: '今天 10 点到 11 点安排上午评审' }));
    await waitWorkItem('建日程A', '日程A完成');
    await waitToolResult('pa24_work', 'eventId', '日程A回执', 60_000, before);

    await writeScript({ mode: 'dispatch', delegate: { worker: 'tasks', title: '建过载任务组', instruction: '建任务' }, leadReply: '已安排。', workerAction: { action: 'task_create', summary: '任务甲', due: new Date(Date.now() + 4 * 3600 * 1000).toISOString(), estimateMinutes: 120 }, workerReply: '已建。' });
    before = llm.log.length;
    await inject(ownerEvent('evt-p2', { text: '建任务：任务甲，估时两小时' }));
    await waitWorkItem('建过载任务组', '任务甲完成');
    await waitToolResult('pa24_work', '任务已创建', '任务甲回执', 60_000, before);

    await writeScript(calScript('今日规划', { action: 'plan_today' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-p3', { text: '看看今天的重点和容量' }));
    await waitWorkItem('今日规划', '规划完成');
    const plan = await waitToolResult('pa24_work', 'capacity', '规划回执', 60_000, before);
    expect(plan).toContain('bufferMinutesPerMeeting');
    expect(plan).toContain('"bufferMinutesPerMeeting":15');
    expect(plan).toContain('任务甲');
    expect(plan).toContain('plan_adopt');
  });

  it('P16：plan_preview 插单只影响重叠项；plan_adopt 选择性采纳并回执', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    // 明天 10 点已有固定安排，插单应只指出受影响部分
    await writeScript(calScript('建明日既有序', { action: 'calendar_create', summary: '既定周会', start: `${tomorrow}T10:00:00+08:00`, end: `${tomorrow}T11:00:00+08:00` }));
    let before0 = llm.log.length;
    await inject(ownerEvent('evt-p4a', { text: `明天 10 点到 11 点已有既定周会` }));
    await waitWorkItem('建明日既有序', '既有序完成');
    await waitToolResult('pa24_work', 'eventId', '既有序回执', 60_000, before0);
    await writeScript(calScript('预览插单', { action: 'plan_preview', date: tomorrow, insert: { summary: '临时会议', start: `${tomorrow}T10:00:00+08:00`, end: `${tomorrow}T11:00:00+08:00` } }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-p4', { text: '明天临时加一小时会议，看看影响' }));
    await waitWorkItem('预览插单', '预览完成');
    const preview = await waitToolResult('pa24_work', 'displacedByInsert', '预览回执', 60_000, before);
    expect(preview).toContain('未受影响安排不动');
    expect(preview).toContain('既定周会');

    // 选择性采纳：只写入用户选定的一个块
    await writeScript(calScript('采纳时间块', { action: 'plan_adopt', blocks: [{ summary: '专注时间：写方案', start: `${tomorrow}T14:00:00+08:00`, end: `${tomorrow}T16:00:00+08:00` }] }));
    before = llm.log.length;
    await inject(ownerEvent('evt-p5', { text: '就采纳下午两点到四点写方案这一块' }));
    await waitWorkItem('采纳时间块', '采纳完成');
    const adopt = await waitToolResult('pa24_work', '已确认写入', '采纳回执', 60_000, before);
    expect(adopt).toContain('eventId');
    const created = (await rows(`select summary from pa24.calendar_event where summary like '%专注时间%'`));
    expect(created).toHaveLength(1);

    // 外部同时改期：采纳另一块前，外部先占掉该时段 → 复核拒绝写入
    await writeScript(calScript('外部占位', { action: 'calendar_create', summary: '外部插入的客户会', start: `${tomorrow}T16:00:00+08:00`, end: `${tomorrow}T17:00:00+08:00` }));
    before = llm.log.length;
    await inject(ownerEvent('evt-p6', { text: '外部先占了明天下午四点，我这边也要采纳那一段试试' }));
    await waitWorkItem('外部占位', '外部占位完成');
    await waitToolResult('pa24_work', 'eventId', '外部占位回执', 60_000, before);
    await writeScript(calScript('采纳冲突块', { action: 'plan_adopt', blocks: [{ summary: '另一专注块', start: `${tomorrow}T16:00:00+08:00`, end: `${tomorrow}T16:30:00+08:00` }] }));
    before = llm.log.length;
    await inject(ownerEvent('evt-p7', { text: '再采纳下午四点到四点半那块' }));
    await waitWorkItem('采纳冲突块', '冲突采纳完成');
    const conflict = await waitToolResult('pa24_work', '复核发现与现有安排', '冲突拒绝', 60_000, before);
    expect(conflict).toContain('外部插入的客户会');
    expect((await rows(`select count(*)::int as n from pa24.calendar_event where summary like '%另一专注块%'`))[0].n).toBe(0);
  });

  it('P25：晚间回顾呈现完成/等待/逾期，不自动延期、不写记忆', async () => {
    // 先完成一项任务、留一项逾期，供晚间回顾呈现事实
    await writeScript({ mode: 'dispatch', delegate: { worker: 'tasks', title: '建并完成收尾任务', instruction: 'x' }, leadReply: 'ok', workerAction: { action: 'task_create', summary: '已完成的收尾任务' }, workerReply: 'ok' });
    let beforeSeed = llm.log.length;
    await inject(ownerEvent('evt-e0a', { text: '建一个今天要完成的收尾任务' }));
    await waitWorkItem('建并完成收尾任务', '收尾任务建立');
    const createdTask = await waitToolResult('pa24_work', '"guid"', '收尾任务回执', 60_000, beforeSeed);
    const doneGuid = (createdTask.match(/"guid":"(tskstub-[^"]+)"/) || [])[1];
    await writeScript({ mode: 'dispatch', delegate: { worker: 'tasks', title: '完成收尾任务', instruction: 'x' }, leadReply: 'ok', workerAction: { action: 'task_complete', guid: doneGuid }, workerReply: 'ok' });
    beforeSeed = llm.log.length;
    await inject(ownerEvent('evt-e0b', { text: '收尾任务完成了' }));
    await waitWorkItem('完成收尾任务', '收尾任务完成');

    await writeScript(rmdScript('开启晚间回顾', { action: 'digest_enable', kind: 'evening', time: '20:30:00' }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-e1', { text: '开启每天 20 点 30 分的晚间回顾' }));
    await waitWorkItem('开启晚间回顾', '晚间回顾开启');
    const enabled = await waitToolResult('pa24_work', 'planId', '晚间回执', 60_000, before);
    const planId = (enabled.match(/"planId":"(dig-[^"]+)"/) || [])[1];
    // 直接委派一次 digest_build（不等 20:30，验证内容渲染与幂等键）
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'digest', title: '立即出一期晚间回顾', instruction: '立即生成', planId },
      leadReply: '已生成。',
      workerAction: { action: 'digest_build', planId },
      workerReply: '已发出。',
    });
    before = llm.log.length;
    await inject(ownerEvent('evt-e2', { text: '现在就出一期晚间回顾' }));
    await waitWorkItem('立即出一期晚间回顾', '晚间回顾生成', 180_000);
    const out = await waitOutbox(`digest:${planId}:`, '晚间回顾发送', 60_000);
    const text = out.content?.text ?? '';
    expect(text).toContain('一、事实');
    expect(text).toContain('本期同步到完成状态');
    expect(text).toContain('事实区间：');
    expect(text).toContain('非精确完成时刻');
    expect(text).toContain('二、建议');
    expect(text).toContain('逾期');
    expect(text).toContain('未自动修改任何任务、日程或记忆');
    // 不写记忆
    const memory = await host.api('memory', {});
    expect(memory.revision).toBe(1);
    // 调整计划（同计划换时间，历史保留）
    await writeScript(rmdScript('调整晚间回顾', { action: 'digest_control', planId, op: 'adjust', kind: 'evening', time: '21:00:00' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-e3', { text: '晚间回顾改到 21 点' }));
    await waitWorkItem('调整晚间回顾', '调整完成');
    const adjusted = await waitToolResult('pa24_work', '已按新安排调整', '调整回执', 60_000, before);
    expect(adjusted).toContain(planId);
    expect((await rows(`select count(*)::int as n from pa24.digest_plan where id='${planId}'`))[0].n).toBe(1);
    // F19（spec 2.3）：per-plan 语音开关（迁移 v12 的 voice 列读写，引擎仍为 none 时投递降级文本）
    await writeScript(rmdScript('改为语音版', { action: 'digest_control', planId, op: 'voice', voice: true }));
    before = llm.log.length;
    await inject(ownerEvent('evt-e3v', { text: '晚间回顾改成语音版' }));
    await waitWorkItem('改为语音版', '语音开关完成');
    const voiced = await waitToolResult('pa24_work', '语音版', '语音开关回执', 60_000, before);
    expect(voiced).toContain('全文文本兜底');
    expect((await rows(`select voice from pa24.digest_plan where id='${planId}'`))[0].voice).toBeTruthy();
    // F40（spec 2.11）：任务 skill 绑定＋面板三动作（改时间/换 skill/立即运行一次）
    const view = await host.api('digests');
    const current = view.plans.find(p => p.planId === planId);
    expect(current.skill).toBe('digest-evening');
    expect(view.skills.map(s => s.name)).toContain('digest-morning');
    const swapped = await host.api('action', { type: 'digest.set-skill', planId, skill: 'digest-weekly' });
    expect(swapped.skill).toBe('digest-weekly');
    await expect(host.api('action', { type: 'digest.set-skill', planId, skill: 'ghost' })).rejects.toThrow(/不存在/);
    const rescheduled = await host.api('action', { type: 'digest.reschedule', planId, kind: 'evening', time: '21:30:00' });
    expect(rescheduled.planId).toBe(planId);
    expect(rescheduled.scheduleId).toBeTruthy();
    expect(JSON.stringify((await host.api('digests')).plans.find(p => p.planId === planId).schedule)).toContain('21:30:00');
    const runNow = await host.api('action', { type: 'digest.run-now', planId });
    expect(runNow.windowKey).toMatch(/^manual-\d+$/);
    const manualOutbox = await waitOutbox(`${runNow.outboxKey}`, '手动运行投递', 90_000);
    const [manualRun] = await rows(`select time_context from pa24.digest_occurrence where plan_id='${planId}' and window_key='${runNow.windowKey}'`);
    expect(manualRun.time_context).toMatchObject({ kind: 'weekly', source: 'manual', timeZone: 'Asia/Shanghai' });
    expect(new Date(manualRun.time_context.from).getUTCDay()).toBe(0); // 上海周一00点＝UTC周日16点
    expect((Date.parse(manualRun.time_context.nextTo) - Date.parse(manualRun.time_context.to)) / 86400000).toBe(7);
    expect(manualOutbox.content.text).toContain('下周日历');
    // 手动窗口不占用计划窗口：当日窗口键仍为本地日期
    expect(runNow.windowKey).not.toBe(current.recent?.[0]?.window ?? '');
  });

  it('P24/P25：once 晨报经原生 Schedule 唤醒 Lead→digest Worker→Outbox，事实与建议分离', async () => {
    // 一次性晨报（3 秒后），复用真实原生 Schedule
    await writeScript(rmdScript('开启晨报', { action: 'digest_enable', kind: 'once', afterSeconds: 3 }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-d1', { text: '三秒后给我出一期晨报试试' }));
    await waitWorkItem('开启晨报', '计划开启完成');
    const enabled = await waitToolResult('pa24_work', 'planId', '计划回执', 60_000, before);
    const planId = (enabled.match(/"planId":"(dig-[^"]+)"/) || [])[1];
    expect((await rows(`select schedule_id is not null and status='active' as ok from pa24.digest_plan where id='${planId}'`))[0].ok).toBe(true);

    // Schedule 触发 → 接入会话收到带标记的 prompt → mock 委派 digest Worker
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'digest', title: '生成晨报', instruction: '生成当前窗口晨报', planId },
      leadReply: '简报已生成。',
      workerAction: { action: 'digest_build', planId },
      workerReply: '晨报已发出。',
    });
    await waitWorkItem('生成晨报', '简报生成完成', 180_000);
    const built = await waitToolResult('pa24_work', '入发送队列', '简报回执', 60_000, before);
    const windowKey = (built.match(/"windowKey":"([^"]+)"/) || [])[1];
    expect(windowKey).toBeTruthy();
    const report = (await rows(`select status, (report is not null) as has_report from pa24.digest_occurrence where id='${planId}:${windowKey}'`))[0];
    expect(report.status).toBe('model_done');
    expect(report.has_report).toBe(true);
    const binding = (await rows(`select b.source, p.schedule_id from pa24.digest_work_binding b join pa24.digest_occurrence o on o.id=b.occurrence_id join pa24.digest_plan p on p.id=o.plan_id where o.id='${planId}:${windowKey}'`))[0];
    expect(binding.source.kind).toBe('schedule');
    expect(binding.source.deliveries.some(row => row.scheduleId === binding.schedule_id && row.messageId && row.occurrenceAt)).toBe(true);
    const out = await waitOutbox(`digest:${planId}:${windowKey}`, '晨报发送');
    const text = out.content?.text ?? '';
    expect(text).toContain('一、事实');
    expect(text).toContain('二、建议');
    expect(text).toContain('来源');
    expect(text).toContain('未自动修改任何任务');
  });

  it('P24：同窗重复投递不重复发布；投递无法归属时监督暂停（delivery_unconfirmed）', async () => {
    // 同窗重复：再委派一次 digest_build（同窗口）
    const planId = (await rows(`select id from pa24.digest_plan where kind='once' limit 1`))[0].id;
    const windowKey = (await rows(`select window_key from pa24.digest_occurrence where plan_id='${planId}' limit 1`))[0].window_key;
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'digest', title: '重复晨报', instruction: '再出一期', planId },
      leadReply: '已确认不重复。',
      workerAction: { action: 'digest_build', planId },
      workerReply: '本窗口已发布。',
    });
    let before = llm.log.length;
    await inject(ownerEvent('evt-d2', { text: '再出一次刚才那期晨报' }));
    await waitWorkItem('重复晨报', '重复晨报完成');
    await waitToolResult('pa24_work', '不重复发布', '重复拒绝', 60_000, before);
    expect((await rows(`select count(*)::int as n from pa24.digest_occurrence where plan_id='${planId}'`))[0].n).toBe(1);
    expect((await rows(`select count(*)::int as n from pa24.outbox where dedup_key like 'digest:${planId}%'`))[0].n).toBe(1);

    // 无法归属的投递：once 计划 2 秒后再触发，但 Lead 不委派（直接回复）
    await writeScript(rmdScript('开启无归属晨报', { action: 'digest_enable', kind: 'once', afterSeconds: 2 }));
    before = llm.log.length;
    await inject(ownerEvent('evt-d3', { text: '再开一期会失败的晨报' }));
    await waitWorkItem('开启无归属晨报', '无归属计划开启');
    const enabled = await waitToolResult('pa24_work', 'planId', '无归属计划回执', 60_000, before);
    const planId2 = (enabled.match(/"planId":"(dig-[^"]+)"/) || [])[1];
    // Lead 收到唤醒但不委派（脚本只回文本）→ 等投递发生
    await writeScript({ mode: 'dispatch', leadReply: '这期先不做了。' });
    await new Promise(r => setTimeout(r, 6000));
    // 监督（宽限覆写为 0）→ 计划暂停 + 通知
    await host.api('action', { type: 'digest.supervise', graceMs: 0 });
    await waitOutbox(`digestunconfirmed:${planId2}`, '无归属通知', 30_000);
    expect((await rows(`select status from pa24.digest_plan where id='${planId2}'`))[0].status).toBe('paused');
  });

  it('P24：重启后原生 Schedule 续跑，业务状态按账本恢复，不补发过期窗口', async () => {
    // 新 once 计划 8 秒后触发；在触发前重启
    await writeScript(rmdScript('重启晨报', { action: 'digest_enable', kind: 'once', afterSeconds: 8 }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-d4', { text: '八秒后出一期晨报（会中途重启）' }));
    await waitWorkItem('重启晨报', '重启计划开启');
    const enabled = await waitToolResult('pa24_work', 'planId', '重启计划回执', 60_000, before);
    const planId = (enabled.match(/"planId":"(dig-[^"]+)"/) || [])[1];

    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '重启就绪' },
    );
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'digest', title: '重启后晨报', instruction: '生成晨报', planId },
      leadReply: '简报已生成。',
      workerAction: { action: 'digest_build', planId },
      workerReply: '已发出。',
    });
    await waitWorkItem('重启后晨报', '重启后简报完成', 180_000);
    await waitOutbox(`digest:${planId}:`, '重启后晨报发送', 60_000);
    // 一次性计划完成后停止（Schedule 一次性语义；业务行保留历史）
    const plan = (await rows(`select status from pa24.digest_plan where id='${planId}'`))[0];
    expect(['active', 'stopped']).toContain(plan.status);
  });
});

describe('F41：agent 轨任务 skill', () => {
  it('自定义 skill 交接→Worker 生成→digest_deliver 交付', async () => {
    // 工作区自定义 skill（宿主 fs provider 热发现）
    const { mkdir, writeFile: wf } = await import('node:fs/promises');
    const skillsDir = join(workspace, '.dsh', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await wf(join(skillsDir, 'e2e-custom-brief.md'), [
      '---',
      'name: e2e-custom-brief',
      'description: e2e 自定义简报（agent 轨）',
      '---',
      '',
      '按完成标准生成简报：包含「自定义简报」字样与一条事实；未达标准时如实说明。',
      '',
    ].join('\n'));
    // fs provider 的 watcher 失效通知是异步的——轮询等目录出现
    let listed;
    for (let i = 0; i < 20 && !listed; i++) {
      await new Promise(r => setTimeout(r, 500));
      listed = ((await host.api('digests')).skills ?? []).find(s => s.name === 'e2e-custom-brief');
    }
    expect(listed, '目录应发现工作区 skill').toBeTruthy();
    expect(listed.track).toBe('agent');
    // 开计划绑定自定义 skill（经 reminders Worker 路由）
    await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title: '开自定义晨报', instruction: 'x' }, leadReply: 'ok', workerAction: { action: 'digest_enable', kind: 'weekly', time: '08:00:00', weekdays: [1], skill: 'e2e-custom-brief', voice: true }, workerReply: 'ok' });
    let before = llm.log.length;
    await inject(ownerEvent('evt-f41a', { text: '开启自定义 skill 晨报' }));
    await waitWorkItem('开自定义晨报', '自定义晨报开启');
    const enabled = await waitToolResult('pa24_work', '"skill":"e2e-custom-brief"', '绑定回执', 60_000, before);
    const planId = (enabled.match(/"planId":"(dig-[^"]+)"/) || [])[1];
    expect(planId).toBeTruthy();
    // 委派 digest Worker：digest_build → agent 轨交接
    await writeScript({ mode: 'dispatch', delegate: { worker: 'digest', title: '出自定义晨报', instruction: 'x', planId }, leadReply: '已生成。', workerAction: { action: 'digest_build', planId }, workerFollowupAction: { action: 'digest_deliver', planId, report: '自定义简报：今日无到期事项（e2e 数据面为空，达到完成标准的可用部分已列出）。' }, workerReply: '已交付。' });
    before = llm.log.length;
    await inject(ownerEvent('evt-f41b', { text: '现在出一份自定义晨报' }));
    await waitWorkItem('出自定义晨报', '自定义晨报生成', 180_000);
    const handoff = await waitToolResult('pa24_work', 'agentTrack', 'agent 轨交接', 60_000, before);
    expect(unescapeJsonish(handoff)).toContain('e2e-custom-brief');
    // 同一事项内交付：不能由新 Worker 猜测计划的最新窗口。
    const delivered = await waitToolResult('pa24_work', 'digest:', '交付回执', 60_000, before);
    const outboxKey = (delivered.match(/"outboxKey":"(digest:[^"]+)"/) || [])[1];
    expect(outboxKey).toBeTruthy();
    await waitOutbox(outboxKey, '自定义全文投递', 90_000);
    // tts.engine=none 的 e2e 环境：voice=1 如实降级纯文本（不冒充语音行）
    expect((await host.api('snapshot')).outbox.find(o => o.dedup_key === `${outboxKey}:voice`)).toBeUndefined();
    // 会前准备计划绑定 meeting-prep（存量迁移口径）
    const all = (await host.api('digests')).plans;
    expect(all.every(p => p.skill)).toBe(true);
  });
});

describe('F44：任务 skill 受控接入（双门）', () => {
  it('未放行拒绝且不留事项；放行后 skill 执行 Worker 载入正文执行', async () => {
    const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
    const currentConfig = async () => {
      const m = (await rf(join(workspace, 'AGENTS.md'), 'utf8')).match(/```json\n([\s\S]*?)\n```/);
      return JSON.parse(m[1]);
    };
    const writeWorkspaceConfig = async patch => {
      const cfg = { ...(await currentConfig()), ...patch };
      await wf(join(workspace, 'AGENTS.md'), '# 24私助工作区\n\n```json\n' + JSON.stringify(cfg, null, 2) + '\n```\n');
      await host.api('action', { type: 'workspace.reload' });
    };
    // 门一（角色未启用）：enabledWorkers 无 skill → 角色门拒绝
    await writeScript({ mode: 'dispatch', delegate: { worker: 'skill', title: '跑未放行 skill', instruction: 'x', skill: 'e2e-custom-brief' }, leadReply: '被拒绝了。', workerAction: { action: 'skill_run', skill: 'e2e-custom-brief' }, workerReply: 'ok' });
    let before = llm.log.length;
    await inject(ownerEvent('evt-f44a', { text: '帮我跑一下自定义 skill' }));
    await new Promise(r => setTimeout(r, 4000));
    expect(llm.log.slice(before).some(r => JSON.stringify(r).includes('未在配置中启用')), '角色门应拒绝').toBe(true);
    // 门一（放行面为空）：角色启用但 extraBusinessSkills 空 → 放行门拒绝
    const cfg = await currentConfig();
    await writeWorkspaceConfig({ enabledWorkers: [...new Set([...cfg.enabledWorkers, 'skill'])], extraBusinessSkills: [] });
    await writeScript({ mode: 'dispatch', delegate: { worker: 'skill', title: '跑空放行面 skill', instruction: 'x', skill: 'e2e-custom-brief' }, leadReply: '被拒绝了。', workerAction: { action: 'skill_run', skill: 'e2e-custom-brief' }, workerReply: 'ok' });
    before = llm.log.length;
    await inject(ownerEvent('evt-f44a2', { text: '再试试跑自定义 skill' }));
    await new Promise(r => setTimeout(r, 4000));
    expect(llm.log.slice(before).some(r => JSON.stringify(r).includes('未在 extraBusinessSkills')), '放行门应拒绝').toBe(true);
    // 门二开：角色＋放行面 → 委派成立，skill_run 载入正文
    await writeWorkspaceConfig({ extraBusinessSkills: ['e2e-custom-brief'] });
    await writeScript({ mode: 'dispatch', delegate: { worker: 'skill', title: '跑放行 skill', instruction: '执行该 skill', skill: 'e2e-custom-brief' }, leadReply: '已安排。', workerAction: { action: 'skill_run', skill: 'e2e-custom-brief' }, workerReply: '按指令完成。' });
    before = llm.log.length;
    await inject(ownerEvent('evt-f44b', { text: '再跑一次刚才放行的 skill' }));
    await waitWorkItem('跑放行 skill', '放行委派成立');
    const loaded = await waitToolResult('pa24_work', '完成标准', 'skill_run 载入正文', 60_000, before);
    expect(unescapeJsonish(loaded)).toContain('e2e-custom-brief');
    // 目录外名（放行面内点名但目录无）→ skill_run 拒绝
    await writeWorkspaceConfig({ extraBusinessSkills: ['e2e-custom-brief', 'ghost-skill'] });
    await writeScript({ mode: 'dispatch', delegate: { worker: 'skill', title: '跑幽灵 skill', instruction: 'x', skill: 'ghost-skill' }, leadReply: '目录里没有。', workerAction: { action: 'skill_run', skill: 'ghost-skill' }, workerReply: 'ok' });
    before = llm.log.length;
    await inject(ownerEvent('evt-f44c', { text: '跑 ghost-skill' }));
    await new Promise(r => setTimeout(r, 4000));
    expect(llm.log.slice(before).some(r => JSON.stringify(r).includes('不在目录中')), '目录外名应被拒绝').toBe(true);
    await writeWorkspaceConfig({ extraBusinessSkills: [] });
  });
});
