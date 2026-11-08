import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
let React, act, createRoot, win, root, container, requests, state, offline, language;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const field = text => [...container.querySelectorAll('label')].find(node => node.textContent.includes(text))?.querySelector('input');
beforeEach(async () => {
  language = 'zh'; offline = false; requests = []; win.localStorage.clear();
  state = { binding: null, bindings: [], phase: 'unbound', loginPhase: 'idle', candidate: null, verified: false, inbox: [], deliveries: [], workspaceBinding: 'binding-a' };
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(1); vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req); let value = {};
    if (req.endpoint === 'snapshot') value = { workspace: { path: '/wx-test', config: DEFAULT_CONFIG }, workspaceBinding: 'binding-a', work: [], outbox: [], readiness: { items: [] }, weixin: state };
    if (req.endpoint === 'weixin') {
      if (offline) return { ok: true, json: async () => ({ ok: false, error: { message: '微信状态读取离线' } }) };
      value = structuredClone(state);
    }
    if (req.endpoint === 'action' && req.payload.type === 'weixin.change') {
      if (req.payload.action === 'login') Object.assign(state, { loginPhase: 'candidate', candidate: { id: 'candidate', accountId: 'test-bot', ownerId: 'test-owner' } });
      value = req.payload.action === 'preview' ? { workspaceBinding: 'binding-a', previewId: 'preview-a', action: 'activate', candidate: state.candidate,
        impact: { inbox: ['original-input'], work: [], deliveries: [3], unknown: [3] } } : structuredClone(state);
    }
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let mod, Panel; win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', source)(win, win.document, win.navigator);
  mod.factory(() => React).apply({ effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: value => value[language], subscribe: () => () => {}, getSnapshot: () => language },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container); await act(async () => root.render(React.createElement(Panel)));
  await click(container.querySelector('#pa24-tab-setup'));
  await click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：微信 ClawBot')));
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
it('查看未绑定状态不发起登录，候选身份与影响预览后才可明确启用', async () => {
  expect(container.textContent).toContain('尚未绑定'); expect(requests.filter(row => row.endpoint === 'action')).toEqual([]);
  await click(button('扫码绑定微信')); expect(container.textContent).toContain('test-owner');
  await click(button('预览启用此身份')); expect(container.textContent).toContain('1 条输入'); expect(container.textContent).toContain('1 条发送待核对');
  expect(button('确认应用').disabled).toBe(true); await click(field('我已核对身份与上述影响')); await click(button('确认应用'));
  expect(requests.at(-1).payload).toMatchObject({ action: 'apply', previewId: 'preview-a', confirm: true, workspaceBinding: 'binding-a' });
});
it('未知投递只能核对收到或明确补投，保留原身份与修订并要求本人依据', async () => {
  state.deliveries = [{ id: 13, revision: 4, binding_generation: 'original-generation', status: 'unknown', target: 'original-owner', content: { text: '原业务结果' }, association: { workItemId: 'work-original' } }];
  await click(button('刷新状态')); expect(container.textContent).toContain('original-owner'); expect(button('放弃未发送投递')).toBeUndefined();
  await click(button('我已收到')); expect(button('保存核对').disabled).toBe(true);
  await act(async () => { const input = field('本人核对依据'); Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(input, '本人已看到原文'); input.dispatchEvent(new win.Event('input', { bubbles: true })); });
  await click(field('我已核对原记录')); await click(button('保存核对'));
  expect(requests.at(-1).payload).toMatchObject({ action: 'delivery', op: 'received', id: 13, revision: 4, generation: 'original-generation', evidence: '本人已看到原文', confirm: true });
});
it('离线不显示仍在收信，二维码隐藏且写操作停用；刷新恢复', async () => {
  Object.assign(state, { phase: 'polling', qrImage: 'data:image/png;base64,test', loginPhase: 'wait' });
  await click(button('刷新状态')); expect(container.querySelector('img')).toBeTruthy();
  offline = true; await click(button('刷新状态'));
  expect(container.textContent).toContain('状态读取失败'); expect(container.querySelector('img')).toBeNull(); expect(button('扫码绑定微信').disabled).toBe(true);
  offline = false; await click(button('刷新状态')); expect(button('扫码绑定微信').disabled).toBe(false);
});
it('英文入口和状态有对应文案，按钮保留原生键盘语义', async () => {
  language = 'en'; await click(button('刷新状态'));
  expect(container.textContent).toContain('WeChat ClawBot'); expect(container.textContent).toContain('Not bound'); expect(button('Bind WeChat').tagName).toBe('BUTTON');
  expect(container.querySelector('[data-testid="weixin-detail"] svg').getAttribute('aria-hidden')).toBe('true');
});
