#!/usr/bin/env node
// Stub lark-cli for tests: speaks the same fixed-argv + `--json` envelope as
// the real CLI. Docs and call records use append-only JSONL so parallel
// invocations never lose updates; behavior flags (ownerOpenId, failNext)
// live in a small state file that tests set before triggering the stub.
// The plugin still spawns a real process and parses real stdout, so only the
// Feishu network side is replaced.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const statePath = process.env.PA24_LARK_STUB_STATE;
const docsPath = `${statePath}.docs.jsonl`;
const callsPath = `${statePath}.calls.jsonl`;
const tasksPath = `${statePath}.tasks.jsonl`;
const eventsPath = `${statePath}.events.jsonl`;
const args = process.argv.slice(2);
// Skip flag values (--profile <name>) the same way the real CLI parses.
const plain = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--profile');
const json = args.includes('--json');

const readState = async () => {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { ownerOpenId: 'ou_test_owner' };
  }
};
const readTasks = async () => {
  try {
    const lines = (await readFile(tasksPath, 'utf8')).split('\n').filter(Boolean);
    // Append-only journal: the last record per guid is current, so parallel
    // appends never lose updates.
    const latest = new Map();
    for (const line of lines) {
      const record = JSON.parse(line);
      latest.set(record.guid, record);
    }
    return [...latest.values()];
  } catch {
    return [];
  }
};
const readEvents = async () => {
  try {
    const lines = (await readFile(eventsPath, 'utf8')).split('\n').filter(Boolean);
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
const readDocs = async () => {
  try {
    const lines = (await readFile(docsPath, 'utf8')).split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line));
  } catch {
    return [];
  }
};
const writeState = async state => writeFile(statePath, JSON.stringify(state, null, 2));

const ok = data => {
  if (json) console.log(JSON.stringify({ ok: true, data }));
  process.exit(0);
};
const fail = message => {
  if (json) console.error(JSON.stringify({ ok: false, error: { message } }));
  else console.error(message);
  process.exit(1);
};

const callRecord = { at: new Date().toISOString(), args, ok: true };
await appendFile(callsPath, JSON.stringify(callRecord) + '\n').catch(() => {});
const state = await readState();
const docs = await readDocs();
const tasks = await readTasks();
const events = await readEvents();
const argOf = name => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

if (args.includes('--version')) {
  console.log('stub-lark-cli 1.0.87-test');
  process.exit(0);
}
if (plain[0] === 'auth' && plain[1] === 'status') {
  if (state.failNext?.command === 'auth') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'auth status injected failure');
  }
  ok({ appId: state.appId ?? 'cli-test-app', verified: true, identities: { user: { openId: state.ownerOpenId ?? 'ou_test_owner', userName: '测试主人', tokenStatus: 'valid' } } });
}
if (plain[0] === 'calendar' && plain[1] === 'calendars') {
  if (plain[2] === 'primary') ok({ calendars: [{ user_id: state.ownerOpenId ?? 'ou_test_owner', calendar: { calendar_id: state.primaryCalendarId ?? 'primary-calendar' } }] });
  if (plain[2] === 'get') ok({ calendar_id: argOf('--calendar-id'), role: state.calendarRole ?? 'owner', is_deleted: false, is_third_party: false });
}
const nativeEvent = event => ({ event_id: event.event_id, summary: event.summary, start_time: { timestamp: String(Date.parse(event.start) / 1000), timezone: event.timezone ?? 'Asia/Shanghai' },
  end_time: { timestamp: String(Date.parse(event.end) / 1000), timezone: event.timezone ?? 'Asia/Shanghai' }, status: event.status === 'canceled' ? 'cancelled' : 'confirmed',
  organizer_calendar_id: event.calendar_id ?? argOf('--calendar-id'), event_organizer: { user_id: event.organizer ?? state.ownerOpenId ?? 'ou_test_owner' },
  app_link: event.url, reminders: event.reminders ?? [{ minutes: 5 }], recurrence: event.rrule ?? '', attendees: event.attendees ?? [] });
if (plain[0] === 'calendar' && plain[1] === 'events' && plain[2] === 'instance_view') {
  if (state.calendarFailures?.includes(argOf('--calendar-id'))) fail('该日历读取失败');
  if (state.failNext?.command === 'calendar.agenda') { await writeState({ ...state, failNext: null }); fail('agenda injected failure'); }
  if (state.instancesOverride) ok({ items: state.instancesOverride });
  const from = Number(argOf('--start-time')) * 1000, to = Number(argOf('--end-time')) * 1000;
  ok({ items: events.filter(row => (!row.calendar_id || row.calendar_id === argOf('--calendar-id')) && Date.parse(row.start) < to && Date.parse(row.end) > from).map(nativeEvent) });
}
if (plain[0] === 'calendar' && plain[1] === 'events' && plain[2] === 'get') {
  const event = events.find(row => row.event_id === argOf('--event-id') && (!row.calendar_id || row.calendar_id === argOf('--calendar-id')));
  if (!event) fail('日程不存在');
  ok({ event: nativeEvent(event) });
}
if (plain[0] === 'calendar' && plain[1] === 'event.attendees') {
  const event = events.find(row => row.event_id === argOf('--event-id'));
  if (!event) fail('日程不存在');
  if (plain[2] === 'list') ok({ items: (event.attendees ?? []).map(row => ({ ...row, type: 'user', user_id: row.user_id ?? row.open_id, attendee_id: row.attendee_id ?? row.user_id ?? row.open_id, rsvp_status: 'accept' })), has_more: false });
  if (plain[2] === 'create') {
    const attendees = JSON.parse(argOf('--data')).attendees.map(row => ({ ...row, attendee_id: row.user_id, rsvp_status: 'needs_action' }));
    await appendFile(eventsPath, JSON.stringify({ ...event, attendees: [...(event.attendees ?? []), ...attendees] }) + '\n'); ok({ attendees });
  }
}
if (plain[0] === 'calendar' && plain[1] === 'events' && ['patch', 'delete'].includes(plain[2])) {
  const event = events.find(row => row.event_id === argOf('--event-id') && (!row.calendar_id || row.calendar_id === argOf('--calendar-id')));
  if (!event) fail('日程不存在');
  const patch = plain[2] === 'delete' ? {} : JSON.parse(argOf('--data'));
  const next = { ...event, summary: patch.summary ?? event.summary, start: patch.start_time ? new Date(Number(patch.start_time.timestamp) * 1000).toISOString() : event.start,
    end: patch.end_time ? new Date(Number(patch.end_time.timestamp) * 1000).toISOString() : event.end,
    reminders: patch.reminders ?? event.reminders, status: plain[2] === 'delete' ? 'canceled' : event.status };
  await appendFile(eventsPath, JSON.stringify(next) + '\n'); ok(plain[2] === 'delete' ? {} : { event: nativeEvent(next) });
}
if (plain[0] === 'docs' && plain[1] === '+create') {
  if (state.failNext?.command === 'docs.create') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'docs create injected failure');
  }
  const stdin = await new Promise(resolveStdin => {
    let data = '';
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolveStdin(data));
    process.stdin.on('error', () => resolveStdin(data));
  });
  const id = `docstub-${docs.length + 1}`;
  // Controlled owner edit after platform creation but before the first read.
  const content = (state.docCreateEdits ?? []).reduce((body, edit) => body.replaceAll(edit.from, edit.to), stdin);
  // F22: record the parent token so e2e can assert where a doc landed
  // (wiki node vs. folder) without re-parsing raw call args.
  await appendFile(docsPath, JSON.stringify({ id, content, revision: content === stdin ? 1 : 2, parentToken: argOf('--parent-token') ?? null }) + '\n');
  ok({ document: { document_id: id, url: `https://example.feishu.cn/wiki/${id}`, revision_id: 1 }, warnings: [] });
}
if (plain[0] === 'docs' && plain[1] === '+fetch') {
  const docArg = args[args.indexOf('--doc') + 1];
  const doc = [...docs].reverse().find(d => d.id === docArg);
  if (state.documentOverride) ok({ document: state.documentOverride });
  if (!doc) fail(`文档不存在：${docArg}`);
  // Simulates owner-side edits configured by tests (P32 changed-detection).
  const edit = state.docEdits?.[docArg];
  const content = edit ? `${doc.content}\n${edit}` : doc.content;
  ok({ document: { document_id: doc.id, url: `https://example.feishu.cn/wiki/${doc.id}`, content, revision_id: doc.revision + (edit ? 100 : 0), reference_map: {} } });
}
if (plain[0] === 'docs' && plain[1] === '+update') {
  if (state.failNext?.command === 'docs.update') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'docs update injected failure');
  }
  const docArg = argOf('--doc');
  const doc = [...docs].reverse().find(d => d.id === docArg);
  if (!doc) fail(`文档不存在：${docArg}`);
  const command = argOf('--command');
  const pattern = argOf('--pattern');
  const content = argOf('--content');
  const edited = state.docEdits?.[docArg];
  let base = edited ? `${doc.content}\n${edited}` : doc.content;
  if (command === 'str_replace') {
    if (!base.includes(pattern)) fail(`str_replace 未找到匹配文本：${pattern.slice(0, 60)}`);
    base = base.replace(pattern, content ?? '');
  } else {
    fail(`stub-lark-cli 未实现的 docs +update 命令：${command}`);
  }
  delete state.docEdits?.[docArg];
  await writeState(state);
  await appendFile(docsPath, JSON.stringify({ ...doc, content: base, revision: doc.revision + 1 }) + '\n');
  ok({ document: { document_id: doc.id, revision_id: doc.revision + 1 } });
}
if (plain[0] === 'docs' && plain[1] === '+media-insert') {
  if (state.failNext?.command === 'docs.media-insert') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'media insert injected failure');
  }
  const docArg = argOf('--doc');
  const file = argOf('--file');
  const doc = [...docs].reverse().find(d => d.id === docArg);
  if (!doc) fail(`文档不存在：${docArg}`);
  if (!file) fail('缺少 --file');
  const bytes = await readFile(file), token = 'media-' + createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  await appendFile(`${statePath}.media.jsonl`, JSON.stringify({ token, bytes: bytes.toString('base64') }) + '\n');
  await appendFile(docsPath, JSON.stringify({ ...doc, content: `${doc.content}\n<img token="${token}"/>`, revision: doc.revision + 1 }) + '\n');
  ok({ block: { block_id: `imgstub-${doc.revision + 1}` } });
}
if (plain[0] === 'docs' && plain[1] === '+media-download') {
  if (state.failNext?.command === 'docs.media-download') { await writeState({ ...state, failNext: null }); fail('resource download failed'); }
  const media = (await readFile(`${statePath}.media.jsonl`, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const token = argOf('--token');
  const bytes = state.mediaOverrides?.[token] ?? media.findLast(row => row.token === token)?.bytes;
  if (!bytes) fail('resource token missing');
  await writeFile(argOf('--output'), Buffer.from(bytes, 'base64'));
  ok({ path: argOf('--output') });
}
const nativeTask = task => ({ ...task,
  due: typeof task.due === 'string' ? { timestamp: String(Date.parse(task.due)), is_all_day: !/[:T]/.test(task.due) } : task.due ?? null,
  completed_at: task.status === 'completed' ? '1790000000000' : '0',
  creator: task.creator ?? { id: state.ownerOpenId ?? 'ou_test_owner', type: 'user' },
  members: task.members ?? [{ id: state.ownerOpenId ?? 'ou_test_owner', type: 'user', role: 'assignee' }],
  tasklists: task.tasklists ?? [{ tasklist_guid: task.tasklistId ?? 'tl_test' }], mode: task.mode ?? 2 });
if (plain[0] === 'task' && ((plain[1] === 'tasklists' && plain[2] === 'tasks') || plain[1] === '+get-related-tasks')) {
  if (state.todoListFailure && state.todoListFailure === argOf('--tasklist-guid')) fail('task list unavailable');
  const all = tasks.filter(task => !task.deleted && (!argOf('--tasklist-guid') || nativeTask(task).tasklists.some(row => row.tasklist_guid === argOf('--tasklist-guid'))));
  const offset = Number(argOf('--page-token') ?? 0), size = state.todoPageSize ?? Number(argOf('--page-size') ?? 100);
  ok({ items: all.slice(offset, offset + size).map(nativeTask), has_more: offset + size < all.length, page_token: offset + size < all.length ? String(offset + size) : '' });
}
if (plain[0] === 'task' && plain[1] === 'tasks' && plain[2] === 'create') {
  if (state.failNext?.command === 'task.create') { await writeState({ ...state, failNext: null }); fail(state.failNext.error ?? 'task create injected failure'); }
  const body = JSON.parse(argOf('--data') ?? '{}');
  const existing = body.client_token ? tasks.find(task => task.idempotencyKey === body.client_token) : null;
  if (existing) ok({ task: nativeTask(existing) });
  const guid = `tskstub-${tasks.length + 1}`;
  const record = { ...body, guid, url: `https://example.feishu.cn/task/${guid}`, status: 'open', idempotencyKey: body.client_token ?? null,
    creator: { id: state.ownerOpenId ?? 'ou_test_owner', type: 'user' }, members: state.todoMissingAssignee ? [] : body.members };
  await appendFile(tasksPath, JSON.stringify(record) + '\n'); ok({ task: nativeTask(record) });
}
if (plain[0] === 'task' && ((plain[1] === 'tasks' && ['patch', 'delete'].includes(plain[2])) || (plain[1] === 'members' && plain[2] === 'add'))) {
  const guid = argOf('--task-guid'), old = tasks.find(task => task.guid === guid);
  if (!old) fail('task not found');
  const record = { ...old }, body = JSON.parse(argOf('--data') ?? '{}');
  if (plain[2] === 'delete') record.deleted = true;
  else if (plain[1] === 'members') record.members = [...(nativeTask(record).members), ...body.members];
  else for (const field of body.update_fields) {
    if (field === 'completed_at') record.status = Number(body.task.completed_at) > 0 ? 'completed' : 'open';
    else if (Object.hasOwn(body.task, field)) record[field] = body.task[field]; else delete record[field];
  }
  await appendFile(tasksPath, JSON.stringify(record) + '\n'); ok({ task: nativeTask(record) });
}
if (plain[0] === 'task' && plain[1] === '+create') {
  if (state.failNext?.command === 'task.create') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'task create injected failure');
  }
  const summary = argOf('--summary');
  const due = argOf('--due');
  const idempotencyKey = argOf('--idempotency-key');
  const existing = idempotencyKey ? tasks.find(t => t.idempotencyKey === idempotencyKey) : undefined;
  if (existing) {
    ok({ task: { guid: existing.guid, url: existing.url, idempotent: true } });
  }
  const guid = `tskstub-${tasks.length + 1}`;
  const record = { guid, url: `https://example.feishu.cn/task/${guid}`, summary, due: due ?? null, status: 'open', tasklistId: argOf('--tasklist-id') ?? 'tl_test', idempotencyKey: idempotencyKey ?? null };
  await appendFile(tasksPath, JSON.stringify(record) + '\n');
  ok({ task: { guid, url: record.url } });
}
if (plain[0] === 'task' && plain[1] === '+update') {
  const guid = argOf('--task-id');
  const task = [...tasks].reverse().find(t => t.guid === guid);
  if (!task) fail(`任务不存在：${guid}`);
  const summary = argOf('--summary');
  const due = argOf('--due');
  await appendFile(tasksPath, JSON.stringify({ ...task, summary: summary ?? task.summary, due: due ?? task.due, revision: (task.revision ?? 0) + 1 }) + '\n');
  ok({ task: { guid, url: task.url, summary: summary ?? task.summary, due: due ?? task.due } });
}
if (plain[0] === 'task' && plain[1] === '+complete') {
  const guid = argOf('--task-id');
  const task = [...tasks].reverse().find(t => t.guid === guid);
  if (!task) fail(`任务不存在：${guid}`);
  await appendFile(tasksPath, JSON.stringify({ ...task, status: 'completed', revision: (task.revision ?? 0) + 1 }) + '\n');
  ok({ task: { guid, status: 'completed' } });
}
if (plain[0] === 'task' && plain[1] === 'tasks' && plain[2] === 'get') {
  if (state.failNext?.command === 'task.get') fail('task get unavailable');
  if (state.taskGetOverride) ok({ task: state.taskGetOverride });
  const task = [...tasks].reverse().find(t => t.guid === argOf('--task-guid'));
  if (!task) fail('task not found');
  if (task.deleted) fail('task deleted');
  ok({ task: nativeTask(task) });
}
if (plain[0] === 'task' && plain[1] === '+search') {
  const query = argOf('--query') ?? '';
  const matched = tasks.filter(t => !query || t.summary.includes(query.replace(/^\[24PA\] /, '').slice(0, 20)) || t.summary.includes(query));
  ok({ tasks: matched.map(t => ({ guid: t.guid, summary: t.summary, completed: t.status === 'completed', status: t.status })) });
}
if (plain[0] === 'calendar' && plain[1] === '+agenda') {
  if (state.failNext?.command === 'calendar.agenda') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'agenda injected failure');
  }
  if (state.agendaOverride) ok({ events: state.agendaOverride });
  const start = argOf('--start');
  const end = argOf('--end');
  const inWindow = events.filter(e => e.status !== 'canceled' && new Date(e.start) < new Date(end) && new Date(e.end) > new Date(start));
  ok({ events: inWindow.map(e => ({ event_id: e.event_id, summary: e.summary, start_time: e.start, end_time: e.end, is_all_day: e.all_day === true, status: e.status, url: e.url, attendees: e.attendees ?? [] })) });
}
if (plain[0] === 'calendar' && plain[1] === 'events' && plain[2] === 'create') {
  if (state.failNext?.command === 'calendar.create') {
    await writeState({ ...state, failNext: null }); fail('calendar create rejected');
  }
  if (state.failNext?.command === 'calendar.create_unknown') {
    await writeState({ ...state, failNext: null }); console.log('receipt unavailable'); process.exit(0);
  }
  const body = JSON.parse(argOf('--data'));
  const event_id = `evtstub-${events.length + 1}_0`;
  const record = { event_id, calendar_id: argOf('--calendar-id'), summary: body.summary, start: new Date(Number(body.start_time.timestamp) * 1000).toISOString(), end: new Date(Number(body.end_time.timestamp) * 1000).toISOString(), status: 'active', all_day: false, rrule: body.recurrence ?? null, timezone: body.start_time.timezone, reminders: body.reminders, url: `https://example.feishu.cn/calendar/event/${event_id}`, attendees: [] };
  await appendFile(eventsPath, JSON.stringify(record) + '\n');
  ok({ event: { event_id, url: record.url, summary: record.summary } });
}
if (plain[0] === 'calendar' && plain[1] === '+create') {
  const summary = argOf('--summary');
  const start = argOf('--start');
  const end = argOf('--end');
  const attendeeIds = argOf('--attendee-ids');
  const event_id = `evtstub-${events.length + 1}`;
  const record = { event_id, summary, start, end, status: 'active', all_day: false, rrule: argOf('--rrule') ?? null, url: `https://example.feishu.cn/calendar/event/${event_id}`, attendees: attendeeIds ? attendeeIds.split(',').map(id => ({ open_id: id })) : [] };
  await appendFile(eventsPath, JSON.stringify(record) + '\n');
  ok({ event: { event_id, url: record.url, summary } });
}
if (plain[0] === 'calendar' && plain[1] === '+update') {
  const event_id = argOf('--event-id');
  const event = [...events].reverse().find(e => e.event_id === event_id);
  if (!event) fail(`日程不存在：${event_id}`);
  const next = { ...event, summary: argOf('--summary') ?? event.summary, start: argOf('--start') ?? event.start, end: argOf('--end') ?? event.end };
  await appendFile(eventsPath, JSON.stringify(next) + '\n');
  ok({ event: { event_id, summary: next.summary, start: next.start, end: next.end } });
}
if (plain[0] === 'calendar' && plain[1] === '+delete') {
  const event_id = argOf('--event-id');
  const event = [...events].reverse().find(e => e.event_id === event_id);
  if (!event) fail(`日程不存在：${event_id}`);
  await appendFile(eventsPath, JSON.stringify({ ...event, status: 'canceled' }) + '\n');
  ok({ event: { event_id, status: 'canceled' } });
}
if (plain[0] === 'im' && plain[1] === '+messages-send') {
  if (state.failNext?.command === 'im.send') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'im send injected failure');
  }
  const userId = argOf('--user-id');
  const body = argOf('--text');
  const key = argOf('--idempotency-key');
  const sendsPath = `${statePath}.sends.jsonl`;
  let sends = [];
  try {
    sends = (await readFile(sendsPath, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {}
  const existing = key ? sends.find(s => s.key === key) : undefined;
  if (existing) ok(argOf('--audio') ? { message_id: existing.messageId, idempotent: true } : { message: { message_id: existing.messageId }, idempotent: true });
  if (!userId || (body === undefined && !argOf('--audio'))) fail('缺少 --user-id 或消息正文');
  const messageId = `omstub-${sends.length + 1}`;
  await appendFile(sendsPath, JSON.stringify({ key: key ?? null, userId, messageId }) + '\n');
  ok(argOf('--audio') ? { message_id: messageId } : { message: { message_id: messageId } });
}
if (plain[0] === 'task' && plain[1] === '+assign') {
  if (state.failNext?.command === 'task.assign') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'task assign injected failure');
  }
  const taskId = argOf('--task-id');
  const add = argOf('--add');
  const task = [...tasks].reverse().find(t => t.guid === taskId);
  if (!task) fail(`任务不存在：${taskId}`);
  if (!add) fail('缺少 --add');
  await appendFile(tasksPath, JSON.stringify({ ...task, assignees: [...(task.assignees ?? []), ...add.split(',')] }) + '\n');
  ok({ task: { guid: taskId, assignees: add.split(',') } });
}
if (plain[0] === 'drive' && plain[1] === 'files' && plain[2] === 'list') ok({ files: [{ token: 'fld_test', name: '体验目录', type: 'folder' }] });
// F22: wiki domain — node-get doubles as the readability probe; field shapes
// (data.spaces / data.nodes, node fields at the data root) match the real CLI
// as verified in docs/research/F22-飞书知识库笔记落库实现研究.md.
if (plain[0] === 'wiki' && plain[1] === '+node-get') {
  const token = argOf('--node-token');
  if (!token) fail('缺少 --node-token');
  if (state.failNext?.command === 'wiki.node-get') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'wiki node-get injected failure');
  }
  ok({ node_token: token, obj_token: `obj_${token}`, space_id: 'spw_test', title: '测试知识库节点' });
}
if (plain[0] === 'wiki' && plain[1] === '+space-list') {
  ok({ spaces: [{ space_id: 'spw_test', name: '工作笔记', space_type: 'team' }, { space_id: 'spw_other', name: '另一个空间', space_type: 'team' }] });
}
if (plain[0] === 'task' && plain[1] === 'tasklists' && plain[2] === 'get') ok({ tasklist: { guid: argOf('--tasklist-guid') ?? 'tl_test', name: '体验清单', owner: { type: 'user', id: state.ownerOpenId ?? 'ou_test_owner' } } });
if (plain[0] === 'calendar') ok({ calendar: { calendar_id: 'cal_test', summary: '测试主人' } });
fail(`stub-lark-cli 未实现的命令：${args.join(' ')}`);
