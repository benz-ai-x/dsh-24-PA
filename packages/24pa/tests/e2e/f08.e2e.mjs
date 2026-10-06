// F08 end-to-end: explicit-instruction outreach, source-following reminders,
// recurring task templates, and waiting items. Real Loader + isolated
// PostgreSQL + real lark-cli subprocess (Feishu side stubbed) + scripted LLM.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
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
const unescapeJsonish = text => text.replace(/\\\"/g, '"').replace(/\\\\/g, '\\');
const waitToolResult = async (toolName, substr, label, timeoutMs = 60_000, since = 0) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
    if (last) {
      const joined = unescapeJsonish(last.toolResults.join(''));
      if (joined.includes(substr)) return joined;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? unescapeJsonish(last.toolResults.join('')).slice(0, 500) : '无'}`);
};
const waitOutbox = async (prefix, label, timeoutMs = 30_000) => {
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
const stubCalls = async () => {
  try {
    return (await readFile(`${stubStatePath}.calls.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
};
const stubSends = async () => {
  try {
    return (await readFile(`${stubStatePath}.sends.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
};
const baseConfig = {
  version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
  folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
  appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
  maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'reminders', 'calendar'], workerModels: {},
};
const tasksScript = (title, workerAction, worker = 'tasks') => ({
  mode: 'dispatch',
  delegate: { worker, title, instruction: title },
  leadReply: '已交给待办 Worker。',
  workerAction,
  workerReply: '已完成。',
});
const clickCard = (eventId, token) => inject(ownerEvent(eventId, { kind: 'card', cardAction: { value: { pa24: 'review', token } } }));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f08-'));
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

describe('F08 事项交办与持续跟进（真实 Loader + 隔离 PG）', () => {
  it('P13：联系人入库后按明确指令发信；草稿不发送、目标不清先澄清', async () => {
    await writeScript({
      mode: 'dispatch',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'contact-lilei', category: 'fact', topic: '联系人：李雷', content: '联系人 李雷：ou_collab_1（合作方负责人）', source: '本人提供', status: 'confirmed', reason: '本人提供的联系人', expectedRevision: 0 } },
      leadReply: '已记录联系人。',
    });
    await promptLocal('f08-contact-1', '记一下联系人：李雷，open_id 是 ou_collab_1');
    await waitMemoryRevision(1, '联系人写入');

    // 草稿请求：无 instruction → 拒绝发送
    await writeScript(tasksScript('草拟问候', { action: 'outreach_send', name: '李雷', content: '你好，本周预算请尽快确认。' }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-ot-0', { text: '帮我给李雷拟一条催预算的消息' }));
    await waitWorkItem('草拟问候', '草拟完成');
    await waitToolResult('pa24_work', '草稿不发送', '草稿拒绝', 60_000, before);

    // 目标不清：王不明 无记忆 → 澄清，未发送
    await writeScript(tasksScript('发给王不明', { action: 'outreach_send', name: '王不明', content: '你好', instruction: '本人明确要求发送' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-ot-1', { text: '给王不明发消息说你好' }));
    await waitWorkItem('发给王不明', '目标不清完成');
    await waitToolResult('pa24_work', '无法唯一确定', '目标澄清', 60_000, before);
    expect((await stubCalls()).filter(c => c.args.includes('+messages-send'))).toHaveLength(0);

    // 正式发送：带指令依据
    await writeScript(tasksScript('正式发信', { action: 'outreach_send', name: '李雷', content: '李雷你好，请在本周五前确认预算数字。', instruction: '本人明确要求今天发给李雷' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-ot-2', { text: '按我刚才确认的内容正式发给李雷' }));
    await waitWorkItem('正式发信', '发信完成');
    const sent = await waitToolResult('pa24_work', '已按本人明确指令发送', '发送回执', 60_000, before);
    const opId = (sent.match(/"operationId":"(out:[^"]+)"/) || [])[1];
    const row = (await rows(`select status, message_id, target_name from pa24.outreach where id='${opId}'`))[0];
    expect(row.status).toBe('succeeded');
    expect(row.target_name).toBe('李雷');
    expect(row.message_id).toMatch(/^omstub-/);
    const sends = (await stubCalls()).filter(c => c.args.includes('+messages-send'));
    expect(sends).toHaveLength(1);
    expect(sends[0].args).toContain('ou_collab_1');

    // 发送失败如实记录（不伪造成功）
    await writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner', failNext: { command: 'im.send', error: '注入的发送失败' } }));
    await writeScript(tasksScript('发信失败', { action: 'outreach_send', name: '李雷', content: '第二条：附件见邮件。', instruction: '本人明确要求发送第二条' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-ot-3', { text: '再发一条附件说明给李雷' }));
    await waitWorkItem('发信失败', '发信失败完成');
    await waitToolResult('pa24_work', '注入的发送失败', '失败如实', 60_000, before);
  });

  it('P13：按明确指令把任务分派给联系人，操作留痕', async () => {
    await writeScript(tasksScript('建任务待分派', { action: 'task_create', summary: '准备预算表', due: null }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-as-0', { text: '建一个任务：准备预算表' }));
    await waitWorkItem('建任务待分派', '任务建立');
    const created = await waitToolResult('pa24_work', '"guid"', '任务回执', 60_000, before);
    const guid = (created.match(/"guid":"(tskstub-[^"]+)"/) || [])[1];

    await writeScript(tasksScript('分派给李雷', { action: 'task_assign', guid, name: '李雷', instruction: '本人明确要求把预算表交给李雷' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-as-1', { text: '把准备预算表这个任务分派给李雷' }));
    await waitWorkItem('分派给李雷', '分派完成');
    await waitToolResult('pa24_work', '已把任务分派给', '分派回执', 60_000, before);
    const assigns = (await stubCalls()).filter(c => c.args.includes('+assign'));
    expect(assigns).toHaveLength(1);
    expect(assigns[0].args).toContain(guid);
    expect(assigns[0].args).toContain('ou_collab_1');
    expect((await rows(`select count(*)::int as n from pa24.outreach where kind='assign' and status='succeeded'`))[0].n).toBe(1);
  });

  it('P19：任务改期后，跟随该任务的提醒取消并说明原因', async () => {
    await writeScript(tasksScript('建任务供跟随', { action: 'task_create', summary: '季度对账', due: '2026-10-08' }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-lk-0', { text: '建任务：季度对账，截止 10 月 8 日' }));
    await waitWorkItem('建任务供跟随', '跟随任务建立');
    const created = await waitToolResult('pa24_work', '"guid"', '跟随任务回执', 60_000, before);
    const guid = (created.match(/"guid":"(tskstub-[^"]+)"/) || [])[1];

    await writeScript(tasksScript('设跟随提醒', { action: 'reminder_create', kind: 'once', afterSeconds: 3, text: '季度对账今天截止', linkTaskGuid: guid }, 'reminders'));
    before = llm.log.length;
    await inject(ownerEvent('evt-lk-1', { text: '三秒后提醒我季度对账' }));
    await waitWorkItem('设跟随提醒', '跟随提醒建立');
    await waitToolResult('pa24_work', 'ruleId', '提醒回执', 60_000, before);
    const allRules = await rows(`select id, kind, text, link_source_id, origin_expression from pa24.reminder_rule order by created_at`);
    console.error('RULES:', JSON.stringify(allRules), 'GUID:', guid);
    const rule = allRules.find(r => r.link_source_id === guid);
    expect(rule?.link_source_id).toBe(guid);

    // 任务改期 → 来源指纹变化 → 规则停止、实例取消、说明原因
    await writeScript(tasksScript('改期对账', { action: 'task_update', guid, due: '2026-10-20' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-lk-2', { text: '季度对账改到 10 月 20 日' }));
    await waitWorkItem('改期对账', '改期完成');
    await waitOutbox('remindsrc:', '来源变更说明', 30_000);
    // once 规则到期即 completed；被拦下的路径既可能是主动停用，也可能是发送前复核
    const ruleStatus = (await rows(`select status from pa24.reminder_rule where id='${rule.id}'`))[0].status;
    expect(['stopped', 'completed']).toContain(ruleStatus);
    expect((await rows(`select count(*)::int as n from pa24.reminder_occurrence where rule_id='${rule.id}' and status='sent'`))[0].n).toBe(0);
  });

  it('P19：已发送的旧提醒在来源变化后补发关联更正', async () => {
    await writeScript(tasksScript('建任务供更正', { action: 'task_create', summary: '周报汇总', due: '2026-10-08' }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-cr-0', { text: '建任务：周报汇总，截止 10 月 8 日' }));
    await waitWorkItem('建任务供更正', '更正任务建立');
    const created = await waitToolResult('pa24_work', '"guid"', '更正任务回执', 60_000, before);
    const guid = (created.match(/"guid":"(tskstub-[^"]+)"/) || [])[1];

    await writeScript(tasksScript('设即时提醒', { action: 'reminder_create', kind: 'once', afterSeconds: 1, text: '周报汇总今天截止', linkTaskGuid: guid }, 'reminders'));
    before = llm.log.length;
    await inject(ownerEvent('evt-cr-1', { text: '一秒后提醒我周报汇总' }));
    await waitWorkItem('设即时提醒', '即时提醒建立');
    const ruleId = ((await waitToolResult('pa24_work', 'ruleId', '即时提醒回执', 60_000, before)).match(/(rmd-[a-z0-9-]+)/) || [])[1];
    await waitOutbox(`reminder:${ruleId}:`, '旧提醒已发出', 30_000);

    // 来源变化 → 已发送的旧提醒补更正
    await writeScript(tasksScript('改期周报', { action: 'task_update', guid, due: '2026-10-15' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-cr-2', { text: '周报汇总改到 10 月 15 日' }));
    await waitWorkItem('改期周报', '周报改期完成');
    await waitOutbox('srccorr:', '关联更正', 30_000);
  });

  it('P22：周期任务模板生成真实任务，支持跳过本次与停止以后（含重启）', async () => {
    await writeScript(tasksScript('建模板', { action: 'task_repeat_create', kind: 'every', everySeconds: 60, title: '检查账单' }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-tp-0', { text: '每分钟检查一次账单，做成周期任务' }));
    await waitWorkItem('建模板', '模板建立');
    const created = await waitToolResult('pa24_work', 'templateId', '模板回执', 60_000, before);
    const templateId = (created.match(/"templateId":"(ttpl-[^"]+)"/) || [])[1];
    const nextDue = (created.match(/"nextDueAt":"([^"]+)"/) || [])[1];
    // 创建即播种首个计划实例（否则模板永不触发）
    expect((await rows(`select count(*)::int as n from pa24.task_template_instance where id='${templateId}:${nextDue}' and status='pending'`))[0].n).toBe(1);

    // 预置一个已到期的历史实例（模拟“错过最近一次”），tick 应生成真实任务
    await cluster.query(`insert into pa24.task_template_instance (id, template_id, due_at) values ('${templateId}:seed', '${templateId}', now() - interval '5 seconds')`);
    let generated;
    for (let i = 0; i < 60 && !generated; i++) {
      const rowsResult = await rows(`select status, task_id from pa24.task_template_instance where id='${templateId}:seed'`);
      if (rowsResult[0]?.status === 'generated') generated = rowsResult[0];
      else await new Promise(r => setTimeout(r, 1000));
    }
    expect(generated?.task_id).toBeTruthy();
    expect((await rows(`select task_guid from pa24.task where id='${generated.task_id}'`))[0].task_guid).toMatch(/^tskstub-/);

    // 重启后模板继续；下一次计划实例到期后生成（真实 dsh-schedule 推进）
    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '重启就绪' },
    );
    let second;
    for (let i = 0; i < 100 && !second; i++) {
      const pending = await rows(`select count(*)::int as n from pa24.task_template_instance where template_id='${templateId}' and status='generated'`);
      if (pending[0].n >= 2) second = pending[0];
      else await new Promise(r => setTimeout(r, 1000));
    }
    expect(second?.n).toBeGreaterThanOrEqual(2);

    // 跳过本次：下一个 pending 实例被跳过，不生成任务
    await writeScript(tasksScript('跳过本次', { action: 'task_repeat_skip', templateId }));
    before = llm.log.length;
    await inject(ownerEvent('evt-tp-1', { text: '检查账单这轮跳过' }));
    await waitWorkItem('跳过本次', '跳过完成');
    await waitToolResult('pa24_work', '已跳过本次', '跳过回执', 60_000, before);

    // 修改以后：改标题影响后续生成
    await writeScript(tasksScript('改模板标题', { action: 'task_repeat_update', templateId, title: '检查账单并回执' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-tp-3', { text: '检查账单以后改叫检查账单并回执' }));
    await waitWorkItem('改模板标题', '改标题完成');
    await waitToolResult('pa24_work', '已修改以后', '改标题回执', 60_000, before);

    // 停止以后：剩余 pending 实例全部跳过，模板停止
    await writeScript(tasksScript('停止模板', { action: 'task_repeat_stop', templateId }));
    before = llm.log.length;
    await inject(ownerEvent('evt-tp-2', { text: '检查账单的周期任务停掉' }));
    await waitWorkItem('停止模板', '停止完成');
    await waitToolResult('pa24_work', '已停止以后', '停止回执', 60_000, before);
    expect((await rows(`select status from pa24.task_template where id='${templateId}'`))[0].status).toBe('stopped');
    expect((await rows(`select count(*)::int as n from pa24.task_template_instance where template_id='${templateId}' and status='pending'`))[0].n).toBe(0);
    // 已生成历史保留
    expect((await rows(`select count(*)::int as n from pa24.task_template_instance where template_id='${templateId}' and status='generated'`))[0].n).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it('P23：等待事项到点只询问本人；收到后停止；同源去重', async () => {
    await writeScript(tasksScript('建等待事项', { action: 'waiting_create', title: '等李雷回预算数字', sourceDesc: '李雷的消息', dedupKey: 'wait:lilei:budget', checkpointInSeconds: 2 }));
    let before = llm.log.length;
    await inject(ownerEvent('evt-wt-0', { text: '记一下：等李雷回预算数字，两秒后问我收到没' }));
    await waitWorkItem('建等待事项', '等待建立');
    const created = await waitToolResult('pa24_work', 'waitingId', '等待回执', 60_000, before);
    const waitingId = (created.match(/"waitingId":"(wt-[^"]+)"/) || [])[1];

    // 到点询问本人（绝不催办他人）
    const ask = await waitOutbox(`waiting:${waitingId}:`, '到点询问', 30_000);
    expect(ask.content?.text ?? '').toContain('等李雷回预算数字');
    // 等待跟进绝不催办他人：对外发送日志里只有 P13 那条正式消息
    const sends = await stubSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].userId).toBe('ou_collab_1');

    // 同源重复事件不重复建立
    await writeScript(tasksScript('重复等待', { action: 'waiting_create', title: '等李雷回预算数字', dedupKey: 'wait:lilei:budget' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-wt-1', { text: '再记一下等李雷回预算' }));
    await waitWorkItem('重复等待', '重复等待完成');
    await waitToolResult('pa24_work', '不重复建立', '去重回执', 60_000, before);

    // 改时间：检查点调整且继续等待
    await writeScript(tasksScript('改等待时间', { action: 'waiting_control', waitingId, op: 'reschedule', inSeconds: 3600 }));
    before = llm.log.length;
    await inject(ownerEvent('evt-wt-3', { text: '一小时后还没收到再问我' }));
    await waitWorkItem('改等待时间', '改等待完成');
    const rescheduled = await waitToolResult('pa24_work', '检查点已调整', '改等待回执', 60_000, before);
    const nextCheckpoint = new Date((rescheduled.match(/"checkpointAt":"([^"]+)"/) || [])[1]);
    expect(nextCheckpoint.getTime()).toBeGreaterThan(Date.now() + 3000_000);

    // 标记收到 → 不再询问
    await writeScript(tasksScript('收到材料', { action: 'waiting_control', waitingId, op: 'received', note: '李雷已回数字' }));
    before = llm.log.length;
    await inject(ownerEvent('evt-wt-2', { text: '李雷的预算数字收到了' }));
    await waitWorkItem('收到材料', '收到完成');
    await waitToolResult('pa24_work', '后续检查点停止询问', '收到回执', 60_000, before);
    const asked = (await rows(`select ask_count, status from pa24.waiting_item where id='${waitingId}'`))[0];
    expect(asked.status).toBe('received');
    await new Promise(r => setTimeout(r, 3000));
    expect((await rows(`select ask_count from pa24.waiting_item where id='${waitingId}'`))[0].ask_count).toBe(asked.ask_count);
  });

  it('P19：跟随日程的提醒在日程取消后拦截并告知', async () => {
    await writeScript(tasksScript('建日程供跟随', { action: 'calendar_create', summary: '评审会', start: '2026-10-09T10:00:00+08:00', end: '2026-10-09T10:30:00+08:00' }, 'calendar'));
    let before = llm.log.length;
    await inject(ownerEvent('evt-ev-0', { text: '建一个日程：10 月 9 日 10 点评审会半小时' }));
    await waitWorkItem('建日程供跟随', '日程建立');
    const created = await waitToolResult('pa24_work', 'eventId', '日历回执', 60_000, before);
    const eventId = (created.match(/"eventId":"(evtstub-[^"]+)"/) || [])[1];

    await writeScript(tasksScript('设日程跟随提醒', { action: 'reminder_create', kind: 'once', afterSeconds: 60, text: '评审会即将开始', linkEventId: eventId }, 'reminders'));
    before = llm.log.length;
    await inject(ownerEvent('evt-ev-1', { text: '开会前一分钟提醒我评审会' }));
    await waitWorkItem('设日程跟随提醒', '日程提醒建立');
    await waitToolResult('pa24_work', 'ruleId', '日程提醒回执', 60_000, before);
    const linked = (await rows(`select id from pa24.reminder_rule where link_source_id='${eventId}'`))[0];
    expect(linked).toBeTruthy();

    // 日程取消 → 跟随提醒拦截并告知（未到期的实例取消）
    await writeScript(tasksScript('取消评审会', { action: 'calendar_cancel', eventId }, 'calendar'));
    before = llm.log.length;
    await inject(ownerEvent('evt-ev-2', { text: '评审会取消了' }));
    await waitWorkItem('取消评审会', '日程取消完成');
    await waitOutbox('remindsrc:', '日程取消告知', 30_000);
    expect((await rows(`select status from pa24.reminder_rule where id='${linked.id}'`))[0].status).toBe('stopped');
    expect((await rows(`select count(*)::int as n from pa24.reminder_occurrence where rule_id='${linked.id}' and status='sent'`))[0].n).toBe(0);
  });
});

