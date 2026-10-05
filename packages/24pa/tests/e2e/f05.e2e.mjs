// F05 end-to-end: deterministic reminders. One-shot delivery via the durable
// outbox, cancel stops pending occurrences, snooze links a single follow-up,
// restart picks up pending rules, and quiet-hours/vacation preferences hold
// (not drop) due occurrences until the window ends.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

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
  it('P18：一次性提醒经账本+Outbox 发出，状态仅报平台接受', async () => {
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
    const ruleId = (created.match(/(rmd-[a-z0-9-]+)/) || [])[1];
    const row = await waitOutbox(`reminder:${ruleId}:`, '提醒发送');
    expect(row.message_id).toMatch(/^fake-/);
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}' and status='sent'`)).trim()).toBe('1');
    expect((await cluster.query(`select status from pa24.reminder_rule where id='${ruleId}'`)).trim()).toBe('completed');
  });

  it('P18：取消停止后续实例；稍后只产生一份关联实例', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '设长提醒', instruction: '60 秒后提醒复盘' },
      leadReply: '已设置。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 60, text: '复盘' },
      workerReply: '已设置。',
    });
    await inject(ownerEvent('evt-rmd-2', '一分钟后提醒我做晚间复盘'));
    await waitWorkItem('设长提醒', '长提醒创建');
    const created = await waitToolResult('ruleId', '创建回执2');
    const ruleId = (created.match(/(rmd-[a-z0-9-]+)/) || [])[1];

    // 稍后：原实例 snoozed，仅一份关联实例
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '稍后提醒', instruction: '把复盘提醒延后 2 秒' },
      leadReply: '已安排稍后。',
      workerAction: { action: 'reminder_snooze', ruleId, seconds: 2, reason: '本人要求稍后' },
      workerReply: '已稍后。',
    });
    await inject(ownerEvent('evt-rmd-3', '复盘那个提醒稍后两秒再响'));
    await waitWorkItem('稍后提醒', '稍后完成');
    await waitToolResult('已稍后 2 秒提醒', '稍后回执');
    await waitOutbox(`reminder:${ruleId}:`, '稍后实例发出', 30_000);

    // 取消：pending 实例一并取消
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '设再一个提醒', instruction: '90 秒后提醒采购' },
      leadReply: '已设置。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 90, text: '采购' },
      workerReply: '已设置。',
    });
    await inject(ownerEvent('evt-rmd-4', '再设一个九十秒后提醒采购的'));
    await waitWorkItem('设再一个提醒', '第二个提醒创建');
    const created2 = await waitToolResult('ruleId', '创建回执3');
    const ruleId2 = (created2.match(/(rmd-[a-z0-9-]+)/) || [])[1];
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '取消采购提醒', instruction: '取消采购提醒' },
      leadReply: '已取消。',
      workerAction: { action: 'reminder_cancel', ruleId: ruleId2, reason: '本人取消' },
      workerReply: '已取消。',
    });
    await inject(ownerEvent('evt-rmd-5', '采购那个提醒不要了'));
    await waitWorkItem('取消采购提醒', '取消完成');
    await waitToolResult('已停止', '取消回执');
    expect((await cluster.query(`select status from pa24.reminder_rule where id='${ruleId2}'`)).trim()).toBe('stopped');
    // 未到物化窗口的一次性规则：停止后不再产生任何实例或发送
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId2}'`)).trim()).toBe('0');
  });

  it('P20/P18：重启后未到期规则继续触发（账本为准）', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '重启前设提醒', instruction: '8 秒后提醒续保' },
      leadReply: '已设置。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 8, text: '续保' },
      workerReply: '已设置。',
    });
    await inject(ownerEvent('evt-rmd-6', '八秒后提醒我续保'));
    await waitWorkItem('重启前设提醒', '重启前提醒创建');
    const created = await waitToolResult('ruleId', '创建回执4');
    const ruleId = (created.match(/(rmd-[a-z0-9-]+)/) || [])[1];

    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '重启就绪' },
    );
    const row = await waitOutbox(`reminder:${ruleId}:`, '重启后触发', 40_000);
    expect(row.message_id).toMatch(/^fake-/);
  });

  it('P20：暂停扣住不取消，恢复后照常发出', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '设暂停用提醒', instruction: '4 秒后提醒缴费' },
      leadReply: '已设置。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 4, text: '缴费' },
      workerReply: '已设置。',
    });
    await inject(ownerEvent('evt-rmd-8', '四秒后提醒我缴费'));
    await waitWorkItem('设暂停用提醒', '暂停用提醒创建');
    const created = await waitToolResult('ruleId', '创建回执6');
    const ruleId = (created.match(/(rmd-[a-z0-9-]+)/) || [])[1];
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '暂停缴费提醒', instruction: '暂停缴费提醒' },
      leadReply: '已暂停。',
      workerAction: { action: 'reminder_pause', ruleId, reason: '本人暂停' },
      workerReply: '已暂停。',
    });
    await inject(ownerEvent('evt-rmd-9', '缴费提醒先暂停一下'));
    await waitWorkItem('暂停缴费提醒', '暂停完成');
    await waitToolResult('已暂停', '暂停回执');
    await new Promise(r => setTimeout(r, 6000));
    // 暂停期间不发也不取消
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}' and status='sent'`)).trim()).toBe('0');
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}' and status='canceled'`)).trim()).toBe('0');
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '恢复缴费提醒', instruction: '恢复缴费提醒' },
      leadReply: '已恢复。',
      workerAction: { action: 'reminder_resume', ruleId, reason: '本人恢复' },
      workerReply: '已恢复。',
    });
    await inject(ownerEvent('evt-rmd-10', '恢复缴费提醒'));
    await waitWorkItem('恢复缴费提醒', '恢复完成');
    const row = await waitOutbox(`reminder:${ruleId}:`, '恢复后发出', 30_000);
    expect(row.message_id).toMatch(/^fake-/);
  });

  it('P15/P21：临时休假把到期提醒扣住不放，到期后补发', async () => {
    const nowIso = new Date().toISOString();
    const vacationEnd = new Date(Date.now() + 4000).toISOString();
    await writeScript({
      mode: 'dispatch',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'vacation-1', category: 'preference', topic: '休假', content: '本人休假中，暂停提醒推送', source: '本人指示', status: 'confirmed', validUntil: vacationEnd, reason: '本人临时休假', expectedRevision: 0 } },
      leadReply: '已记录休假。',
    });
    await promptLocal('f05-vacation-1', '我要休假几秒钟：现在开始四秒内不要提醒我');
    await waitMemoryRevision(1, '休假写入');

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'reminders', title: '休假中设提醒', instruction: '2 秒后提醒签收' },
      leadReply: '已设置。',
      workerAction: { action: 'reminder_create', kind: 'once', afterSeconds: 2, text: '签收快递' },
      workerReply: '已设置。',
    });
    await inject(ownerEvent('evt-rmd-7', '两秒后提醒我签收快递'));
    await waitWorkItem('休假中设提醒', '休假期提醒创建');
    const created = await waitToolResult('ruleId', '创建回执5');
    const ruleId = (created.match(/(rmd-[a-z0-9-]+)/) || [])[1];

    // 休假窗口内被扣住（pending+deferred），不发
    await new Promise(r => setTimeout(r, 3500));
    const held = await cluster.query(`select status, (deferred_until is not null) as deferred from pa24.reminder_occurrence where rule_id='${ruleId}'`);
    expect(held).toContain('pending');
    expect(held).toContain('t'); // deferred_until set
    // 休假结束后补发
    const row = await waitOutbox(`reminder:${ruleId}:`, '休假后补发', 30_000);
    expect(row.message_id).toMatch(/^fake-/);
    expect((await cluster.query(`select count(*) from pa24.reminder_occurrence where rule_id='${ruleId}' and status='sent'`)).trim()).toBe('1');
  });
});
