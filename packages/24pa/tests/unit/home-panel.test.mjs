import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let React, act, createRoot, win, root, container, requests, binding, scenario, poll, homePoll, delayCalendar, releaseCalendar, language, localeListener, localeSnapshot;
const zone = 'Asia/Shanghai';
const source = (id, domain, platform, state = 'complete') => ({ sourceId: id, name: id === 'personal' ? '个人来源' : '项目来源', platform, filter: 'all', state, fresh: false, reason: state === 'complete' ? null : '授权范围未完整核验', checkedAt: '2026-11-01T00:30:00Z', lastCompleteAt: state === 'complete' ? '2026-11-01T00:30:00Z' : null });
const location = (sourceId, platform, url = 'https://calendar.example/review') => ({ sourceId, sourceName: sourceId === 'personal' ? '个人来源' : '项目来源', platform, roles: { complete: true, values: ['organizer'] }, capabilities: { update: 'allowed', cancel: 'allowed' }, locator: { eventId: 'native-' + sourceId, url } });
const event = (patch = {}) => ({ objectId: 'event-current', eventId: 'native-current', summary: '产品评审', start: '2026-11-01T01:00:00Z', end: '2026-11-01T03:00:00Z', timezone: zone, recurring: false, stale: true, checkedAt: '2026-11-01T00:30:00Z', locations: [location('personal', 'feishu')], ...patch });
const calendarData = () => {
  if (scenario === 'malformed') return {};
  if (scenario === 'no-sources') return { workspaceBinding: binding, sources: [], events: [], next: null, conflicts: [], fresh: false, complete: false, count: 0, total: null, hasMore: false };
  if (scenario === 'empty') return { workspaceBinding: binding, sources: [source('personal', 'calendar', 'feishu')], events: [], next: null, conflicts: [], fresh: false, complete: true, count: 0, total: 0, hasMore: false };
  const current = event(), later = event({ objectId: 'event-later', eventId: 'native-later', summary: '项目同步', start: '2026-11-01T02:30:00Z', end: '2026-11-01T04:00:00Z', locations: [location('project', 'wecom', 'https://calendar.example/project')] });
  const partial = scenario === 'partial';
  return { workspaceBinding: binding, sources: [source('personal', 'calendar', 'feishu', partial ? 'failed' : 'complete'), source('project', 'calendar', 'wecom')], events: [current, later], next: current,
    conflicts: [{ a: current.objectId, b: later.objectId, aSummary: current.summary, bSummary: later.summary }], fresh: false, complete: !partial, count: 2, total: partial ? null : 2, hasMore: false };
};
const todo = (patch = {}) => ({ objectId: 'todo-overdue', guid: 'guid-overdue', summary: '提交预算', status: 'open', dueAt: null, dueDate: '2026-10-31', bucket: 'overdue', assignees: [{ id: 'owner', name: '本人' }], url: 'https://todo.example/budget', workItemIds: ['work-1'], stale: true,
  locations: [{ sourceId: 'personal', sourceName: '个人来源', platform: 'feishu', roles: { complete: true, values: ['responsible'] }, capabilities: { update: 'allowed' }, locator: { url: 'https://todo.example/budget' } }], ...patch });
const todoData = () => {
  if (scenario === 'malformed') return {};
  if (scenario === 'no-sources') return { workspaceBinding: binding, sources: [], tasks: [], counts: { overdue: 0, today: 0, open: 0, undated: 0 }, fresh: false, complete: false, count: 0, total: null, hasMore: false };
  if (scenario === 'empty') return { workspaceBinding: binding, sources: [source('personal', 'todo', 'feishu')], tasks: [], counts: { overdue: 0, today: 0, open: 0, undated: 0 }, fresh: false, complete: true, count: 0, total: 0, hasMore: false };
  const rows = [todo(), todo({ objectId: 'todo-today', guid: 'guid-today', summary: '回复合同', dueDate: null, dueAt: '2026-11-01T02:00:00Z', bucket: 'today', workItemIds: [], locations: [{ sourceId: 'project', sourceName: '项目来源', platform: 'wecom', roles: { complete: true, values: ['responsible'] }, capabilities: {}, locator: {} }] }),
    todo({ objectId: 'todo-undated', guid: 'guid-undated', summary: '整理旅行清单', dueDate: null, dueAt: null, bucket: 'undated', workItemIds: [] })];
  const partial = scenario === 'partial';
  return { workspaceBinding: binding, sources: [source('personal', 'todo', 'feishu'), source('project', 'todo', 'wecom', partial ? 'partial' : 'complete')], tasks: rows,
    counts: { overdue: 2, today: 3, open: 8, undated: 1 }, fresh: false, complete: !partial, count: 8, total: partial ? null : 8, hasMore: true };
};
const runSummary = () => ({ workspaceBinding: binding, runs24: 12, failed24: 1, delivery_failed24: 2, delivery_unknown24: 1, waiting_work: 4, active_work: 3, failed_work: 1, unresolved: 2, unresolved_events: 1, empty: false, observedAt: '2026-11-01T01:00:00Z' });
const planSummary = () => ({ workspaceBinding: binding, total: 3, enabled: 2, paused: 1, blocked: 1, next: { id: 'plan-morning', title: '项目晨报', at: '2026-11-02T01:00:00Z', timeZone: zone } });
const reviewSummary = () => ({ count: 5, counts: { awaiting_review: 3, returned: 1, needs_rereview: 1, verificationUnknown: 1 }, items: [] });
const snapshot = () => ({ workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG, timeZone: zone } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } });
const valueFor = (endpoint, payload) => {
  if (endpoint === 'snapshot') return snapshot();
  if (endpoint === 'home') return { workspaceBinding: binding, observedAt: '2026-11-01T01:30:00Z', calendar: calendarData(), todos: todoData(), review: reviewSummary(), plans: planSummary(), runs: runSummary() };
  if (endpoint === 'calendar') return calendarData();
  if (endpoint === 'todos') return todoData();
  if (endpoint === 'runs.summary') return runSummary();
  if (endpoint === 'plans.summary') return planSummary();
  if (endpoint === 'notes.queue') return reviewSummary();
  if (endpoint === 'sources') return { workspaceBinding: binding, configHash: 'source-hash', config: { version: 1, entries: [], defaults: { calendar: null, todo: null }, mappings: [] }, entries: [] };
  if (endpoint === 'runs') return { workspaceBinding: binding, kind: payload.kind, rows: [], total: 0, empty: true, timeZone: zone };
  if (endpoint === 'materials') return { workspaceBinding: binding, items: [], total: 0, matched: 0, counts: {}, offset: 0, limit: 20 };
  if (endpoint === 'health') return { capabilities: [] };
  if (endpoint === 'memory') return { items: [], total: 0, matched: 0 };
  if (endpoint === 'roles') return { roles: [] };
  if (endpoint === 'reminders' || endpoint === 'digests') return { rules: [], occurrences: [], plans: [], skills: [] };
  return {};
};

beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
beforeEach(async () => {
  requests = []; binding = 'binding-a'; scenario = 'default'; delayCalendar = false; releaseCalendar = null; language = 'zh'; localeListener = null; localeSnapshot = { active: 'zh', locales: [], revision: 0 }; homePoll = null; win.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T01:30:00Z'));
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; if (delay === 30000) homePoll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    if (scenario === 'error' && ['home', 'calendar', 'todos'].includes(request.endpoint)) return { ok: true, json: async () => ({ ok: false, error: { message: '本地读取离线' } }) };
    if (request.endpoint === 'home' && delayCalendar) {
      const value = valueFor('home', {}); value.calendar.events[0].summary = '旧工作区日程'; value.calendar.next.summary = '旧工作区日程';
      return new Promise(resolve => { releaseCalendar = () => resolve({ ok: true, json: async () => ({ ok: true, value }) }); });
    }
    return { ok: true, json: async () => ({ ok: true, value: valueFor(request.endpoint, request.payload) }) };
  }));
  let module, Panel; win.__ModuleLoader__ = { load: value => { module = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  module.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh, en }) => language === 'en' ? en : zh, subscribe: listener => { localeListener = listener; return () => {}; }, getSnapshot: () => localeSnapshot },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const metric = id => container.querySelector(`[data-testid=${id}]`);
const metricValue = id => metric(id)?.querySelector('strong')?.textContent;
const home = async () => click(container.querySelector('#pa24-tab-home'));
const refresh = async () => click([...container.querySelectorAll('button')].find(node => node.textContent === '刷新'));
const lastRequest = endpoint => requests.filter(request => request.endpoint === endpoint).at(-1);

it('默认首页使用真实摘要与双看板，保留五类导航且普通刷新没有业务动作', async () => {
  expect(container.querySelector('[data-testid=home-overview]')).toBeTruthy();
  expect(container.querySelectorAll('[role=tab]')).toHaveLength(5);
  expect(container.querySelector('#pa24-tab-home').getAttribute('aria-selected')).toBe('true');
  expect([...container.querySelectorAll('button')].some(node => node.textContent === '管理卡片')).toBe(false);
  expect(metricValue('home-metric-calendar')).toBe('2'); expect(metricValue('home-metric-overdue')).toBe('2'); expect(metricValue('home-metric-today')).toBe('3');
  expect(metricValue('home-metric-work')).toBe('4'); expect(metricValue('home-metric-review')).toBe('5'); expect(metricValue('home-metric-runs')).toBe('2');
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('产品评审'); expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('项目同步');
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('项目来源'); expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('时间冲突');
  expect(container.querySelectorAll('[data-testid=home-todo-row]')).toHaveLength(3); expect(container.querySelector('[data-testid=home-todo-board]').textContent).toContain('整理旅行清单');
  expect(container.querySelector('[data-testid=home-assistant-status]').textContent).toContain('项目晨报'); expect(container.querySelector('[data-testid=home-assistant-status]').textContent).toContain('投递待核对');
  expect(lastRequest('home').payload).toMatchObject({ workspaceBinding: 'binding-a' });
  expect(requests.some(request => ['calendar', 'todos', 'notes.queue', 'plans.summary', 'runs.summary'].includes(request.endpoint))).toBe(false);
  const before = requests.filter(request => request.endpoint === 'home').length;
  await refresh(); expect(requests.filter(request => request.endpoint === 'home').length).toBeGreaterThan(before);
  expect(requests.filter(request => request.endpoint === 'action')).toHaveLength(0);
});

it('指标进入原详情并保留日程与待办筛选', async () => {
  await click(metric('home-metric-overdue'));
  expect(container.querySelector('[data-testid=todo-detail]')).toBeTruthy(); expect(lastRequest('todos').payload).toMatchObject({ status: 'open', deadline: 'overdue', offset: 0 });
  await home(); await click(metric('home-metric-today'));
  expect(lastRequest('todos').payload).toMatchObject({ status: 'open', deadline: 'today', offset: 0 });
  await home(); await click(metric('home-metric-calendar'));
  expect(container.querySelector('[data-testid=calendar-detail]')).toBeTruthy(); expect(lastRequest('calendar').payload).toMatchObject({ date: '2026-11-01', period: 'day', offset: 0 });
  await home(); await click(metric('home-metric-work'));
  expect(lastRequest('runs').payload).toMatchObject({ kind: 'work', range: 'all', includeUnresolved: true, attention: 'waiting' });
  await home(); await click(metric('home-metric-runs'));
  expect(lastRequest('runs').payload).toMatchObject({ kind: 'runs', range: 'all', includeUnresolved: true, attention: 'unresolved' });
  await home(); await click([...container.querySelectorAll('button')].find(node => node.textContent === '关联交办'));
  expect(lastRequest('runs').payload).toMatchObject({ kind: 'work', workId: 'work-1', range: 'all', offset: 0 });
  expect(requests.filter(request => request.endpoint === 'action')).toHaveLength(0);
});

it('部分失败、读取失败、无来源、完整空结果和不完整响应分别呈现', async () => {
  scenario = 'partial'; await refresh();
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('部分来源核验失败');
  expect(container.querySelector('[data-testid=home-todo-board]').textContent).toContain('来源范围未完整核验');
  expect(metricValue('home-metric-calendar')).toBe('2（可展示）'); expect(metricValue('home-metric-overdue')).toBe('2（可展示）');
  expect(container.textContent).not.toContain('全部空闲'); expect(container.textContent).not.toContain('全部完成。');
  scenario = 'error'; await refresh();
  expect(metricValue('home-metric-calendar')).toBe('—'); expect(metricValue('home-metric-overdue')).toBe('—');
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('日程读取失败'); expect(container.querySelector('[data-testid=home-todo-board]').textContent).toContain('待办读取失败');
  scenario = 'no-sources'; await refresh();
  expect(metricValue('home-metric-calendar')).toBe('—'); expect(metricValue('home-metric-today')).toBe('—');
  expect(container.textContent).toContain('尚未登记日历来源'); expect(container.textContent).toContain('尚未登记待办来源');
  scenario = 'empty'; await refresh();
  expect(metricValue('home-metric-calendar')).toBe('0'); expect(metricValue('home-metric-today')).toBe('0');
  expect(container.textContent).toContain('保存的完整观察为空'); expect(container.textContent).toContain('保存观察中没有未完成待办');
  scenario = 'malformed'; await refresh();
  expect(metricValue('home-metric-calendar')).toBe('—'); expect(container.querySelectorAll('[data-testid=home-overview]')).toHaveLength(1);
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('首页响应不完整');
});

it('首页定时只读重读组合快照，不触发业务动作', async () => {
  expect(homePoll).toBeTruthy();
  const before = requests.filter(request => request.endpoint === 'home').length;
  await act(async () => homePoll());
  expect(requests.filter(request => request.endpoint === 'home').length).toBeGreaterThan(before);
  expect(requests.filter(request => request.endpoint === 'action')).toHaveLength(0);
});

it('工作区切换后忽略迟到的旧首页响应', async () => {
  delayCalendar = true; await refresh();
  binding = 'binding-b'; delayCalendar = false; await act(async () => { await poll(); });
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('产品评审');
  await act(async () => releaseCalendar());
  expect(container.textContent).not.toContain('旧工作区日程');
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('产品评审');
});

it('首页与四分类支持键盘导航，返回首页后隐藏卡片管理', async () => {
  const first = container.querySelector('#pa24-tab-home'); first.focus();
  await act(async () => first.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(container.querySelector('#pa24-tab-work').getAttribute('aria-selected')).toBe('true'); expect(win.document.activeElement.id).toBe('pa24-tab-work');
  expect([...container.querySelectorAll('button')].some(node => node.textContent === '管理卡片')).toBe(true);
  const work = container.querySelector('#pa24-tab-work');
  await act(async () => work.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
  expect(container.querySelector('#pa24-tab-home').getAttribute('aria-selected')).toBe('true');
  expect([...container.querySelectorAll('button')].some(node => node.textContent === '管理卡片')).toBe(false);
});


it('英文界面切换覆盖首页、对话草稿和后台技术错误', async () => {
  language = 'en'; localeSnapshot = { active: 'en', locales: [], revision: 1 }; await act(async () => localeListener());
  expect(container.querySelector('.pa24-home-hero').textContent).toContain('Focus on what matters today');
  expect(container.querySelector('.pa24-home-kpis').textContent).not.toMatch(/[\u3400-\u9fff]/);
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('Saved complete observations');
  expect(container.querySelector('[data-testid=home-todo-board]').textContent).toContain('Saved complete observations');
  await click(metric('home-metric-overdue'));
  await click([...container.querySelector('[data-testid=todo-detail]').querySelectorAll('button')].find(node => node.textContent === 'Reschedule or edit'));
  const todoDraft = container.querySelector('textarea[aria-label="Todo chat draft"]');
  expect(todoDraft.value).toContain('Please reschedule or edit this todo.'); expect(todoDraft.value).not.toContain('请帮我');
  await home(); await click(metric('home-metric-calendar'));
  await click([...container.querySelector('[data-testid=calendar-detail]').querySelectorAll('button')].find(node => node.textContent === 'Create event'));
  const calendarDraft = container.querySelector('textarea[aria-label="Calendar chat draft"]');
  expect(calendarDraft.value).toContain('Please create an event.'); expect(calendarDraft.value).not.toContain('请帮我');
  await home(); scenario = 'error';
  await click([...container.querySelectorAll('button')].find(node => node.textContent === 'Refresh'));
  expect(container.querySelector('[data-testid=home-calendar-board]').textContent).toContain('The local read failed.');
  expect(container.querySelector('[data-testid=home-todo-board]').textContent).toContain('The local read failed.');
  expect(container.textContent).not.toContain('本地读取离线');
});
