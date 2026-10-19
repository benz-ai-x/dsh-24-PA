import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let React, act, createRoot, win, root, container;
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
it('计划待核对原因在真实 DOM 中可读，暂停状态不显示可执行按钮；刷新恢复后清除警告', async () => {
  let pending = true;
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body);
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace', config: DEFAULT_CONFIG }, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'digests' ? { plans: [{ planId: 'morning', kind: 'morning', title: '晨报', status: pending ? 'paused' : 'active', skill: 'digest-morning', voice: false, schedule: { daily: { time: '08:00:00', time_zone: 'Asia/Shanghai' } }, pendingChange: pending ? { phase: 'unknown', error: '原生任务待清理：连接失败' } : null }], skills: [{ name: 'digest-morning', track: 'template' }] }
      : req.endpoint === 'health' ? { capabilities: [] } : req.endpoint === 'memory' ? { items: [], total: 0, matched: 0 } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let mod, Panel;
  win.localStorage.clear(); win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  mod.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({
    effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} },
  });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：晨报与复盘'));
  expect(card).toBeTruthy(); await act(async () => card.click());
  expect(container.querySelector('[role=alert]').textContent).toContain('计划变更尚未确认：原生任务待清理：连接失败');
  expect([...container.querySelectorAll('button')].some(node => node.textContent === '立即运行一次')).toBe(false);
  pending = false;
  const refresh = [...container.querySelectorAll('button')].find(node => node.textContent === '刷新');
  await act(async () => refresh.click());
  expect(container.querySelector('[role=alert]')).toBeNull();
  expect([...container.querySelectorAll('button')].some(node => node.textContent === '立即运行一次')).toBe(true);
});
