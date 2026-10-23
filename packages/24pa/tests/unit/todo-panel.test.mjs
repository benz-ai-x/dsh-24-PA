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
const entry = { id: 'project', domain: 'todo', name: '项目待办' };
const response = (payload, fresh = false) => ({ workspaceBinding: binding, sources: [{ sourceId: 'project', name: '项目待办', platform: 'feishu', filter: payload.role || 'responsible', state: fresh ? 'complete' : 'partial', reason: fresh ? null : '一个来源未核验', checkedAt: '2026-10-23T00:00:00Z' }],
  tasks: [{ objectId: 'object-1', guid: 'guid-1', summary: payload.offset ? '后一页待办' : '提交方案', status: 'open', dueAt: null, dueDate: null, assignees: [{ id: 'owner', name: '本人' }], url: 'https://task.example/one', workItemIds: ['work-1'],
    locations: [{ sourceId: 'project', sourceName: '项目待办', platform: 'feishu', roles: { complete: true, values: ['responsible'] } }] }],
  counts: { overdue: 2, today: 3, open: 21 }, fresh, complete: fresh, count: 21, total: fresh ? 21 : null, hasMore: !payload.offset, message: fresh ? '已核验 1 个来源' : '当前可展示结果，未完整核验，不能据此判断全部完成' });
beforeEach(async () => {
  requests = []; binding = 'binding-a'; failed = false; pending = null; win.localStorage.clear();
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'action' && req.payload.type === 'todos.verify') {
      if (pending) return pending;
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '原平台离线' } }) };
    }
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'todos' || (req.endpoint === 'action' && req.payload.type === 'todos.verify') ? response(req.payload, req.endpoint === 'action')
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
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：待办'));
  expect(card).toBeTruthy(); card.focus(); expect(win.document.activeElement).toBe(card); await act(async () => card.click());
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); };

it.each(['light', 'dark'])('%s 390px：真实待办、范围缺口、筛选分页及原对象草稿', async theme => {
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 390, height: 844 });
  expect(container.textContent).toContain('不能据此判断全部完成'); expect(container.textContent).toContain('负责人：本人'); expect(container.textContent).toContain('截止：未设置');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  await click('下一页'); expect(container.textContent).toContain('后一页待办'); expect(requests.filter(req => req.endpoint === 'todos').at(-1).payload.offset).toBe(20);
  const role = [...container.querySelectorAll('label')].find(node => node.textContent.startsWith('本人角色')).control;
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(role, 'following'); role.dispatchEvent(new win.Event('change', { bubbles: true })); });
  expect(requests.filter(req => req.endpoint === 'todos').at(-1).payload).toMatchObject({ role: 'following', offset: 0 });
  await click('延期或修改'); const draft = container.querySelector('[data-testid=todo-detail] textarea');
  expect(draft.value).toContain('sourceId=project'); expect(draft.value).toContain('guid=guid-1'); expect(draft.value).toContain('objectId=object-1');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  const verify = button('核验待办'); verify.focus(); expect(win.document.activeElement).toBe(verify);
  failed = true; await click('核验待办'); expect(container.querySelector('[role=alert]').textContent).toContain('原平台离线'); expect(container.textContent).toContain('提交方案');
  failed = false; await click('重试核验'); expect(container.textContent).toContain('已核验 1 个来源');
});
it('核验期间禁止重复提交；工作区切换丢弃旧结果与草稿', async () => {
  let finish; const old = response({}, true); old.message = '迟到的旧工作区结果';
  pending = new Promise(resolve => { finish = resolve; });
  await click('延期或修改'); await click('核验待办'); expect(button('核验中…').disabled).toBe(true);
  binding = 'binding-b'; await act(async () => { await poll(); });
  expect(container.querySelector('[data-testid=todo-detail] textarea')).toBeNull();
  await act(async () => { finish({ ok: true, json: async () => ({ ok: true, value: old }) }); });
  expect(container.textContent).not.toContain('迟到的旧工作区结果'); expect(requests.filter(req => req.payload.type === 'todos.verify')).toHaveLength(1);
});
