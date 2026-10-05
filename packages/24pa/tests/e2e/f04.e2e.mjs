// F04 end-to-end: calendar query with freshness/conflicts, personal event
// create/reschedule/cancel with staged receipts, and explicit-invitation
// meetings with contact resolution and ambiguity refusal.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, localSessionId;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text, extra = {}) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text, ...extra });
const readEvents = async () => {
  try {
    const lines = (await readFile(`${stubStatePath}.events.jsonl`, 'utf8')).split('\n').filter(Boolean);
    const latest = new Map();
    for (const line of lines) {
      const record = JSON.parse(line);
      latest.set(record.event_id, record);
    }
    return [...latest.values()];
  } catch {
    return [];
  }
};
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

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f04-'));
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
      maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'calendar'], workerModels: {},
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

describe('F04 日程与会议安排（真实 Loader + 隔离 PG + 桩日历）', () => {
  it('P11：创建、改期、取消本人日程，均有 staged 回执且投影一致', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '安排写方案', instruction: '明天 10:00–11:00 写方案' },
      leadReply: '已安排日程。',
      workerAction: { action: 'calendar_create', summary: '写方案', start: '2026-10-07T10:00:00+08:00', end: '2026-10-07T11:00:00+08:00' },
      workerReply: '日程已创建。',
    });
    await inject(ownerEvent('evt-cal-1', '明天上午十点到十一点安排我写方案'));
    await waitWorkItem('安排写方案', '日程创建完成');
    const created = (await readEvents()).find(e => e.summary.includes('写方案'));
    expect(created).toBeTruthy();
    expect((await cluster.query(`select count(*) from pa24.action_operation where action='calendar.create' and status='succeeded'`)).trim()).toBe('1');

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '改期写方案', instruction: '写方案改到 14:00' },
      leadReply: '已安排改期。',
      workerAction: { action: 'calendar_update', eventId: created.event_id, start: '2026-10-07T14:00:00+08:00', end: '2026-10-07T15:00:00+08:00' },
      workerReply: '已改期。',
    });
    await inject(ownerEvent('evt-cal-2', '写方案那件事改到下午两点'));
    await waitWorkItem('改期写方案', '改期完成');
    await waitToolResult('日程已修改', '改期回执');
    expect(Date.parse((await readEvents()).find(e => e.event_id === created.event_id).start)).toBe(Date.parse('2026-10-07T14:00:00+08:00'));

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '取消写方案', instruction: '取消写方案日程' },
      leadReply: '已安排取消。',
      workerAction: { action: 'calendar_cancel', eventId: created.event_id },
      workerReply: '已取消。',
    });
    await inject(ownerEvent('evt-cal-3', '取消写方案的日程'));
    await waitWorkItem('取消写方案', '取消完成');
    await waitToolResult('日程已取消', '取消回执');
    expect((await readEvents()).find(e => e.event_id === created.event_id).status).toBe('canceled');
    expect((await cluster.query(`select count(*) from pa24.calendar_event where event_id='${created.event_id}' and status='canceled'`)).trim()).toBe('1');
  });

  it('P10：查询返回日程、冲突与新鲜度；取消后不再计入', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: [
        { worker: 'calendar', title: '安排评审A', instruction: '10:00–11:00 评审A' },
        { worker: 'calendar', title: '安排评审B', instruction: '10:30–11:30 评审B（与 A 冲突）' },
      ],
      leadReply: '已安排两个日程。',
      workerAction: { action: 'calendar_create', summary: '评审', start: '2026-10-08T10:00:00+08:00', end: '2026-10-08T11:00:00+08:00' },
      workerReply: '已创建。',
    });
    await inject(ownerEvent('evt-cal-4', '后天上午安排两个评审：评审A 十点到十一点，评审B 十点半到十一点半'));
    await waitWorkItem('安排评审A', '评审A完成');
    await waitWorkItem('安排评审B', '评审B完成');

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '查询后天日程', instruction: '查询后天安排' },
      leadReply: '已安排查询。',
      workerAction: { action: 'calendar_query', from: '2026-10-08T00:00:00+08:00', to: '2026-10-09T00:00:00+08:00' },
      workerReply: '已查询。',
    });
    await inject(ownerEvent('evt-cal-5', '查一下后天的安排'));
    await waitWorkItem('查询后天日程', '查询完成');
    const payload = await waitToolResult('冲突', '查询回执');
    expect(payload).toContain('评审');
    expect(payload).toContain('fresh');
    expect(payload).toContain('冲突 1 处');
    // 已取消的写方案不在结果里
    expect((await cluster.query(`select count(*) from pa24.calendar_event where status='active'`)).trim()).toBe('2');
  });

  it('P12：明确指令的会议邀请按记忆解析联系人；歧义拒绝且不发邀请', async () => {
    // 先写入联系人记忆（本地维护会话）
    await writeScript({
      mode: 'dispatch',
      leadReply: '已记住联系人。',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'contact-xw', category: 'fact', topic: '联系人：小王', content: '联系人 小王：ou_xiaowang_1（产品组）', source: '本人提供', status: 'confirmed', reason: '本人提供的联系人', expectedRevision: 0 } },
    });
    await promptLocal('f04-contact-1', '记住联系人：小王，open_id 是 ou_xiaowang_1');
    for (let i = 0; i < 40 && (await host.api('memory', { query: '小王' })).revision < 1; i++) await new Promise(r => setTimeout(r, 500));

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '约小王过方案', instruction: '明天 15:00–15:30 和小王过方案（本人明确邀请）' },
      leadReply: '已安排会议。',
      workerAction: { action: 'meeting_schedule', title: '和小王过方案', start: '2026-10-07T15:00:00+08:00', end: '2026-10-07T15:30:00+08:00', instruction: '本人明确要求邀请小王', attendees: [{ name: '小王' }] },
      workerReply: '会议已安排。',
    });
    await inject(ownerEvent('evt-meet-1', '明天下午三点和小王开半小时会议过方案，就邀请他'));
    await waitWorkItem('约小王过方案', '会议完成');
    const payload = await waitToolResult('已按本人明确指令创建会议并邀请 1 位参会人', '邀请回执');
    expect(payload).toContain('ou_xiaowang_1');
    const meeting = (await readEvents()).find(e => e.summary.includes('过方案'));
    expect(meeting.attendees.map(a => a.open_id)).toEqual(['ou_xiaowang_1']);

    // 歧义联系人：记忆里有两个“小李” → 拒绝且不创建任何会议
    await writeScript({
      mode: 'dispatch',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'contact-xl1', category: 'fact', topic: '联系人：小李', content: '联系人 小李：ou_xiaoli_1（销售）', source: '本人提供', status: 'confirmed', reason: '本人提供的联系人', expectedRevision: 1 } },
      leadReply: '已记住。',
    });
    await promptLocal('f04-contact-2', '记一个联系人小李：ou_xiaoli_1');
    for (let i = 0; i < 40 && (await host.api('memory', {})).revision < 2; i++) await new Promise(r => setTimeout(r, 500));
    await writeScript({
      mode: 'dispatch',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'contact-xl2', category: 'fact', topic: '联系人：小李', content: '联系人 小李：ou_xiaoli_2（市场）', source: '本人提供', status: 'confirmed', reason: '本人提供的同名联系人', expectedRevision: 2 } },
      leadReply: '已记住。',
    });
    await promptLocal('f04-contact-3', '再记一个也叫小李的：ou_xiaoli_2');
    for (let i = 0; i < 40 && (await host.api('memory', {})).revision < 3; i++) await new Promise(r => setTimeout(r, 500));
    const ambiguous = await host.api('memory', { query: '小李' });
    expect(ambiguous.matched).toBe(2);
    const before = (await readEvents()).length;
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'calendar', title: '约小李（歧义）', instruction: '和小李开会（本人明确邀请）' },
      leadReply: '已安排。',
      workerAction: { action: 'meeting_schedule', title: '和小李对齐', start: '2026-10-07T16:00:00+08:00', end: '2026-10-07T16:30:00+08:00', instruction: '本人明确要求邀请小李', attendees: [{ name: '小李' }] },
      workerReply: '已安排。',
    });
    await inject(ownerEvent('evt-meet-2', '再约一个和小李的会'));
    await waitWorkItem('约小李（歧义）', '歧义事项完成');
    await waitToolResult('未发出任何邀请', '歧义拒绝');
    expect((await readEvents()).length).toBe(before);
  });
});
