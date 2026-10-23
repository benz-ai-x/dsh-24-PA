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
const row = (id, patch = {}) => ({ id, category: 'fact', topic: '项目记忆 ' + id, content: '可阅读的完整正文 ' + id, source: '本人明确指令', status: 'confirmed', lifecycle: 'active', confirmation: { kind: 'owner_instruction', text: '我明确确认此项', at: '2026-10-23T00:00:00Z', by: 'local-owner' }, updatedAt: '2026-10-23T00:00:00Z', updatedBy: 'local-owner', reason: '本人维护', effective: { lifecycle: 'active', freshness: 'current', confirmation: 'verified', conflict: 'none', useAs: 'fact', relatedIds: [] }, ...patch });
let rows, requestsBefore, selectedSession;
const response = payload => {
  const matched = rows.filter(record => (!payload.query || record.content.includes(payload.query)) && (!payload.lifecycle || record.lifecycle === payload.lifecycle) && (!payload.freshness || record.effective.freshness === payload.freshness));
  return { workspaceBinding: binding, revision: 12, total: rows.length, matched: matched.length, offset: payload.offset || 0, limit: 20, trackedRevision: 'tracked', counts: { facts: rows.length - 1, clues: 0, inactive: 0, recycled: 1, conflicts: 0, permanent: 2 }, records: matched.slice(payload.offset || 0, (payload.offset || 0) + 20) };
};
beforeEach(async () => {
  requests = []; binding = 'binding-a'; failed = false; pending = null; selectedSession = null; win.localStorage.clear();
  rows = Array.from({ length: 23 }, (_, index) => row('r' + index));
  rows[0] = row('r0', { lifecycle: 'recycled', sourceCheck: { state: 'unavailable', checkedAt: '2026-10-23T00:00:00Z', evidence: '只读检查返回 403' }, effective: { lifecycle: 'recycled', freshness: 'expired', confirmation: 'missing', conflict: 'none', useAs: 'excluded', relatedIds: [] } });
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'memory') {
      if (pending && Object.hasOwn(req.payload, 'query')) return pending;
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '记忆服务离线' } }) };
    }
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'memory' ? response(req.payload)
      : req.endpoint === 'memory.history' ? { workspaceBinding: binding, revision: 12, id: req.payload.id, revisions: [{ id: 'CS-12', resultingRevision: 12, appliedAt: '2026-10-23T00:00:00Z', appliedBy: 'local-owner', reason: '更新当前偏好', before: { content: '旧的完整正文' }, after: { content: '新的完整正文' }, undoable: true }] }
      : req.endpoint === 'action' && req.payload.type === 'robot.open' ? { sessionId: 'local-owner' }
      : req.endpoint === 'reminders' ? { rules: [], occurrences: [] }
      : req.endpoint === 'health' ? { capabilities: [] } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let module, Panel; win.__ModuleLoader__ = { load: value => { module = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  module.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: id => { selectedSession = id; } } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  const knowledge = container.querySelector('#pa24-tab-knowledge');
  expect(knowledge).toBeTruthy(); await act(async () => knowledge.click());
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：结构化记忆'));
  expect(card).toBeTruthy(); card.focus(); expect(win.document.activeElement).toBe(card); await act(async () => card.click());
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); };

const field = text => [...container.querySelectorAll('label')].find(node => node.childNodes[0]?.textContent === text)?.querySelector('select,input');
const change = async (element, value) => { expect(element).toBeTruthy(); await act(async () => { const prototype = element.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new win.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); };

it.each(['light', 'dark'])('%s：完整正文、确认/来源/时效分开，历史与筛选分页只读，维护携带完整身份', async theme => {
  if (theme === 'dark') win.document.body.setAttribute('data-ds-dark-theme', ''); else win.document.body.removeAttribute('data-ds-dark-theme'); win.happyDOM.setWindowSize({ width: 390, height: 844 });
  expect(container.textContent).toContain('共 23 条 · 匹配 23 条'); expect(container.textContent).toContain('可阅读的完整正文 r0'); expect(container.textContent).toContain('来源不可访问'); expect(container.textContent).toContain('不代表事实已被推翻');
  await click('下一页'); expect(container.textContent).toContain('可阅读的完整正文 r22'); expect(requests.filter(req => req.endpoint === 'memory').at(-1).payload.offset).toBe(20);
  await change(field('使用状态'), 'recycled'); expect(container.textContent).toContain('共 23 条 · 匹配 1 条'); expect(requests.filter(req => req.endpoint === 'memory').at(-1).payload).toMatchObject({ lifecycle: 'recycled', offset: 0, workspaceBinding: 'binding-a' });
  await click('查看修订'); expect(container.textContent).toContain('旧的完整正文'); expect(container.textContent).toContain('新的完整正文');
  await click('维护此记忆'); let draft = container.querySelector('textarea[aria-label="记忆对话内容"]'); expect(draft.value).toContain('expectedRevision=12'); expect(draft.value).toContain('id=r0'); expect(draft.value).toContain('可阅读的完整正文 r0');
  await change(field('维护操作'), 'purge'); draft = container.querySelector('textarea[aria-label="记忆对话内容"]'); expect(draft.value).toContain('永久删除这条已回收记忆及可恢复版本'); expect(draft.value).toContain('既有备份另行处理');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  const clipboard = []; vi.spyOn(win.navigator.clipboard, 'writeText').mockImplementation(async text => { clipboard.push(text); });
  await click('复制并打开本地对话'); expect(clipboard[0]).toBe(draft.value); expect(selectedSession).toBe('local-owner'); expect(requests.filter(req => req.endpoint === 'action').map(req => req.payload.type)).toEqual(['robot.open']);
});

it('空库、无匹配和失败分别显示，刷新失败保留同筛选旧结果且标明未核实', async () => {
  failed = true; await click('刷新记忆'); expect(container.querySelector('[role=alert]').textContent).toContain('记忆服务离线'); expect(container.textContent).toContain('上次读取结果'); expect(container.textContent).toContain('可阅读的完整正文 r0');
  await change(field('使用状态'), 'inactive'); expect(container.textContent).not.toContain('可阅读的完整正文 r0'); expect(container.textContent).not.toContain('从「记住这件事」开始');
  failed = false; await click('重试读取'); expect(container.textContent).toContain('没有找到匹配的记忆'); expect(container.textContent).not.toContain('从「记住这件事」开始');
  rows = []; await click('刷新记忆'); expect(container.textContent).toContain('从「记住这件事」开始'); expect(container.textContent).not.toContain('没有找到匹配的记忆');
});

it('工作区切换销毁旧维护草稿并忽略延迟查询；键盘可聚焦主操作', async () => {
  const refresh = button('刷新记忆'); refresh.focus(); expect(win.document.activeElement).toBe(refresh);
  await click('维护此记忆'); let finish; const stale = response({}); stale.records = [row('stale', { content: '迟到旧工作区内容' })]; pending = new Promise(resolve => { finish = resolve; });
  await click('刷新记忆'); binding = 'binding-b'; pending = null; await act(async () => { await poll(); });
  expect(container.querySelector('textarea[aria-label="记忆对话内容"]')).toBeNull();
  await act(async () => finish({ ok: true, json: async () => ({ ok: true, value: stale }) }));
  expect(container.textContent).not.toContain('迟到旧工作区内容');
  await act(async () => container.querySelector('#pa24-tab-knowledge').click());
  await act(async () => [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：结构化记忆')).click());
  expect(requests.filter(req => req.endpoint === 'memory' && Object.hasOwn(req.payload, 'query')).at(-1).payload.workspaceBinding).toBe('binding-b');
});
