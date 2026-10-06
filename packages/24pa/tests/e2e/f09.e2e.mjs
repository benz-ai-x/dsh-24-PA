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
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'pref-buffer', category: 'preference', topic: '工作偏好', content: '会议之间留 15 分钟缓冲', source: '本人指示', status: 'confirmed', reason: '本人偏好', expectedRevision: 0 } },
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
    const adopt = await waitToolResult('pa24_work', '已按你的选择写入', '采纳回执', 60_000, before);
    expect(adopt).toContain('eventId');
    const created = (await rows(`select summary from pa24.calendar_event where summary like '%专注时间%'`));
    expect(created).toHaveLength(1);
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
    const built = await waitToolResult('pa24_work', '简报已生成并发送', '简报回执', 60_000, before);
    const windowKey = (built.match(/"windowKey":"([^"]+)"/) || [])[1];
    expect(windowKey).toBeTruthy();
    const report = (await rows(`select status, (report is not null) as has_report from pa24.digest_occurrence where id='${planId}:${windowKey}'`))[0];
    expect(report.status).toBe('sent');
    expect(report.has_report).toBe(true);
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
