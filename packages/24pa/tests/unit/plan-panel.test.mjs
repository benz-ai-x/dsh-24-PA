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
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
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

for (const theme of ['light', 'dark']) it.each(['digest.run-now', 'digest.reschedule', 'digest.set-voice', 'digest.set-skill'])(`${theme} 窄屏计划草稿经两次轮询保留，%s 不重入且错误/确认可见`, async action => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 390, height: 844 });
  const plans = ['first', 'second'].map(planId => ({ planId, kind: 'morning', title: planId, status: 'active', skill: 'digest-morning', voice: false, schedule: { daily: { time: '08:00:00', time_zone: 'America/New_York' } } }));
  const requests = []; let release, blocked = true;
  const delayed = new Promise(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body);
    if (req.endpoint === 'action') {
      requests.push(req.payload);
      if (req.payload.planId === 'first' && blocked) { blocked = false; return delayed; }
      const plan = plans.find(row => row.planId === req.payload.planId);
      if (req.payload.type === 'digest.reschedule') plan.schedule.daily.time = '09:31:00';
      if (req.payload.type === 'digest.set-voice') plan.voice = req.payload.voice;
      if (req.payload.type === 'digest.set-skill') plan.skill = req.payload.skill;
      return { ok: true, json: async () => ({ ok: true, value: { message: '服务端确认' } }) };
    }
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace', config: DEFAULT_CONFIG }, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'digests' ? { plans: structuredClone(plans), skills: [{ name: 'digest-morning', track: 'template' }, { name: 'digest-weekly', track: 'template' }] }
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
  await act(async () => [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：晨报与复盘')).click());
  const row = () => [...container.querySelectorAll('article')].find(node => node.querySelector('h3')?.textContent === 'first');
  const field = row().querySelector('input'); field.focus(); expect(win.document.activeElement).toBe(field);
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(field, '09:30:00'); field.dispatchEvent(new win.Event('input', { bubbles: true })); });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(row().querySelector('input')).toBe(field); expect(field.value).toBe('09:30');
  const fire = async () => act(async () => {
    if (action === 'digest.set-skill') { const select = row().querySelector('select'); select.value = 'digest-weekly'; select.dispatchEvent(new win.Event('change', { bubbles: true })); }
    else [...row().querySelectorAll('button')].find(node => node.textContent === ({ 'digest.run-now': '立即运行一次', 'digest.reschedule': '保存', 'digest.set-voice': '开语音' }[action])).click();
  });
  await fire(); await act(async () => vi.advanceTimersByTimeAsync(5000)); await fire();
  expect(requests.filter(req => req.planId === 'first')).toHaveLength(1);
  expect(field.disabled).toBe(true);
  const second = [...container.querySelectorAll('article')].find(node => node.querySelector('h3')?.textContent === 'second');
  await act(async () => [...second.querySelectorAll('button')].find(node => node.textContent === '立即运行一次').click());
  expect(requests.filter(req => req.planId === 'second')).toHaveLength(1);
  await act(async () => release({ ok: true, json: async () => ({ ok: false, error: { message: '操作失败，请重试' } }) }));
  expect(row().querySelector('[role=alert]').textContent).toContain('操作失败'); expect(field.value).toBe('09:30');
  await fire(); await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(row().textContent).toContain('服务端确认'); expect(row().querySelector('[role=alert]')).toBeNull();
  expect(field.value).toBe(action === 'digest.reschedule' ? '09:31' : '09:30');
  if (action === 'digest.reschedule') expect(requests[0]).toMatchObject({ time: '09:30:00', timeZone: 'America/New_York' });
});
