// F16 end-to-end: the wecom channel through the real Loader + stubbed
// wecom-cli — guide/diagnostics, calendar query/create/cancel, todo
// create/complete with staged idempotency (no platform key), honest failure,
// and reminder delivery through the wecom outbox exit without any Feishu
// transport.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, localSessionId, requestSerial = 0;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const prompt = text =>
  host.remote('session/prompt', {
    request: {
      requestId: `f16-${++requestSerial}`,
      sessionId: localSessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: 'Asia/Shanghai',
    },
  });
const waitWork = async (predicate, label, timeoutMs = 180_000) =>
  host.waitUntil(s => predicate(s.work ?? [], s), { timeoutMs, label });
const waitToolResult = async (substr, label, timeoutMs = 90_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const hit = [...llm.log].reverse().find(r => r.toolResults.join('').includes(substr));
    if (hit) return hit.toolResults.join('');
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；已有工具结果数：${llm.log.filter(r => r.toolResults.length > 0).length}`);
};
const writeStubState = async patch => writeFile(stubStatePath, JSON.stringify(patch, null, 2));
const wall = (date, timeZone = 'Asia/Shanghai') => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}:${map.second}`;
};
const readJournal = async (name, key) => {
  try {
    const lines = (await readFile(`${stubStatePath}.${name}.jsonl`, 'utf8')).split('\n').filter(Boolean);
    const latest = new Map();
    for (const line of lines) {
      const record = JSON.parse(line);
      latest.set(record[key], record);
    }
    return [...latest.values()];
  } catch {
    return [];
  }
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f16-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'wecom-stub-state.json');
  await writeStubState({ ownerUserid: 'wou_test_owner' });
  const stubSource = resolve(here, '../helpers/stub-wecom-cli.mjs');
  await writeFile(join(binDir, 'wecom-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'wecom-cli'), 0o755);
  // 预置一条企微日程（明晚窗口内），供 calendar_query 同步验证投影。
  const seededStart = new Date(Date.now() + 24 * 3600 * 1000);
  const seededEnd = new Date(seededStart.getTime() + 30 * 60 * 1000);
  await appendFile(`${stubStatePath}.schedules.jsonl`, JSON.stringify({
    schedule_id: 'schstub-seed',
    subject: '数字化集成例会（种子）',
    begin_time: wall(seededStart),
    end_time: wall(seededEnd),
    attendees: [{ userid: 'wou_test_owner', name: '测试主人' }],
  }) + '\n');
  // demo 模式：无飞书传输；三渠道全走企微，验证 wecom 出口可独立投递。
  await writeFile(
    join(workspace, 'AGENTS.md'),
    `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify({
      version: 1, mode: 'demo', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
      folderToken: '', tasklistId: '', calendarId: 'primary',
      calendarChannel: 'wecom', todoChannel: 'wecom', notifyChannel: 'wecom',
      timeZone: 'Asia/Shanghai',
      appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
      maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'calendar', 'reminders'], workerModels: {},
    }, null, 2)}\n\`\`\`\n`,
  );
  host = await bootHost({
    env: {
      PA24_WORKSPACE: workspace,
      PA24_PG_DSN: cluster.dsn,
      DEEPSEEK_BASE_URL: llm.url,
      DEEPSEEK_API_KEY: 'test-key',
      PA24_WECOM_STUB_STATE: stubStatePath,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });
  const snap = await host.waitUntil(
    s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace,
    { label: '插件就绪' },
  );
  localSessionId = snap.workspace.localSessionId;
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F16 企微日程待办渠道（真实 Loader + 隔离 PG + 桩 wecom-cli）', () => {
  it('wecom_guide/wecom_check：指南随包分发，检查通过并含 nextSteps', async () => {
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_connection', input: { action: 'wecom_guide' } }, leadReply: '已读取企微接入指南。' });
    await prompt('帮我看看企微渠道怎么接');
    const guide = await waitToolResult('wecom-setup.md', 'guide 返回');
    expect(guide).toContain('企业微信渠道接入指南');
    expect(guide).toContain('阶段 4');

    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_connection', input: { action: 'wecom_check' } }, leadReply: '已检查。' });
    await prompt('检查一下企微渠道状态');
    const check = await waitToolResult('checkedAt', 'check 返回');
    expect(check).toContain('测试主人');
    expect(check).toContain('企微渠道检查通过');
  });

  it('日程域：查询同步投影（channel=wecom）、创建、取消均有 staged 回执', async () => {
    const from = new Date(Date.now() - 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '查询企微日程', instruction: '查询本周企微日程' },
      leadReply: '已安排查询。',
      workerAction: { action: 'calendar_query', from, to },
      workerReply: '已查询。',
    });
    await prompt('查一下本周的企微日程');
    await waitWork(items => items.some(w => w.role === 'calendar' && w.status === 'completed'), '查询事项完成');
    await waitToolResult('共 1 个企微日程', '查询回执');
    expect((await cluster.query(`select channel, summary from pa24.calendar_event where event_id='schstub-seed'`))).toContain('wecom');

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '创建企微日程', instruction: '创建测试日程' },
      leadReply: '已安排创建。',
      workerAction: { action: 'calendar_create', summary: '渠道验收测试', start: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), end: new Date(Date.now() + 48 * 3600 * 1000 + 15 * 60 * 1000).toISOString() },
      workerReply: '日程已创建。',
    });
    await prompt('帮我建一条明后天的渠道验收测试日程，十五分钟');
    await waitWork(items => items.filter(w => w.role === 'calendar').length === 2 && items.every(w => w.status === 'completed'), '创建事项完成');
    const created = await waitToolResult('企微日程已创建', '创建回执');
    const eventId = /(schstub-\d+)/.exec(created)?.[1];
    expect(eventId).toBeTruthy();
    expect((await readJournal('schedules', 'schedule_id')).length).toBe(2);
    expect((await cluster.query(`select count(*) from pa24.action_operation where action='wecom_calendar.create' and status='succeeded'`)).trim()).toBe('1');

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '取消企微日程', instruction: '取消测试日程' },
      leadReply: '已安排取消。',
      workerAction: { action: 'calendar_cancel', eventId },
      workerReply: '日程已取消。',
    });
    await prompt('把刚才那条测试日程取消掉');
    await waitWork(items => items.filter(w => w.role === 'calendar').length === 3 && items.every(w => w.status === 'completed'), '取消事项完成');
    await waitToolResult('企微日程已取消', '取消回执');
    expect((await cluster.query(`select status from pa24.calendar_event where event_id='${eventId}'`))).toContain('canceled');
  });

  it('待办域：创建/幂等（无平台幂等键，靠操作账）/完成；失败如实上报不盲重试', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '创建企微待办', instruction: '创建企微待办' },
      leadReply: '已安排。',
      workerAction: { action: 'task_create', summary: '写渠道验收记录', due: '2026-10-09', _operationId: 'f16-todo-op-1' },
      workerReply: '待办已创建。',
    });
    await prompt('在企微建一条待办：写渠道验收记录');
    await waitWork(items => items.some(w => w.role === 'tasks' && w.status === 'completed'), '创建完成');
    await waitToolResult('企微待办已创建', '创建回执');
    expect((await readJournal('todos', 'todo_id'))).toHaveLength(1);
    expect((await cluster.query(`select channel from pa24.task`)).trim()).toBe('wecom');

    // 同一操作键二次提交：CLI 无幂等键，操作账是唯一防线——不重复建。
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '重复创建企微待办', instruction: '重复创建同一待办' },
      leadReply: '已安排。',
      workerAction: { action: 'task_create', summary: '写渠道验收记录', due: '2026-10-09', _operationId: 'f16-todo-op-1' },
      workerReply: '已处理。',
    });
    await prompt('再创建一次完全相同的待办');
    await waitWork(items => items.filter(w => w.role === 'tasks').length === 2 && items.every(w => w.status === 'completed'), '重复事项完成');
    await waitToolResult('未重复写入', '幂等复用回执');
    expect((await readJournal('todos', 'todo_id'))).toHaveLength(1);

    const guid = (await readJournal('todos', 'todo_id'))[0].todo_id;
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '完成企微待办', instruction: '完成验收记录待办' },
      leadReply: '已安排。',
      workerAction: { action: 'task_complete', taskId: guid },
      workerReply: '已完成。',
    });
    await prompt('渠道验收记录写完了，完成这条待办');
    await waitWork(items => items.filter(w => w.role === 'tasks').length === 3 && items.every(w => w.status === 'completed'), '完成事项结束');
    await waitToolResult('企微待办已完成', '完成回执');
    expect((await readJournal('todos', 'todo_id'))[0].status).toBe('done');
    expect((await cluster.query(`select status from pa24.task where task_guid='${guid}'`))).toContain('completed');

    // 注入平台失败：staged 落 failed、不写远端，错误原文上报。
    await writeStubState({ ownerUserid: 'wou_test_owner', failNext: { command: 'todo.create', error: 'injected' } });
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '失败的待办创建', instruction: '创建会失败的待办' },
      leadReply: '已安排。',
      workerAction: { action: 'task_create', summary: '这条会失败', _operationId: 'f16-todo-op-fail' },
      workerReply: '已处理。',
    });
    await prompt('再建一条：这条会失败');
    await waitToolResult('40073', '失败如实上报');
    expect((await readJournal('todos', 'todo_id'))).toHaveLength(1);
    expect((await cluster.query(`select status from pa24.action_operation where id like 'wecom_todo.create:%f16-todo-op-fail%' or id='f16-todo-op-fail'`)).trim()).toBe('failed');
    await writeStubState({ ownerUserid: 'wou_test_owner' });
  });

  it('提醒经企微出口送达（无飞书传输也可投递）；授权过期给出续期 nextSteps', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '设置企微提醒', instruction: '设置测试提醒' },
      leadReply: '已安排。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 3, text: '企微渠道推送验收' },
      workerReply: '提醒已创建。',
    });
    await prompt('三秒后用企微提醒我：企微渠道推送验收');
    await waitWork(items => items.some(w => w.role === 'reminders' && w.status === 'completed'), '提醒事项完成');
    // host.waitUntil 不同步等待异步谓词，这里显式轮询 PG 投递状态。
    for (let i = 0; i < 90; i++) {
      const status = (await cluster.query(`select status from pa24.outbox where channel='wecom' and dedup_key like 'reminder:%'`)).trim();
      if (status === 'sent') break;
      if (i === 89) throw new Error(`企微提醒送达超时；最后状态：${status || '无行'}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    const sends = await readJournal('wsends', 'messageId');
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe('wou_test_owner');
    expect(sends[0].markdown).toContain('企微渠道推送验收');

    // 服务级授权过期（850003）：nextSteps 透传平台的续期指引原文。
    await writeStubState({ ownerUserid: 'wou_test_owner', failNext: { command: 'todo.list', error: 'injected' } });
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_connection', input: { action: 'wecom_check' } }, leadReply: '已检查。' });
    await prompt('再检查一次企微渠道');
    const check = await waitToolResult('「待办」使用权限已过期', '过期诊断');
    expect(check).toContain('850003');
    expect(check).toContain('[点击这里]');
    await writeStubState({ ownerUserid: 'wou_test_owner' });
  });
});
