// The note under the two access cards (#306, #307): it points the owner at the
// host's Plugins page for linking the app and signing in, and says where the
// CLI came from only when the access check reported a source — on a line of its
// own ahead of that sentence, so that in English the two read as two sentences.
// Before a check, and when the CLI is missing, there is none to name; saying
// one then would contradict the card's own error line.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../../lib/config.js';
let React, createRoot, act, win, root, container, Panel, diagnostics, wecom, language;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
const config = { ...DEFAULT_CONFIG, mode: 'feishu', ownerOpenId: 'ou-owner' };
const snapshot = () => ({ workspace: { path: '/test/binding-a', config, sourceHash: 'saved-1', configVersion: 'config-1' }, workspaceBinding: 'binding-a',
  configMeta: { fields: CONFIG_FIELDS }, wecom, diagnostics, work: [], outbox: [], secrets: {}, readiness: { items: [] }, transport: { connected: true } });
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const text = pair => pair[language === 'en' ? 1 : 0];
const openCard = async card => click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：' + text(CARD[card]))));
/** What the note shows: its line about where the CLI came from (null when it shows none) and the sentence about the Plugins page; both undefined when there is no note. */
const note = page => {
  const node = [...container.querySelectorAll('.pa24-helper')].find(item => item.textContent.includes(text(page)));
  return node ? [node.querySelector('.pa24-source-line')?.textContent ?? null, [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join('')] : [undefined, undefined];
};
// [Chinese, English] as the page shows each: the card's title, the sentence about the Plugins page,
// the note's line after the program's name by the source the access check reported, and what a check says when the CLI is missing.
const CARD = { feishu: ['飞书', 'Feishu'], wecom: ['企业微信', 'WeCom'] };
const PAGE = {
  feishu: ['关联应用与登录由本人在宿主「插件」页的「飞书插件」里完成，这里只显示只读检查的结果。', 'Link the app and sign in on that plugin\'s block of the host\'s Plugins page; what shows here is the read-only check.'],
  wecom: ['连接企业微信由本人在宿主「插件」页的「企业微信插件」里完成。', 'Connect WeCom on that plugin\'s block of the host\'s Plugins page.'],
};
const LINE = {
  official: ['由官方连接器提供。', 'comes from the official connector.'],
  config: ['由24私助插件行给出。', 'is named in the 24PA plugin row.'],
  path: ['来自宿主的 PATH。', "is found on the host's PATH."],
};
const MISSING = {
  feishu: ['需要官方飞书插件提供的 lark-cli', 'The official Feishu plugin must provide lark-cli'],
  wecom: ['需要官方企业微信插件提供的 wecom-cli', 'The official WeCom plugin must provide wecom-cli'],
};
const reported = sourceKey => ({ state: 'ok', message: 'CLI 可执行', source: sourceKey });
const feishuCheck = (cli, state = 'ok') => ({ checkedAt: '2026-11-26T07:40:06.000Z', source: { state: 'ok', message: '一致' }, cli, auth: { state, message: '身份' }, resources: [], nextSteps: [] });
const wecomCheck = cli => ({ checkedAt: '2026-11-26T07:40:06.000Z', cli, identity: { state: 'missing', message: '未解析。' }, services: [], nextSteps: [] });

beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => { wecom = undefined; diagnostics = undefined; win.localStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

/** Open the panel with the snapshot as the variables above describe it, in `language`, and go to the setup tab. */
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
    // The host's locale service answers in the language under test.
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh, en }) => (language === 'en' ? en : zh), subscribe: () => () => {}, getSnapshot: () => language },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  await click(container.querySelector('#pa24-tab-setup'));
}

describe.each(['zh', 'en'])('接入卡的说明（%s）', current => {
  beforeEach(() => { language = current; });

  it.each(['official', 'config', 'path'])('飞书卡：检查报出来源（%s）时，程序名和来源独占一行，排在插件页那句话之前', async sourceKey => {
    diagnostics = feishuCheck(reported(sourceKey));
    await openPanel(); await openCard('feishu');
    expect(note(PAGE.feishu)).toEqual([`lark-cli ${text(LINE[sourceKey])}`, text(PAGE.feishu)]);
  });

  it.each([
    ['尚未检查', () => undefined],
    ['检查因 CLI 缺失而失败', () => feishuCheck({ state: 'error', message: text(MISSING.feishu) }, 'error')],
  ])('飞书卡（%s）：没有来源可说，说明只有插件页那句话', async (_label, check) => {
    diagnostics = check();
    await openPanel(); await openCard('feishu');
    expect(note(PAGE.feishu)).toEqual([null, text(PAGE.feishu)]);
  });

  it('飞书卡：CLI 缺失时同一张卡上的报错原样可见，说明里不另立一个来源', async () => {
    diagnostics = feishuCheck({ state: 'error', message: text(MISSING.feishu) }, 'error');
    await openPanel(); await openCard('feishu');
    expect(container.textContent).toContain(text(MISSING.feishu));
    expect(note(PAGE.feishu)).toEqual([null, text(PAGE.feishu)]);
  });

  it.each(['official', 'config', 'path'])('企业微信卡：检查报出来源（%s）时，同一规则', async sourceKey => {
    wecom = wecomCheck({ ...reported(sourceKey), message: 'wecom-cli 1.0' });
    await openPanel(); await openCard('wecom');
    expect(note(PAGE.wecom)).toEqual([`wecom-cli ${text(LINE[sourceKey])}`, text(PAGE.wecom)]);
  });

  it('企业微信卡：CLI 缺失时只有插件页那句话', async () => {
    wecom = wecomCheck({ state: 'error', message: text(MISSING.wecom) });
    await openPanel(); await openCard('wecom');
    expect(note(PAGE.wecom)).toEqual([null, text(PAGE.wecom)]);
  });

  it('企业微信卡：尚未检查时没有这张卡，也就没有说明', async () => {
    await openPanel(); await openCard('wecom');
    expect(note(PAGE.wecom)).toEqual([undefined, undefined]);
  });
});
