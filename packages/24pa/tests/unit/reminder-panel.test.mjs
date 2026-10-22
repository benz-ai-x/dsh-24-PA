import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
let React, act, createRoot, win, root, container;
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
it.each(['light', 'dark'])('%s 窄屏提醒 DOM 保留实际日历归属，首次时间不冒充下次，键盘可刷新错误状态', async theme => {
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 390, height: 844 });
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body);
    if (req.endpoint === 'reminders' && failed) return { ok: true, json: async () => ({ ok: false, error: { message: '账本读取失败' } }) };
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace', config: { ...DEFAULT_CONFIG, notifyChannel: 'feishu' } }, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'reminders' ? { rules: [{ ruleId: 'rmd-calendar', kind: 'daily', text: '检查预算', status: 'delegated', calendarChannel: 'wecom', eventId: 'wecom-event-1', firstStart: '2026-10-19T01:00:00Z', nextDueAt: null, timeZone: 'Asia/Shanghai', expression: 'daily 09:00:00' }], occurrences: [] }
      : req.endpoint === 'calendar' ? { sources: [], conflicts: [], events: [], count: 0, total: null, fresh: false, message: '尚未核验', hasMore: false }
      : req.endpoint === 'sources' ? { entries: [] }
      : req.endpoint === 'health' ? { capabilities: [] } : req.endpoint === 'memory' ? { items: [], total: 0, matched: 0 } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let mod, Panel; win.localStorage.clear(); win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  mod.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({
    effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} },
  });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：日程'));
  expect(card).toBeTruthy(); card.focus(); expect(win.document.activeElement).toBe(card); await act(async () => card.click());
  expect(container.textContent).toContain('企微日历'); expect(container.textContent).toContain('wecom-event-1'); expect(container.textContent).toContain('日历 App 提醒');
  expect(container.textContent).toContain('首次安排'); expect(container.textContent).not.toContain('下次触发'); expect(container.textContent).not.toContain('投递出口：飞书');
  const refresh = [...container.querySelectorAll('button')].find(node => node.textContent === '刷新'); refresh.focus(); expect(win.document.activeElement).toBe(refresh);
  failed = true; await act(async () => refresh.click()); expect(container.querySelector('[role=alert]').textContent).toContain('账本读取失败');
});
