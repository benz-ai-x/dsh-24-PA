#!/usr/bin/env node
// Stub lark-cli for tests: speaks the same fixed-argv + `--json` envelope as
// the real CLI. Docs and call records use append-only JSONL so parallel
// invocations never lose updates; behavior flags (ownerOpenId, failNext)
// live in a small state file that tests set before triggering the stub.
// The plugin still spawns a real process and parses real stdout, so only the
// Feishu network side is replaced.
import { appendFile, readFile, writeFile } from 'node:fs/promises';

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

await appendFile(callsPath, JSON.stringify({ at: new Date().toISOString(), args }) + '\n').catch(() => {});
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
  ok({ verified: true, identities: { user: { openId: state.ownerOpenId ?? 'ou_test_owner', userName: '测试主人', tokenStatus: 'valid' } } });
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
  await appendFile(docsPath, JSON.stringify({ id, content: stdin, revision: 1 }) + '\n');
  ok({ document: { document_id: id, url: `https://example.feishu.cn/wiki/${id}`, revision_id: 1 }, warnings: [] });
}
if (plain[0] === 'docs' && plain[1] === '+fetch') {
  const docArg = args[args.indexOf('--doc') + 1];
  const doc = [...docs].reverse().find(d => d.id === docArg);
  if (!doc) fail(`文档不存在：${docArg}`);
  ok({ document: { document_id: doc.id, url: `https://example.feishu.cn/wiki/${doc.id}`, content: doc.content, revision_id: doc.revision, reference_map: {} } });
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
  const record = { guid, url: `https://example.feishu.cn/task/${guid}`, summary, due: due ?? null, status: 'open', idempotencyKey: idempotencyKey ?? null };
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
  const start = argOf('--start');
  const end = argOf('--end');
  const inWindow = events.filter(e => e.status !== 'canceled' && e.start.slice(0, 10) >= start && e.end.slice(0, 10) <= end);
  ok({ events: inWindow.map(e => ({ event_id: e.event_id, summary: e.summary, start_time: e.start, end_time: e.end, is_all_day: e.all_day === true, status: e.status, url: e.url, attendees: e.attendees ?? [] })) });
}
if (plain[0] === 'calendar' && plain[1] === '+create') {
  const summary = argOf('--summary');
  const start = argOf('--start');
  const end = argOf('--end');
  const attendeeIds = argOf('--attendee-ids');
  const event_id = `evtstub-${events.length + 1}`;
  const record = { event_id, summary, start, end, status: 'active', all_day: false, url: `https://example.feishu.cn/calendar/event/${event_id}`, attendees: attendeeIds ? attendeeIds.split(',').map(id => ({ open_id: id })) : [] };
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
if (plain[0] === 'drive' && plain[1] === 'files' && plain[2] === 'list') ok({ files: [{ token: 'fld_test', name: '体验目录', type: 'folder' }] });
if (plain[0] === 'task' && plain[1] === 'tasklists' && plain[2] === 'get') ok({ tasklist: { guid: 'tl_test', name: '体验清单' } });
if (plain[0] === 'calendar') ok({ calendar: { calendar_id: 'cal_test', summary: '测试主人' } });
fail(`stub-lark-cli 未实现的命令：${args.join(' ')}`);
