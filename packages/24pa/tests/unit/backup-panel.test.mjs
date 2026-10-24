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
let rows, selectedSession;
const record = (id, operation = 'create') => ({ id, operation, status: operation === 'restore_check' ? 'partial' : 'succeeded', backup_dir: '/backups/very-long-directory/' + id, target_dir: null, started_at: '2026-10-23T00:00:00Z', finished_at: '2026-10-23T00:01:00Z', result: { complete: false, message: '实际范围已保存', steps: [{ id: 'ledger', status: 'passed', message: '账本 owner/schema 通过' }, { id: 'sessions', status: 'not_checked', message: '必要会话读取尚未检查' }, { id: 'remote-reconciliation', status: 'required', message: '旧待发先核对' }] } });
beforeEach(async () => {
  requests = []; binding = 'binding-a'; failed = false; pending = null; selectedSession = null; win.localStorage.clear();
  rows = Array.from({ length: 23 }, (_, index) => record('r' + index, ['create', 'verify', 'restore_check'][index % 3]));
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'backups') {
      if (pending) return pending;
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '备份记录离线' } }) };
    }
    const filtered = rows.filter(row => !req.payload.operation || req.payload.operation === 'all' || row.operation === req.payload.operation);
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'backups' ? { total: filtered.length, offset: req.payload.offset || 0, limit: 20, rows: filtered.slice(req.payload.offset || 0, (req.payload.offset || 0) + 20), workspaceBinding: binding }
      : req.endpoint === 'backups.detail' ? { record: rows.find(row => row.id === req.payload.id), workspaceBinding: binding }
      : req.endpoint === 'action' && req.payload.type === 'robot.open' ? { sessionId: 'local-owner' }
      : req.endpoint === 'reminders' ? { rules: [], occurrences: [] } : req.endpoint === 'health' ? { capabilities: [] } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let module, Panel; win.__ModuleLoader__ = { load: value => { module = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  module.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: id => { selectedSession = id; } } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  await act(async () => container.querySelector('#pa24-tab-ops').click());
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：账本与备份'));
  expect(card).toBeTruthy(); await act(async () => card.click());
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const choose = async (label, value) => { const select = [...container.querySelectorAll('label')].find(node => node.textContent.includes(label)).querySelector('select'); await act(async () => { select.value = value; select.dispatchEvent(new win.Event('change', { bubbles: true })); }); };
const fill = async (label, value) => { const input = [...container.querySelectorAll('label')].find(node => node.textContent.includes(label)).querySelector('input'); await act(async () => { const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new win.Event('input', { bubbles: true })); }); };

it('三类持久事实按全量计数分页，查阅步骤不触发维护动作', async () => {
  expect(container.textContent).toContain('共 23 条'); expect(container.textContent).toContain('/r19'); expect(container.textContent).not.toContain('/r20');
  await act(async () => button('下一页').click()); expect(container.textContent).toContain('/r22'); expect(container.textContent).not.toContain('/r0');
  await choose('记录类型', 'restore_check'); expect(container.textContent).toContain('共 7 条');
  await act(async () => button('隔离恢复演练 · 部分检查未通过').click());
  expect(container.textContent).toContain('必要会话读取尚未检查'); expect(container.textContent).toContain('后续必做');
  expect(requests.filter(req => req.endpoint === 'action')).toEqual([]);
});
it('读取失败保留同筛选缓存和重试，切换筛选不能显示旧结果', async () => {
  failed = true; await act(async () => button('刷新记录').click());
  expect(container.textContent).toContain('上次读取缓存'); expect(container.textContent).toContain('/r0');
  await choose('记录类型', 'verify'); expect(container.textContent).toContain('备份记录离线'); expect(container.textContent).not.toContain('/r0');
  failed = false; await act(async () => button('重试记录').click()); expect(container.textContent).toContain('共 8 条');
});
it('空记录与筛选无记录区别展示', async () => {
  rows = []; await act(async () => button('刷新记录').click()); expect(container.textContent).toContain('尚无持久备份记录');
  await choose('记录类型', 'verify'); expect(container.textContent).toContain('当前筛选无记录');
});
it('生成恢复指令只准备文字，预览和显式确认仍由本地会话承接', async () => {
  await choose('操作', 'backup_restore_check'); await fill('备份绝对路径', '/backup/selected'); await fill('全新隔离目录', '/restore/new');
  await act(async () => button('生成维护指令').click());
  const text = container.querySelector('textarea[aria-label="维护指令"]').value;
  expect(text).toContain('backup_preview'); expect(text).toContain('previewToken'); expect(text).toContain('由我确认');
  expect(requests.filter(req => req.endpoint === 'action')).toEqual([]);
  await act(async () => button('打开本地24私助会话').click()); expect(selectedSession).toBe('local-owner');
});
it('工作区切换清除旧列表、详情和维护草稿，旧请求不能覆盖新工作区', async () => {
  await act(async () => button('备份产物 · 本项通过').click());
  let resolve; pending = new Promise(done => { resolve = done; });
  await act(async () => button('刷新记录').click());
  binding = 'binding-b'; rows = [record('new-workspace')]; pending = null;
  await act(async () => poll());
  expect(container.textContent).toContain('/new-workspace'); expect(container.textContent).not.toContain('/r0');
  await act(async () => resolve({ ok: true, json: async () => ({ ok: true, value: { workspaceBinding: 'binding-a', total: 1, rows: [record('late-old')] } }) }));
  expect(container.textContent).not.toContain('late-old'); expect(container.textContent).toContain('/new-workspace');
});
