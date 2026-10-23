import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../../lib/config.js';
let React, createRoot, act, win, root, container, requests, health, failRead, pendingRead, binding, poll;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
const config = { ...DEFAULT_CONFIG, mode: 'feishu', ownerOpenId: 'ou-owner', notifyChannel: 'wecom' };
const snapshot = () => ({ workspace: { path: `/test/${binding}`, config, sourceHash: 'saved-1', configVersion: 'config-1' }, workspaceBinding: binding,
  configMeta: { fields: CONFIG_FIELDS }, work: [], outbox: [], secrets: {}, readiness: { items: [] }, transport: { connected: true } });
const evidence = () => ({ configVersion: 'config-1', readAt: '2026-10-23T01:00:00Z', evidence: [
  { scope: 'feishu.receive', state: 'no_activity', checkedAt: '', configVersion: 'config-1', coverage: '合格入站', message: '无活动不等于故障', impact: '尚未证明链路', nextSteps: ['本人发送测试私聊'] },
  { scope: 'feishu.application', state: 'stale', checkedAt: '2026-10-22T01:00:00Z', configVersion: 'old-config', coverage: '实际应用', message: '旧配置证据已过期', impact: '只影响此应用', nextSteps: ['核对应用'] },
  { scope: 'source:read-only', state: 'verified', checkedAt: '2026-10-23T01:00:00Z', configVersion: 'config-1', coverage: '只读日历', message: '公司日历可读，未授权写入', impact: '只能查询', nextSteps: [] },
], tests: [], testCoverage: '最近100次', traffic: { channels: [{ channel: 'feishu', status: 'sent', count: 205 }], inbox: [], coverage: '完整持久账本' } });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const checkbox = label => [...container.querySelectorAll('label')].find(node => node.textContent === label)?.querySelector('input');
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const openCard = async text => click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith(`：${text}`)));
const change = async (node, value) => { expect(node).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new win.Event('change', { bubbles: true })); }); };
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
beforeEach(async () => {
  binding = 'binding-a'; health = evidence(); requests = []; failRead = false; pendingRead = null; win.localStorage.clear();
  const interval = globalThis.setInterval; vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req); let value;
    if (req.endpoint === 'health.snapshot') {
      if (pendingRead) value = await pendingRead;
      else if (failRead) return { ok: true, json: async () => ({ ok: false, error: { message: '健康证据读取失败，请重试' } }) };
      else value = health;
    } else if (req.endpoint === 'sources') value = { entries: [
      { id: 'personal', name: '个人日历', platform: 'feishu', domain: 'calendar', enabled: true, access: 'readwrite' },
      { id: 'read-only', name: '公司日历', platform: 'feishu', domain: 'calendar', enabled: true, access: 'read' },
    ] };
    else if (req.endpoint === 'health.test.preview') value = { fingerprint: 'preview-1', plan: { action: req.payload.action, platform: 'feishu', domain: 'calendar', target: { sourceId: 'personal', platform: 'feishu', resource: { id: 'cal-real' }, identity: { ownerId: 'ou-owner', authority: 'app-one' } }, description: '创建唯一测试日程，无邀请无提醒', cost: '不调用模型', residue: '平台会留测试对象，可确认清理', configVersion: 'config-1' } };
    else if (req.endpoint === 'action' && req.payload.type === 'health.test') {
      value = { id: req.payload.requestId, status: 'succeeded', plan: req.payload.plan, result: { nativeId: 'event-native', message: '平台已接纳，不代表设备通知已送达' } }; health = { ...health, tests: [value] };
    } else if (req.endpoint === 'action' && req.payload.type === 'health.test.cleanup') {
      value = { ...health.tests[0], cleanup: { state: 'accepted', message: '清理已接纳，原回执保留' } }; health = { ...health, tests: [value] };
    } else if (req.endpoint === 'action' && req.payload.type === 'health.check') value = { evidence: health.evidence };
    else if (req.endpoint === 'workspace.evidence') value = { state: 'saved_not_applied', savedHash: 'file-new', activeHash: 'runtime-old', loadedAt: '2026-10-22T01:00:00Z', impacts: { work: 3, outbox: 2, reviews: 1 }, message: '在途归属保留' };
    else if (req.endpoint === 'snapshot' || req.endpoint === 'action') value = snapshot();
    else if (req.endpoint === 'health') value = { capabilities: [], connectionEvidence: health };
    else if (req.endpoint === 'memory') value = { items: [], total: 0 };
    else if (req.endpoint === 'digests') value = { plans: [], skills: [] };
    else value = {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let mod, Panel; win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', source)(win, win.document, win.navigator);
  mod.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container); await act(async () => root.render(React.createElement(Panel)));
  await click(container.querySelector('#pa24-tab-setup'));
});
afterEach(async () => { pendingRead = null; await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
describe('M07 接入与配置：真实 React DOM 操作', () => {
  it('读取失败可重试，普通浏览不触发探测，只读来源也显示证据', async () => {
    failRead = true; await openCard('飞书'); expect(container.textContent).toContain('健康证据读取失败'); expect(requests.some(row => row.endpoint === 'action')).toBe(false);
    failRead = false; await click(button('重试读取')); expect(container.textContent).toContain('无活动不等于故障'); expect(container.textContent).toContain('公司日历可读');
    expect(container.textContent).toContain('证据已过期'); expect(container.textContent).toContain('205 条');
    await click(button('执行只读检查')); expect(requests.find(row => row.payload.type === 'health.check').payload).toMatchObject({ workspaceBinding: 'binding-a', scopes: ['feishu'] });
    expect(requests.filter(row => row.payload.type === 'health.test')).toHaveLength(0);
  });
  it('具体目标、成本、残留先预览；测试和清理分别显式确认，真实回执可见', async () => {
    await openCard('飞书'); await change([...container.querySelectorAll('select')].find(node => [...node.options].some(option => option.value === 'source.create')), 'source.create');
    const sources = [...container.querySelectorAll('select')].find(node => [...node.options].some(option => option.value === 'personal'));
    expect([...sources.options].some(option => option.value === 'read-only')).toBe(false);
    await change(sources, 'personal'); await click(button('预览测试目标'));
    expect(container.textContent).toContain('cal-real'); expect(container.textContent).toContain('不调用模型'); expect(container.textContent).toContain('平台会留测试对象');
    expect(button('执行已确认测试').disabled).toBe(true); expect(requests.some(row => row.payload.type === 'health.test')).toBe(false);
    await click(checkbox('确认对以上目标执行这一次测试')); await click(button('执行已确认测试'));
    expect(container.textContent).toContain('event-native'); expect(container.textContent).toContain('平台已接纳，不代表设备通知已送达');
    expect(button('清理测试对象').disabled).toBe(true); await click(checkbox('确认清理此测试对象')); await click(button('清理测试对象'));
    expect(container.textContent).toContain('清理已接纳，原回执保留'); expect(button('清理测试对象')).toBeUndefined();
    expect(requests.filter(row => row.payload.type === 'health.test.cleanup')).toHaveLength(1);
  });
  it('工作区切换后的迟到证据不会回填新工作区', async () => {
    let resolveOld; pendingRead = new Promise(resolve => { resolveOld = resolve; }); await openCard('飞书');
    pendingRead = null; binding = 'binding-b'; health = { ...evidence(), evidence: [{ ...evidence().evidence[0], message: '新工作区证据' }] };
    await act(async () => { await poll(); }); expect(container.textContent).toContain('新工作区证据');
    await act(async () => resolveOld({ ...evidence(), evidence: [{ ...evidence().evidence[0], message: '旧工作区迟到证据' }] }));
    expect(container.textContent).not.toContain('旧工作区迟到证据'); expect(container.textContent).toContain('新工作区证据');
  });
  it('修复入口携带诊断、字段与配置版本，并以当前绑定重验对应范围', async () => {
    await openCard('飞书');
    const row = [...container.querySelectorAll('.pa24-resource')].find(node => node.textContent.includes('旧配置证据已过期'));
    await click([...row.querySelectorAll('button')].find(node => node.textContent === '定位修复配置'));
    const context = container.querySelector('[aria-label="修复上下文"]'); expect(context.textContent).toContain('old-config'); expect(context.textContent).toContain('feishuAppId'); expect(context.textContent).toContain('旧配置证据已过期');
    await click(button('修复后只读重验'));
    expect(requests.find(row => row.payload.type === 'health.check').payload).toMatchObject({ scopes: ['feishu'], workspaceBinding: 'binding-a' });
  });
  it('参数卡分别显示源文件与运行版本、在途影响，无秘密回显', async () => {
    await openCard('参数配置'); expect(container.textContent).toContain('源文件已有更新，尚未生效'); expect(container.textContent).toContain('file-new'); expect(container.textContent).toContain('runtime-old');
    expect(container.textContent).toContain('进行中交办'); expect(container.textContent).toContain('待审版本'); expect([...container.querySelectorAll('input[type=password]')].every(input => input.value === '')).toBe(true);
  });
});
