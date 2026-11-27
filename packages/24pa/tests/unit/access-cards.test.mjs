// The note under the two access cards (#306, #307): it points the owner at the
// host's Plugins page for linking the app and signing in, and says where the
// CLI came from only when the access check reported a source. Before a check,
// and when the CLI is missing, there is none to name; saying one then would
// contradict the card's own error line.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../../lib/config.js';
let React, createRoot, act, win, root, container, Panel, diagnostics, wecom;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
const config = { ...DEFAULT_CONFIG, mode: 'feishu', ownerOpenId: 'ou-owner' };
const snapshot = () => ({ workspace: { path: '/test/binding-a', config, sourceHash: 'saved-1', configVersion: 'config-1' }, workspaceBinding: 'binding-a',
  configMeta: { fields: CONFIG_FIELDS }, wecom, diagnostics, work: [], outbox: [], secrets: {}, readiness: { items: [] }, transport: { connected: true } });
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const openCard = async text => click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith(`：${text}`)));
const noteAbout = text => [...container.querySelectorAll('.pa24-helper')].map(node => node.textContent).find(value => value.includes(text)) ?? null;
const FEISHU_PAGE = '关联应用与登录由本人在宿主「插件」页的「飞书插件」里完成，这里只显示只读检查的结果。';
const WECOM_PAGE = '连接企业微信由本人在宿主「插件」页的「企业微信插件」里完成。';
const feishuCheck = (cli, state = 'ok') => ({ checkedAt: '2026-11-26T07:40:06.000Z', source: { state: 'ok', message: '一致' }, cli,
  auth: { state, message: '身份' }, resources: [], nextSteps: [] });
const wecomCheck = cli => ({ checkedAt: '2026-11-26T07:40:06.000Z', cli, identity: { state: 'missing', message: '未解析。' }, services: [], nextSteps: [] });

beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => { wecom = undefined; diagnostics = undefined; win.localStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

/** Open the panel with the snapshot as the variables above describe it, and go to the setup tab. */
async function openPanel() {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); let value;
    if (req.endpoint === 'snapshot' || req.endpoint === 'action') value = snapshot();
    else if (req.endpoint === 'health') value = { capabilities: [], connectionEvidence: { evidence: [] } };
    else if (req.endpoint === 'memory') value = { items: [], total: 0 };
    else if (req.endpoint === 'digests') value = { plans: [], skills: [] };
    else if (req.endpoint === 'sources') value = { entries: [] };
    else value = {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let mod; win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', source)(win, win.document, win.navigator);
  mod.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  await click(container.querySelector('#pa24-tab-setup'));
}

describe('接入卡的说明：只在检查报出来源时才说 CLI 来自哪里', () => {
  it.each([
    ['尚未检查', undefined, ''],
    ['检查因 CLI 缺失而失败', feishuCheck({ state: 'error', message: '需要官方飞书插件提供的 lark-cli' }, 'error'), ''],
    ['官方连接器提供', feishuCheck({ state: 'ok', message: 'CLI 可执行', source: 'official' }), 'lark-cli 由官方飞书插件提供；'],
    ['插件行给出', feishuCheck({ state: 'ok', message: 'CLI 可执行', source: 'config' }), 'lark-cli 由24私助插件行给出；'],
    ['PATH 上找到', feishuCheck({ state: 'ok', message: 'CLI 可执行', source: 'path' }), 'lark-cli 来自宿主的 PATH；'],
  ])('飞书卡（%s）：来源只在检查报出来源时出现，插件页那句话总在', async (_label, check, origin) => {
    diagnostics = check;
    await openPanel(); await openCard('飞书');
    expect(noteAbout(FEISHU_PAGE)).toBe(`${origin}${FEISHU_PAGE}`);
  });

  it('飞书卡：CLI 缺失时同一张卡上的报错说的是要装官方插件，说明里不另立一个来源', async () => {
    diagnostics = feishuCheck({ state: 'error', message: '需要官方飞书插件提供的 lark-cli' }, 'error');
    await openPanel(); await openCard('飞书');
    expect(container.textContent).toContain('需要官方飞书插件提供的 lark-cli');
    expect(noteAbout(FEISHU_PAGE)).not.toContain('lark-cli 由');
  });

  it.each([
    ['官方连接器提供', { state: 'ok', message: 'wecom-cli 1.0', source: 'official' }, 'wecom-cli 由官方企业微信插件提供；'],
    ['插件行给出', { state: 'ok', message: 'wecom-cli 1.0', source: 'config' }, 'wecom-cli 由24私助插件行给出；'],
    ['CLI 缺失', { state: 'error', message: '需要官方企业微信插件提供的 wecom-cli' }, ''],
  ])('企业微信卡（%s）：同一规则', async (_label, cli, origin) => {
    wecom = wecomCheck(cli);
    await openPanel(); await openCard('企业微信');
    expect(noteAbout(WECOM_PAGE)).toBe(`${origin}${WECOM_PAGE}`);
  });
});
