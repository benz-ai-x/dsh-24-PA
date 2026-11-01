// Isolated real-dsh home review. All platform and model processes are local stubs.
import { appendFile, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../packages/24pa/tests/helpers/host.mjs';
import { startMockLlm } from '../packages/24pa/tests/helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../packages/24pa/lib/config.js';
import { localDay } from '../packages/24pa/lib/calendar-time.js';

process.env.PA24_E2E_STORAGE = 'sqlite';
const zone = 'Asia/Shanghai', root = await mkdtemp(join(tmpdir(), 'pa24-home-ui-')), workspace = join(root, 'workspace'), bin = join(root, 'bin');
await mkdir(workspace); await mkdir(bin);
const larkState = join(root, 'lark.json'), wecomState = join(root, 'wecom.json'), scriptPath = join(root, 'script.json');
await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_home_review', appId: 'cli_home_review' }));
await writeFile(wecomState, JSON.stringify({ ownerUserid: 'wou_home_review' }));
for (const name of ['lark', 'wecom']) {
  await writeFile(join(bin, name + '-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('packages/24pa/tests/helpers/stub-' + name + '-cli.mjs')) + ');\n');
  await chmod(join(bin, name + '-cli'), 0o755);
}
const registration = (id, domain, platform, resourceKind, resourceId, filter = 'all') => ({ id, domain, platform, resourceKind, resourceId, filter,
  name: ({ personal: '个人日历', project: '研发项目日历', wecom: '企微团队日历', 'personal-todo': '个人待办', 'project-todo': '研发项目待办', 'wecom-todo': '企微协作待办' })[id],
  purpose: id.startsWith('personal') ? 'personal' : 'project', ownerId: platform === 'feishu' ? 'ou_home_review' : 'wou_home_review', access: 'readwrite', enabled: true });
const sources = { version: 1, entries: [
  registration('personal', 'calendar', 'feishu', 'calendar', 'personal-cal'),
  registration('project', 'calendar', 'feishu', 'calendar', 'project-cal', 'involved'),
  registration('wecom', 'calendar', 'wecom', 'authorized_scope', 'authorized'),
  registration('personal-todo', 'todo', 'feishu', 'tasklist', 'personal-list'),
  registration('project-todo', 'todo', 'feishu', 'tasklist', 'project-list', 'responsible'),
  registration('wecom-todo', 'todo', 'wecom', 'authorized_scope', 'authorized'),
], defaults: { calendar: 'personal', todo: 'personal-todo' }, mappings: [], meetingDurationMinutes: 30 };
await writeFile(join(workspace, 'AGENTS.md'), '# 首页界面评审隔离工作区\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu', ownerOpenId: 'ou_home_review', timeZone: zone,
  folderToken: 'home-review-folder', tasklistId: 'personal-list', calendarId: 'personal-cal', enabledWorkers: ['memo', 'tasks', 'calendar', 'reminders', 'digest'], sources }, null, 2) + '\n```\n');

const now = Date.now(), day = localDay(new Date(now), zone), previous = localDay(new Date(now - 86400000), zone), next = localDay(new Date(now + 86400000), zone);
const events = [
  { event_id: 'home-review-current', calendar_id: 'personal-cal', summary: '产品设计评审', start: new Date(now - 15 * 60000).toISOString(), end: new Date(now + 45 * 60000).toISOString(), url: 'https://calendar.example/design-review', status: 'active' },
  { event_id: 'home-review-project', calendar_id: 'project-cal', summary: '研发项目同步', start: new Date(now + 2 * 3600000).toISOString(), end: new Date(now + 3 * 3600000).toISOString(), organizer: 'ou_colleague', attendees: [{ user_id: 'ou_home_review' }], url: 'https://calendar.example/project-sync', status: 'active' },
  { event_id: 'home-review-conflict', calendar_id: 'personal-cal', summary: '跨部门资源协调', start: new Date(now + 2 * 3600000).toISOString(), end: new Date(now + 3 * 3600000).toISOString(), url: 'https://calendar.example/resource-review', status: 'active' },
  { event_id: 'home-review-later', calendar_id: 'personal-cal', summary: '整理下周工作计划', start: new Date(now + 5 * 3600000).toISOString(), end: new Date(now + 6 * 3600000).toISOString(), status: 'active' },
];
for (const event of events) await appendFile(larkState + '.events.jsonl', JSON.stringify(event) + '\n');
const wall = value => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};
await appendFile(wecomState + '.schedules.jsonl', JSON.stringify({ schedule_id: 'home-review-wecom', subject: '企微客户沟通', begin_time: wall(now + 4 * 3600000), end_time: wall(now + 4.5 * 3600000), attendees: [{ userid: 'wou_home_review' }], timezone: { timezone_id: zone } }) + '\n');
const todos = [
  { guid: 'home-review-overdue', summary: '提交年度预算', tasklistId: 'personal-list', due: previous.date, status: 'open', url: 'https://todo.example/budget' },
  { guid: 'home-review-today', summary: '回复合同修订意见', tasklistId: 'project-list', due: new Date(now + 3 * 3600000).toISOString(), status: 'open', url: 'https://todo.example/contract' },
  { guid: 'home-review-prepare', summary: '准备客户汇报材料', tasklistId: 'personal-list', due: day.date, status: 'open' },
  { guid: 'home-review-upcoming', summary: '确认下周差旅安排', tasklistId: 'personal-list', due: next.date, status: 'open' },
  { guid: 'home-review-undated', summary: '整理阅读清单', tasklistId: 'personal-list', due: null, status: 'open' },
];
for (const task of todos) await appendFile(larkState + '.tasks.jsonl', JSON.stringify(task) + '\n');
await appendFile(wecomState + '.todos.jsonl', JSON.stringify({ todo_id: 'home-review-wecom-todo', title: '企微合同资料核对', status: 'proceed', user_status: 'accept', creator: { userid: 'colleague' }, followers: [{ userid: 'wou_home_review', user_status: 'accept' }], deadline: { type: 'date', value: day.date } }) + '\n');

const script = async (title, waiting = false) => writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'memo', title, instruction: '仅为首页评审形成隔离工作记录，不读取或写入真实账号。', completionCriteria: '形成可核对的隔离结果', acceptanceRequired: true },
  workerTool: { name: 'pa24_run', input: waiting ? { action: 'wait', kind: 'input', reason: '等待主人补充出行日期，沿原交办继续。' } : { action: 'progress', stage: '报告已生成', completed: '已核对隔离输入并生成报告', next: '等待主人验收' } }, workerReply: '隔离报告已生成，依据与结果均可回查。' }));
await script('首页评审：等待补充行程', true);
const llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json'), recordInputs: true });
const host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_home_review', PA24_FEISHU_APP_SECRET: 'home-review-not-a-secret',
  PA24_LARK_STUB_STATE: larkState, PA24_WECOM_STUB_STATE: wecomState, PATH: `${bin}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'home-review-key', DEEPSEEK_BASE_URL: llm.url } });
const ready = await host.waitUntil(row => Boolean(row.workspaceBinding && row.workspace?.localSessionId && row.transport?.connected), { label: '首页评审工作区' });
await host.api('action', { type: 'calendar.verify', workspaceBinding: ready.workspaceBinding, limit: 50 });
await host.api('action', { type: 'todos.verify', workspaceBinding: ready.workspaceBinding, limit: 50 });
const createWork = async (title, waiting) => {
  await script(title, waiting);
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: ready.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: title + '，仅执行隔离首页评审。' }] } });
  await host.waitUntil(row => row.work.some(work => work.title === title && work.status === (waiting ? 'waiting_input' : 'completed')), { label: title, timeoutMs: 60000 });
};
await createWork('首页评审：资料报告待验收', false);
await createWork('首页评审：等待补充行程', true);
if (process.argv.includes('--work-methodology')) {
  const invoke = async (title, input) => {
    await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'calendar', title,
      instruction: '确认近期重点是客户汇报；确认采纳安排。', completionCriteria: '取得保存回执' },
      workerAction: input, workerReply: '工作方法记录已保存。' }));
    await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: ready.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: input.instruction ?? title }] } });
    await host.waitUntil(row => row.work.some(work => work.title === title && work.status === 'completed'), { label: title });
  };
  await invoke('确认近期成果', { action: 'focus_update', expectedRevision: 0, focuses: [{ id: 'client', title: '客户汇报', outcome: '完成可供客户评审的汇报初稿' }], instruction: '确认近期重点是客户汇报' });
  const items = [{ id: 'draft', title: '客户汇报初稿', outcome: '完成三页有证据的核心方案', reason: '推进已确认的客户成果，提前暴露关键缺口', nextAction: '先整理客户提出的三个关键问题', focusId: 'client', estimateMinutes: 60 }];
  await invoke('提出今日安排', { action: 'daily_plan_save', focusRevision: 1, date: day.date, expectedRevision: 0, items });
  await invoke('采纳今日安排', { action: 'daily_plan_confirm', date: day.date, expectedRevision: 1, selectedItemIds: ['draft'], instruction: '确认采纳安排' });
  await invoke('记录日终复盘', { action: 'daily_review_save', date: day.date, expectedRevision: 0, acceptedRevision: 2, results: [{ itemId: 'draft', status: 'unknown', detail: '已确认目标，实际成果仍待核对' }], adjustments: ['下次安排先补齐客户输入'], question: '还缺少哪项客户信息？' });
  await invoke('保存新的建议', { action: 'daily_plan_save', focusRevision: 1, date: day.date, expectedRevision: 2, items: [{ ...items[0], id: 'feedback', title: '先确认客户反馈', nextAction: '列出待澄清的客户问题' }], decisions: ['若客户输入仍缺失，先完成已知部分，或将重点切换到另一项已确认成果。'] });
}
const [calendar, todosView, runs] = await Promise.all([
  host.api('calendar', { workspaceBinding: ready.workspaceBinding, period: 'day', limit: 50 }),
  host.api('todos', { workspaceBinding: ready.workspaceBinding, status: 'open', deadline: 'all', limit: 50 }),
  host.api('runs.summary', { workspaceBinding: ready.workspaceBinding }),
]);
console.log(JSON.stringify({ url: host.url, root, workspace, binding: ready.workspaceBinding,
  evidence: { calendarCount: calendar.count, todoOpen: todosView.counts.open, waitingWork: runs.waiting_work, sourcesComplete: calendar.complete && todosView.complete },
  boundary: '真实 dsh + SQLite；平台与模型均为本地桩，无真实账号调用', states: ['多来源日程与待办', '逾期与今日到期', '已知时间冲突', '待我处理交办', '来源范围不完整'] }, null, 2));
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await host.stop(); await llm.close(); await rm(root, { recursive: true, force: true }); process.exit(0); };
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
