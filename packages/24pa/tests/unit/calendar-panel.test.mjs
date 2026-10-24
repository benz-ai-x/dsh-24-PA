import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
let React, act, createRoot, win, root, container, requests, binding, failed, pending, poll, sourceFailed, readFailed, calendarResponse, readBarrier, overviewText;
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const entries = [{ id: 'project', domain: 'calendar', name: '项目日历' }, { id: 'personal', domain: 'calendar', name: '个人日历' }];
const location = (sourceId = 'project', eventId = 'event-1') => ({ sourceId, sourceName: sourceId === 'project' ? '项目日历' : '个人日历', platform: 'feishu', roles: { complete: true, values: ['organizer'] }, capabilities: { update: 'allowed', cancel: 'allowed' }, locator: { eventId, calendarId: sourceId + '-cal', url: 'https://calendar.example/' + eventId } });
const event = (patch = {}) => ({ objectId: 'object-0', eventId: 'event-1', summary: '项目讨论', start: '2026-10-23T01:00:00Z', end: '2026-10-23T02:00:00Z', timezone: 'Asia/Shanghai', recurring: false, stale: true, checkedAt: '2026-10-23T00:30:00Z', locations: [location()], ...patch });
const response = (payload, fresh = false) => ({ workspaceBinding: binding, sources: [{ sourceId: 'project', name: '项目日历', platform: 'feishu', filter: payload.role || 'involved', state: fresh ? 'complete' : 'partial', fresh, reason: fresh ? null : '参与关系下一页无权', checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: '2026-10-22T00:00:00Z', unknownRoles: 1 }], conflicts: [],
  events: [event({ objectId: `object-${payload.offset || 0}`, summary: payload.offset ? '后一页安排' : '项目讨论', recurring: true, stale: !fresh })],
  next: event({ objectId: 'next-object', eventId: 'next-native', summary: '进行中的设计评审', start: '2026-10-23T01:00:00Z', end: '2026-10-23T03:00:00Z', stale: !fresh, locations: [location('project', 'next-native')] }),
  fresh, complete: fresh, count: 21, total: fresh ? 21 : null, hasMore: !payload.offset, message: fresh ? '已核验 1 个来源' : '已保存结果，不能认定全部空闲' });
beforeEach(async () => {
  requests = []; binding = 'binding-a'; failed = false; pending = null; sourceFailed = false; readFailed = false; calendarResponse = response; readBarrier = null; win.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-23T01:30:00Z'));
  win.document.documentElement.dataset.theme = 'light'; win.happyDOM.setWindowSize({ width: 1280, height: 800 });
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'calendar' && readBarrier) { const gated = readBarrier(req); if (gated) return gated; }
    if (req.endpoint === 'calendar' && readFailed) return { ok: true, json: async () => ({ ok: false, error: { message: '本地读取离线' } }) };
    if (req.endpoint === 'action' && req.payload.type === 'calendar.verify') {
      if (pending) return pending;
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '原平台离线' } }) };
    }
    if (req.endpoint === 'sources' && sourceFailed === true) return { ok: true, json: async () => ({ ok: false, error: { message: '来源服务离线' } }) };
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'calendar' || (req.endpoint === 'action' && req.payload.type === 'calendar.verify') ? calendarResponse(req.payload, req.endpoint === 'action')
      : req.endpoint === 'sources' ? sourceFailed === 'shape' ? { entries: null } : { entries }
      : req.endpoint === 'reminders' ? { rules: [], occurrences: [] }
      : req.endpoint === 'health' ? { capabilities: [] } : req.endpoint === 'memory' ? { items: [], total: 0, matched: 0 } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let module, Panel; win.__ModuleLoader__ = { load: value => { module = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  module.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  overviewText = container.textContent;
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：日程'));
  expect(card).toBeTruthy(); card.focus(); expect(win.document.activeElement).toBe(card); await act(async () => card.click());
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
const button = text => [...(container.querySelector('[data-testid=calendar-detail]') || container).querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); };
const control = label => [...container.querySelectorAll('label')].find(node => node.textContent.startsWith(label))?.control;
const change = async (node, value) => { expect(node).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value').set.call(node, value); node.dispatchEvent(new win.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); };

it.each(['light', 'dark'])('%s 桌面：下一场、完整性、筛选分页与原对象草稿使用真实响应', async theme => {
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 1280, height: 800 });
  const next = container.querySelector('[data-testid=calendar-next]');
  expect(next).toBeTruthy(); expect(next.textContent).toContain('进行中的设计评审'); expect(next.textContent).toContain('进行中'); expect(next.textContent).toContain('本人组织');
  expect(container.querySelector('[data-testid=calendar-metrics]').textContent).toContain('今日可展示');
  expect(container.querySelectorAll('[data-testid=source-query-state]')).toHaveLength(1);
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('来源范围未完整核验');
  expect(container.textContent).toContain('参与关系下一页无权'); expect(container.textContent).toContain('最近完整');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  await click('下一页'); expect(container.textContent).toContain('后一页安排'); expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.offset).toBe(20);
  await change(control('参与范围'), 'all');
  expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload).toMatchObject({ role: 'all', offset: 0 });
  await click('改期'); const draft = container.querySelector('textarea[aria-label="日程对话内容"]');
  expect(draft.value).toContain('sourceId=project'); expect(draft.value).toContain('eventId=event-1'); expect(draft.value).toContain('objectId=object-0'); expect(draft.value).toContain('重复日程');
  expect(win.document.activeElement).toBe(draft); expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  const verify = button('核验日历'); verify.focus(); expect(win.document.activeElement).toBe(verify);
  failed = true; await click('核验日历'); expect(container.querySelector('[role=alert]').textContent).toContain('原平台离线'); expect(container.textContent).toContain('项目讨论');
  failed = false; await click('核验日历'); expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('本次已核验');
});

it('核验期间禁止再次提交；工作区切换后忽略旧结果并清空旧对话草稿', async () => {
  let finish; const old = response({}, true); old.events[0].summary = '迟到的旧工作区结果'; old.next.summary = '迟到的旧工作区结果';
  pending = new Promise(resolve => { finish = resolve; });
  await click('改期'); await click('核验日历'); expect(button('核验中…').disabled).toBe(true);
  binding = 'binding-b'; await act(async () => { await poll(); });
  expect(container.querySelector('textarea[aria-label="日程对话内容"]')).toBeNull();
  await act(async () => { finish({ ok: true, json: async () => ({ ok: true, value: old }) }); });
  expect(container.textContent).not.toContain('迟到的旧工作区结果'); expect(requests.filter(req => req.payload.type === 'calendar.verify')).toHaveLength(1);
});

it('全天与跨日按原时区显示，同名对象不合并且保留多来源角色和已知冲突', async () => {
  const sources = [{ sourceId: 'project', name: '项目日历', platform: 'feishu', filter: 'involved', state: 'complete', fresh: false, checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: '2026-10-23T00:00:00Z' }, { sourceId: 'personal', name: '个人日历', platform: 'feishu', filter: 'all', state: 'complete', fresh: false, checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: '2026-10-23T00:00:00Z' }];
  const allDay = event({ objectId: 'all-day', eventId: 'all-day-native', summary: '跨日全天安排', allDay: true, start: '2026-10-22T16:00:00Z', end: '2026-10-24T16:00:00Z', locations: [location('personal', 'all-day-native')] });
  const crossA = event({ objectId: 'cross-a', eventId: 'cross-a-native', summary: '同名跨日安排', start: '2026-10-23T15:30:00Z', end: '2026-10-24T01:00:00Z', locations: [location('project', 'cross-a-native')] });
  const crossB = event({ objectId: 'cross-b', eventId: 'cross-b-native', summary: '同名跨日安排', start: '2026-10-23T15:30:00Z', end: '2026-10-24T02:00:00Z', locations: [{ ...location('personal', 'cross-b-native'), roles: { complete: true, values: ['participant'] } }] });
  calendarResponse = () => ({ workspaceBinding: binding, sources, events: [allDay, crossA, crossB], next: null, conflicts: [{ a: 'cross-a', b: 'cross-b', aSummary: '同名跨日安排', bSummary: '同名跨日安排' }], fresh: false, complete: true, count: 3, total: 3, hasMore: false });
  await click('刷新');
  const rows = [...container.querySelectorAll('[data-testid=calendar-event]')]; expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain('全天'); expect(rows[0].textContent).toContain('2026-10-23 至 2026-10-24'); expect(rows[0].textContent).not.toContain('00:00');
  expect(rows[1].textContent).toContain('2026-10-23 23:30 → 2026-10-24 09:00'); expect(rows[1].textContent).toContain('项目日历'); expect(rows[1].textContent).toContain('本人组织');
  expect(rows[2].textContent).toContain('个人日历'); expect(rows[2].textContent).toContain('本人参与');
  expect(rows[1].textContent).toContain('已知时间冲突'); expect(rows[2].textContent).toContain('已知时间冲突');
  expect(container.textContent).not.toContain('位参会人'); expect(container.textContent).not.toContain('非助理创建'); expect(container.textContent).not.toContain('地点：');
  await click('后一天'); expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.date).toBe('2026-10-24');
  await click('前一天'); expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.date).toBe('2026-10-23');
  await change(control('日期'), '2026-10-21'); expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.date).toBe('2026-10-21');
  await click('今天'); expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.date).toBe('2026-10-23');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});

it('创建、改期、取消和仅取消提醒都立即聚焦草稿，不自动发送或直接写入', async () => {
  await click('创建日程'); let draft = container.querySelector('textarea[aria-label="日程对话内容"]');
  expect(draft.value).toContain('日期：2026-10-23'); expect(draft.value).toContain('主题和起止时间：请补充'); expect(win.document.activeElement).toBe(draft);
  await change(control('日历来源'), 'project'); await click('创建日程');
  expect(draft.value).toContain('sourceId=project'); expect(draft.value).not.toContain('eventId=');
  await click('改期'); expect(draft.value).toContain('sourceId=project'); expect(draft.value).toContain('eventId=event-1'); expect(draft.value).toContain('objectId=object-0');
  await click('取消日程'); expect(draft.value).toContain('取消日程'); expect(draft.value).toContain('eventId=event-1'); expect(draft.value).toContain('objectId=object-0');
  await click('仅取消本人提醒'); expect(draft.value).toContain('保留会议'); expect(draft.value).toContain('eventId=event-1');
  expect(win.document.activeElement).toBe(draft); expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});

it('来源目录失败与结构错误可见，重试恢复目录且不清空日程证据', async () => {
  sourceFailed = true; await click('核验日历');
  expect(container.textContent).toContain('来源目录加载失败：来源服务离线'); expect(container.textContent).toContain('项目讨论'); expect(container.textContent).toContain('最近完整');
  sourceFailed = false; await click('重试加载来源');
  expect(container.textContent).not.toContain('来源目录加载失败'); expect([...control('日历来源').options].map(row => row.value)).toEqual(['', 'project', 'personal']);
  sourceFailed = 'shape'; await click('核验日历');
  expect(container.textContent).toContain('来源目录加载失败：日历来源响应不完整'); expect(container.textContent).toContain('项目讨论');
});

it('单来源核验后重读全来源普通保存观察，不用单来源响应覆盖其他来源', async () => {
  let projectState = 'failed';
  const sourceRows = () => [{ sourceId: 'project', name: '项目日历', platform: 'feishu', filter: 'involved', state: projectState, fresh: false, reason: projectState === 'failed' ? '项目日历无权' : null, checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: '2026-10-22T00:00:00Z' }, { sourceId: 'personal', name: '个人日历', platform: 'feishu', filter: 'all', state: 'complete', fresh: false, checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: '2026-10-23T00:00:00Z' }];
  const projectEvent = event({ objectId: 'project-saved', summary: '项目保存观察' }), personalEvent = event({ objectId: 'personal-saved', summary: '个人保存观察', locations: [location('personal', 'personal-native')] });
  calendarResponse = (payload, verifying) => {
    if (verifying && payload.sourceId === 'project') {
      projectState = 'complete';
      return { workspaceBinding: binding, sources: [sourceRows()[0]], events: [event({ objectId: 'single-response', summary: '单来源临时响应' })], next: null, conflicts: [], fresh: true, complete: true, count: 1, total: 1, hasMore: false };
    }
    const rows = sourceRows(), complete = rows.every(row => row.state === 'complete');
    return { workspaceBinding: binding, sources: rows, events: [projectEvent, personalEvent], next: null, conflicts: [], fresh: false, complete, count: 2, total: complete ? 2 : null, hasMore: false };
  };
  await click('刷新'); expect(container.textContent).toContain('部分来源核验失败'); expect(container.textContent).toContain('项目日历无权');
  await click('重试项目日历');
  const verifyRequests = requests.filter(req => req.endpoint === 'action' && req.payload.type === 'calendar.verify'); expect(verifyRequests).toHaveLength(1); expect(verifyRequests[0].payload.sourceId).toBe('project');
  const ordinaryRead = requests.slice(requests.indexOf(verifyRequests[0]) + 1).find(req => req.endpoint === 'calendar'); expect(ordinaryRead).toBeTruthy(); expect(ordinaryRead.payload.sourceId).toBeUndefined();
  expect(container.textContent).toContain('项目保存观察'); expect(container.textContent).toContain('个人保存观察'); expect(container.textContent).not.toContain('单来源临时响应');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('保存的完整观察');
  expect(container.querySelector('[data-testid=source-scope-panel]').textContent).toContain('项目日历'); expect(container.querySelector('[data-testid=source-scope-panel]').textContent).toContain('个人日历');
});

it('普通读取失败保留同筛选旧观察，新筛选无旧数据时不冒充空结果', async () => {
  readFailed = true; await click('刷新');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('读取失败，以下保留旧观察'); expect(container.textContent).toContain('项目讨论');
  expect(container.querySelectorAll('[data-testid=source-query-state]')).toHaveLength(1);
  readFailed = false; await click('重试读取'); expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('来源范围未完整核验');
  readFailed = true; await change(control('参与范围'), 'all');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('日程读取失败'); expect(container.textContent).not.toContain('项目讨论');
  expect(container.querySelector('[data-testid=calendar-metrics]')).toBeNull(); expect(container.textContent).not.toContain('当前没有可展示日程');
  expect(container.querySelector('[data-testid=source-scope-panel]').textContent).toContain('来源查询证据尚未取得'); expect(container.querySelector('[data-testid=source-scope-panel]').textContent).not.toContain('尚未登记来源');
  readFailed = false; await click('重试读取'); expect(container.textContent).toContain('项目讨论');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});

it('筛选请求键与 epoch 隔离迟到响应，等待时不把旧结果挂到新日期', async () => {
  let release;
  calendarResponse = payload => {
    const result = response(payload, false), marker = payload.date === '2026-10-25' ? '新日期结果' : payload.date === '2026-10-24' ? '迟到的旧筛选' : '当前日期结果';
    result.events[0].summary = marker; result.next.summary = marker; return result;
  };
  readBarrier = req => req.payload.date === '2026-10-24' ? new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ ok: true, value: calendarResponse(req.payload) }) }); }) : null;
  await change(control('日期'), '2026-10-24');
  expect(container.textContent).not.toContain('项目讨论'); expect(container.querySelector('[data-testid=calendar-metrics]')).toBeNull();
  await change(control('日期'), '2026-10-25'); expect(container.textContent).toContain('新日期结果');
  await act(async () => release());
  expect(container.textContent).toContain('新日期结果'); expect(container.textContent).not.toContain('迟到的旧筛选');
  expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.date).toBe('2026-10-25');
});

it('真实空、无匹配、保存完整观察、未核验、部分失败和无来源分别呈现', async () => {
  let scenario = 'saved';
  calendarResponse = (_payload, verifying) => {
    const complete = scenario === 'saved' || scenario === 'fresh', fresh = scenario === 'fresh' && verifying, sources = scenario === 'none' ? []
      : [{ sourceId: 'project', name: '项目日历', platform: 'feishu', filter: 'involved', state: scenario === 'partial' ? 'failed' : scenario === 'unverified' ? 'unverified' : 'complete', fresh, reason: scenario === 'partial' ? '项目日历无权' : scenario === 'unverified' ? '尚未核验本时间窗口' : null, checkedAt: scenario === 'unverified' ? null : '2026-10-23T00:00:00Z', lastCompleteAt: complete ? '2026-10-23T00:00:00Z' : null }];
    return { workspaceBinding: binding, sources, events: [], next: null, conflicts: [], fresh, complete, count: 0, total: complete ? 0 : null, hasMore: false };
  };
  await click('刷新');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('保存的完整观察'); expect(container.textContent).toContain('保存的完整观察为空');
  await change(control('搜索日程'), '没有匹配'); expect(container.textContent).toContain('保存的完整观察中没有匹配');
  scenario = 'fresh'; await click('核验日历');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('本次已核验'); expect(container.textContent).toContain('当前筛选没有匹配日程');
  await change(control('搜索日程'), ''); await click('核验日历'); expect(container.textContent).toContain('该日没有日程');
  scenario = 'unverified'; await click('刷新');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('来源范围未完整核验'); expect(container.textContent).toContain('当前没有可展示日程'); expect(container.textContent).not.toContain('该日没有日程');
  scenario = 'partial'; await click('刷新');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('部分来源核验失败'); expect(container.textContent).toContain('项目日历无权');
  expect(container.querySelectorAll('[data-testid=source-query-state]')).toHaveLength(1);
  scenario = 'none'; await click('刷新');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('尚未登记日历来源'); expect(container.querySelector('[data-testid=source-scope-panel]').textContent).toContain('尚未登记来源');
});

it('总览卡直接呈现服务端下一场、可展示数量与查询完整性', () => {
  expect(overviewText).toContain('21 项（当前可展示）'); expect(overviewText).toContain('进行中'); expect(overviewText).toContain('进行中的设计评审');
  expect(overviewText).toContain('查询完整性'); expect(overviewText).toContain('范围不完整');
});

it('只有已开始未结束标进行中，未来对象仍标下一场', async () => {
  const result = response({}, false);
  result.next = event({ objectId: 'future-next', summary: '未来评审', start: '2026-10-23T04:00:00Z', end: '2026-10-23T05:00:00Z', locations: [location('project', 'future-native')] });
  calendarResponse = () => result; await click('刷新');
  const next = container.querySelector('[data-testid=calendar-next]'); expect(next.textContent).toContain('未来评审'); expect(next.textContent).toContain('下一场'); expect(next.textContent).not.toContain('进行中');
});
