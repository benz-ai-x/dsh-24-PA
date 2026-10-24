// F05/F45: native calendar ownership, cancellation, restart and explicit
// retirement of legacy timing. Intelligent quiet-hours coverage is in F08.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';
import { waitWorkerToolError } from '../helpers/worker-run.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, hostRoot, localSessionId;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text });
const waitWorkItem = async (title, label, timeoutMs = 180_000) =>
  host.waitUntil(s => (s.work ?? []).some(w => w.title === title && w.status === 'completed'), { timeoutMs, label });
const waitToolResult = async (substr, label, timeoutMs = 60_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
    if (last && last.toolResults.join('').includes(substr)) return last.toolResults.join('');
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? last.toolResults.join('').slice(0, 400) : '无'}`);
};
const promptLocal = (requestId, text) =>
  host.remote('session/prompt', {
    request: { requestId, sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' },
  });
const unescapeJsonish = text => text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

const readEvents = async () => {
  const lines = (await readFile(`${stubStatePath}.events.jsonl`, 'utf8')).split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l));
};

const waitOutbox = async (prefix, label, timeoutMs = 30_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const snap = await host.api('snapshot');
    const row = (snap.outbox ?? []).find(o => o.dedup_key.startsWith(prefix) && o.status === 'sent');
    if (row) return row;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待提醒发送（${label}）超时`);
};
const waitMemoryRevision = async (expected, label) => {
  for (let i = 0; i < 60; i++) {
    const memory = await host.api('memory', {});
    if (memory.revision === expected) return memory;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待记忆 revision=${expected} 超时（${label}）`);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f05-'));
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
  await writeFile(
    join(workspace, 'AGENTS.md'),
    `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify({
      version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
      folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
      appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
      maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'calendar', 'reminders'], workerModels: {},
    }, null, 2)}\n\`\`\`\n`,
  );
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

describe('F05 个人提醒与免打扰（真实 Loader + 隔离 PG）', () => {
  it('F45：一次性时钟提醒写入日历渠道（App 原生提醒），账本只留 delegated 备份', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '两秒后提醒喝水', instruction: '两秒后提醒喝水' },
      leadReply: '已设置提醒。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 2, text: '喝水' },
      workerReply: '提醒已设置。',
    });
    await inject(ownerEvent('evt-rmd-1', '两秒后提醒我喝水'));
    await waitWorkItem('两秒后提醒喝水', '提醒创建完成');
    const created = await waitToolResult('ruleId', '创建回执');
    const ruleId = (created.match(/(rmd-cal-[a-z0-9-]+)/) || [])[1];
    expect(ruleId, '备份行 ruleId 应为 rmd-cal-*').toBeTruthy();
    expect(unescapeJsonish(created)).toContain('"calendarChannel":"feishu"');
    expect(unescapeJsonish(created)).toContain('App 原生提醒');
    expect(unescapeJsonish(created)).toContain('"platformAccepted":true');
    expect(unescapeJsonish(created)).toContain('"state":"verified"');
    const eventId = (unescapeJsonish(created).match(/"eventId":"(evtstub-[^"]+)"/) || [])[1];
    expect(eventId, '应返回日历事件 id').toBeTruthy();
    // 备份行：delegated＝引擎不投递
    expect((await cluster.query(`select status from pa24.reminder_rule where id='${ruleId}'`)).trim()).toBe('delegated');
    // 无账本实例、无 outbox 提醒行（原生提醒不经 24PA）
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}'`)).trim()).toBe('0');
    // 日历桩收到事件（默认提前 5 分钟由真实渠道保证；桩记录无 rrule）
    const event = (await readEvents()).find(e => e.event_id === eventId);
    expect(event?.summary).toContain('提醒：喝水');
    expect(event?.rrule ?? null).toBeNull();
  });

  it('P18/F45：稍后交给 App，取消整条日历规则且不生成 ledger 实例', async () => {
    const run = async (title, action, error) => {
      await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title, instruction: title }, workerAction: action, workerReply: '按工具实际结果汇报。' });
      await inject(ownerEvent(title, title));
      if (error) await waitWorkerToolError(host, title, error);
      else await waitWorkItem(title, title);
    };
    await run('创建待改期提醒', { action: 'reminder_create', kind: 'once', afterSeconds: 600, text: '复盘' });
    const created = unescapeJsonish(await waitToolResult('ruleId', '创建'));
    const ruleId = created.match(/"ruleId":"([^"]+)"/)[1];
    const beforeSnooze = await readEvents();
    await run('要求稍后提醒', { action: 'reminder_snooze', ruleId, seconds: 60, reason: '本人要求稍后' }, 'App 原生提醒');
    expect(await readEvents()).toEqual(beforeSnooze);
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}'`)).trim()).toBe('0');
    await run('取消待改期提醒', { action: 'reminder_cancel', ruleId, reason: '本人取消整条规则' });
    await waitToolResult('已停止', '取消');
    expect((await cluster.query(`select status from pa24.reminder_rule where id='${ruleId}'`)).trim()).toBe('stopped');
  });

  it('P20/F45：重启保留原生事件和备份，不重建日历或启动 ledger 发送', async () => {
    await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title: '重启前设提醒', instruction: '一分钟后提醒续保' }, workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 60, text: '续保' }, workerReply: '已记录。' });
    await inject(ownerEvent('restart-reminder', '一分钟后提醒续保')); await waitWorkItem('重启前设提醒', '创建');
    const created = unescapeJsonish(await waitToolResult('ruleId', '创建')), ruleId = created.match(/"ruleId":"([^"]+)"/)[1];
    const before = (await readEvents()).length;
    await host.stop({ keepRoot: true }); host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(s => !!s.workspace && s.transport?.connected === true, { label: '重启就绪' });
    expect((await readEvents()).length).toBe(before);
    expect((await cluster.query(`select status from pa24.reminder_rule where id='${ruleId}'`)).trim()).toBe('delegated');
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}'`)).trim()).toBe('0');
  });

  it('P20/F45：旧 every 新入口明确拒绝，不能静默回退计时', async () => {
    await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title: '要求旧间隔规则', instruction: '每分钟提醒缴费' }, workerAction: { action: 'reminder_create', kind: 'every', everySeconds: 60, text: '缴费' }, workerReply: '按实际拒因汇报。' });
    await inject(ownerEvent('legacy-every', '每分钟提醒缴费'));
    await waitWorkerToolError(host, '要求旧间隔规则', '已退役');
    expect((await cluster.query("select count(*) from pa24.reminder_rule where text='缴费'")).trim()).toBe('0');
  });

  it('P15/P21/F45：本人休假偏好可记录；时钟免打扰归 App，不重新启动旧发送器', async () => {
    const vacationEnd = new Date(Date.now() + 3600000).toISOString();
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'vacation-1', category: 'preference', topic: '休假', content: '本人休假中，暂停智能跟进', source: '本人指示', status: 'confirmed', confirmation: '本人明确要求记住此条内容', validUntil: vacationEnd, reason: '本人临时休假', expectedRevision: 0 } }, leadReply: '已记录休假。' });
    await promptLocal('f05-vacation-1', '休假一小时，暂停智能跟进'); await waitMemoryRevision(1, '休假写入');
    await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title: '休假中的日历安排', instruction: '一分钟后提醒签收' }, workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 60, text: '签收快递' }, workerReply: '由日历 App 提醒。' });
    await inject(ownerEvent('vacation-calendar', '一分钟后提醒签收')); await waitWorkItem('休假中的日历安排', '安排');
    await waitToolResult('App 原生', '归属');
    expect((await cluster.query('select count(*) from pa24.reminder_occurrence')).trim()).toBe('0');
  });
});


describe('F45 补充：delegated 取消与周期 rrule', () => {
  it('取消时钟型提醒＝同步删除日历事件＋备份行置 stopped', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '设日历提醒后取消', instruction: 'x' },
      leadReply: 'ok', workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 120, text: '临时事项' }, workerReply: 'ok',
    });
    await inject(ownerEvent('evt-f45c1', '两分钟后提醒我临时事项'));
    await waitWorkItem('设日历提醒后取消', '创建完成');
    const created = await waitToolResult('ruleId', '创建回执');
    const ruleId = (created.match(/(rmd-cal-[a-z0-9-]+)/) || [])[1];
    const eventId = (unescapeJsonish(created).match(/"eventId":"(evtstub-[^"]+)"/) || [])[1];
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '取消刚才的提醒', instruction: 'x' },
      leadReply: 'ok', workerAction: { action: 'reminder_cancel', ruleId, reason: '本人取消' }, workerReply: 'ok',
    });
    await inject(ownerEvent('evt-f45c2', '刚才那个提醒取消掉'));
    await waitWorkItem('取消刚才的提醒', '取消完成');
    expect((await cluster.query(`select status from pa24.reminder_rule where id='${ruleId}'`)).trim()).toBe('stopped');
    const canceled = (await readEvents()).filter(e => e.event_id === eventId).at(-1);
    expect(canceled?.status).toBe('canceled');
  });

  it('daily 时钟提醒＝rrule 重复日程（FREQ=DAILY）', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '每天八点提醒打卡', instruction: 'x' },
      leadReply: 'ok', workerAction: { action: 'reminder_create', kind: 'daily', time: '08:00:00', text: '打卡' }, workerReply: 'ok',
    });
    await inject(ownerEvent('evt-f45d', '每天早上八点提醒我打卡'));
    await waitWorkItem('每天八点提醒打卡', '创建完成');
    const created = await waitToolResult('ruleId', '创建回执');
    const eventId = (unescapeJsonish(created).match(/"eventId":"(evtstub-[^"]+)"/) || [])[1];
    const event = (await readEvents()).filter(e => e.event_id === eventId).at(-1);
    expect(event?.rrule).toBe('FREQ=DAILY;INTERVAL=1');
  });
});
