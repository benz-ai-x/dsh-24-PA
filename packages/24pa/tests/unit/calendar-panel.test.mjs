import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
let React, act, createRoot, win, root, container, requests, binding, failed, pending, poll;
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const entry = { id: 'project', domain: 'calendar', name: '项目日历' };
const response = (payload, fresh = false) => ({ workspaceBinding: binding, sources: [{ sourceId: 'project', name: '项目日历', platform: 'feishu', filter: payload.role || 'involved', state: fresh ? 'complete' : 'partial', reason: fresh ? null : '一个来源未核验', checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: '2026-10-22T00:00:00Z', unknownRoles: 1 }], conflicts: [],
  events: [{ objectId: `object-${payload.offset || 0}`, eventId: 'event-1', summary: payload.offset ? '后一页安排' : '项目讨论', start: '2026-10-23T01:00:00Z', end: '2026-10-23T02:00:00Z', timezone: 'Asia/Shanghai', recurring: true, stale: !fresh,
    locations: [{ sourceId: 'project', sourceName: '项目日历', roles: { complete: true, values: ['organizer'] }, locator: { eventId: 'event-1', calendarId: 'cal-1', url: 'https://calendar.example/event-1' } }] }],
  fresh, complete: fresh, count: 21, total: fresh ? 21 : null, hasMore: !payload.offset, message: fresh ? '已核验 1 个来源' : '已保存结果，不能认定全部空闲' });
beforeEach(async () => {
  requests = []; binding = 'binding-a'; failed = false; pending = null; win.localStorage.clear();
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'action' && req.payload.type === 'calendar.verify') {
      if (pending) return pending;
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '原平台离线' } }) };
    }
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'calendar' || (req.endpoint === 'action' && req.payload.type === 'calendar.verify') ? response(req.payload, req.endpoint === 'action')
      : req.endpoint === 'sources' ? { entries: [entry] } : req.endpoint === 'reminders' ? { rules: [], occurrences: [] }
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
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：日程'));
  expect(card).toBeTruthy(); card.focus(); expect(win.document.activeElement).toBe(card); await act(async () => card.click());
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); };

it.each(['light', 'dark'])('%s 390px：缓存/失败/完整范围有区别，筛选分页只读，操作带原对象上下文', async theme => {
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 390, height: 844 });
  expect(container.textContent).toContain('已保存结果，不能认定全部空闲'); expect(container.textContent).toContain('参与关系未完整核实');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  await click('下一页'); expect(container.textContent).toContain('后一页安排'); expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload.offset).toBe(20);
  const role = [...container.querySelectorAll('label')].find(node => node.textContent.startsWith('参与范围')).control;
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(role, 'all'); role.dispatchEvent(new win.Event('change', { bubbles: true })); });
  expect(requests.filter(req => req.endpoint === 'calendar').at(-1).payload).toMatchObject({ role: 'all', offset: 0 });
  await click('改期'); const draft = container.querySelector('textarea[aria-label="日程对话内容"]');
  expect(draft.value).toContain('sourceId=project'); expect(draft.value).toContain('eventId=event-1'); expect(draft.value).toContain('重复日程');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  const verify = button('核验日历'); verify.focus(); expect(win.document.activeElement).toBe(verify);
  failed = true; await click('核验日历'); expect(container.querySelector('[role=alert]').textContent).toContain('原平台离线'); expect(container.textContent).toContain('项目讨论');
  failed = false; await click('重试核验'); expect(container.textContent).toContain('已核验 1 个来源');
});

it('核验期间禁止再次提交；工作区切换后忽略旧结果并清空旧对话草稿', async () => {
  let finish; const old = response({}, true); old.message = '迟到的旧工作区结果';
  pending = new Promise(resolve => { finish = resolve; });
  await click('改期'); await click('核验日历'); expect(button('读取中…').disabled).toBe(true);
  binding = 'binding-b'; await act(async () => { await poll(); });
  expect(container.querySelector('textarea[aria-label="日程对话内容"]')).toBeNull();
  await act(async () => { finish({ ok: true, json: async () => ({ ok: true, value: old }) }); });
  expect(container.textContent).not.toContain('迟到的旧工作区结果'); expect(requests.filter(req => req.payload.type === 'calendar.verify')).toHaveLength(1);
});
