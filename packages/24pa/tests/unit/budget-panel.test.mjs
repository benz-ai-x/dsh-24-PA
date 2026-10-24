import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../../lib/config.js';
import { validateBudget } from '../../lib/model-budget.js';
let React, createRoot, act, win, root, container, requests, budget, config, failRead, failRelease, binding, poll, pendingRead;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
const snapshot = () => ({ workspace: { path: `/test/${binding}`, config, sourceHash: 'saved-1', configVersion: 'active-1' }, workspaceBinding: binding,
  configMeta: { fields: CONFIG_FIELDS }, work: [], outbox: [], secrets: {}, readiness: { items: [] }, transport: { connected: true } });
const fixture = () => ({ workspaceBinding: binding, status: 'blocked', requests: 25, tokens: null, estimatedCost: null, knownTokens: 90, knownEstimatedCost: 0.02, currency: 'CNY', unknownUsage: 1, unknownCost: 2, pending: 1,
  period: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', timeZone: 'Asia/Shanghai' }, recordedSince: '2026-10-23T00:00:00Z', config: config.budget,
  reasons: ['请求预算已到限'], warnings: [], coverage: '仅本工作区受管请求；不含自由对话与外部 CLI。', basis: '宿主持久事件；估算不是供应商账单。', notice: '已发请求可能继续计费，原生日历提醒继续。',
  waiting: [{ run_id: 'run-1', work_item_id: 'work-1', session_id: 'session-1', title: '整理会议材料', reason: '等待预算', blocks: [{ key: 'budget', kind: 'budget', reason: '等待预算' }, { key: 'input', kind: 'input', reason: '需要会议日期' }] }],
  releases: [], records: Array.from({ length: 25 }, (_, i) => ({ id: 'request-' + i, run_id: 'run-' + i, record: { at: '2026-10-23T00:00:00Z', actual: { provider: 'actual-provider', model: 'actual-model-' + i }, proposed: { provider: 'alias', model: 'default' }, currency: 'CNY', usage: null, estimate: null } })),
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const input = label => [...container.querySelectorAll('label')].find(node => node.textContent === label)?.querySelector('input');
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const openCard = async text => click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith(`：${text}`)));
const change = async (node, value) => { expect(node).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new win.Event('input', { bubbles: true })); }); };
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent','localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
beforeEach(async () => {
  binding = 'binding-a'; config = structuredClone(DEFAULT_CONFIG); config.budget.maxRequests = 20; budget = fixture(); requests = []; failRead = false; failRelease = false; pendingRead = null; win.localStorage.clear();
  const interval = globalThis.setInterval; vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req); let value;
    try {
      if (req.endpoint === 'budget') { if (pendingRead) value = await pendingRead; else if (failRead) throw Error('预算账本读取失败'); else value = budget; }
      else if (req.payload.type === 'budget.release') {
        if (failRelease) throw Error('暂时断线，请重试');
        value = { message: '一次放行已保存，只解除预算阻断。' }; budget = { ...budget, waiting: [] };
      } else if (req.payload.type === 'workspace.config-update') { config = { ...config, budget: validateBudget(req.payload.config.budget) }; value = snapshot(); }
      else if (req.endpoint === 'snapshot' || req.endpoint === 'action') value = snapshot();
      else if (req.endpoint === 'workspace.evidence') value = { state: 'applied', savedHash: 'saved-1', activeHash: 'active-1', impacts: {} };
      else if (req.endpoint === 'memory') value = { items: [], total: 0 };
      else if (req.endpoint === 'digests') value = { plans: [], skills: [] };
      else if (req.endpoint === 'runs') value = { records: [], total: 0, matched: 0, offset: 0, limit: 20, workspaceBinding: binding };
      else value = {};
      return { ok: true, json: async () => ({ ok: true, value }) };
    } catch(error) { return { ok: true, json: async () => ({ ok: false, error: { message: error.message } }) }; }
  }));
  let mod, Panel; win.__ModuleLoader__ = { load: value => { mod = value; } }; new Function('window','document','navigator',source)(win,win.document,win.navigator);
  mod.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name,fn) => fn(), register: (spec,view) => { if (spec.name === 'main') Panel=view; } }, uiWorkspace: { openSession() {} } });
  container=win.document.createElement('div');win.document.body.append(container);root=createRoot(container);await act(async () => root.render(React.createElement(Panel)));
  await click(container.querySelector('#pa24-tab-ops')); await openCard('模型与预算');
});
afterEach(async () => { pendingRead=null;await act(async () => root?.unmount());container?.remove();vi.restoreAllMocks(); });
it('实际模型、未知用量、统计范围与完整分页可查，普通查阅不触发模型或写操作', async () => {
  expect(container.textContent).toContain('未知 /');expect(container.textContent).toContain('已知部分 Token：90');expect(container.textContent).toContain('不含自由对话');expect(container.textContent).toContain('actual-provider / actual-model-24');
  expect(container.textContent).not.toContain('actual-provider / actual-model-0'); await click(button('下一页')); expect(container.textContent).toContain('actual-provider / actual-model-0');expect(container.textContent).toContain('21–25 / 25');
  expect([...container.querySelectorAll('pre')].every(node => node.closest('details') && !node.closest('details').open)).toBe(true);
  await click(button('刷新用量'));expect(requests.filter(row=>row.endpoint==='action')).toHaveLength(0);
});
it('一次放行显示原范围和其他阻断，显式确认后提交；断线重试保持同一标识', async () => {
  await click(button('准备放行一次'));expect(container.textContent).toContain('需要会议日期');expect(container.textContent).toContain('session-1');expect(button('确认放行一次').disabled).toBe(true);
  await click(input('确认仅放行以上范围一次'));failRelease=true;await click(button('确认放行一次'));expect(container.textContent).toContain('暂时断线');
  failRelease=false;await click(button('确认放行一次'));expect(container.textContent).toContain('一次放行已保存');
  const calls=requests.filter(row=>row.payload.type==='budget.release');expect(calls).toHaveLength(2);expect(calls[0].payload).toEqual(calls[1].payload);
  expect(calls[0].payload).toMatchObject({ workspaceBinding:'binding-a',runId:'run-1',workId:'work-1',sessionId:'session-1',scope:'next-model-request',confirm:true });
});
it('读取失败显示错误并可重试，不伪装成空用量', async () => {
  failRead=true;await click(button('刷新用量'));expect(container.textContent).toContain('预算账本读取失败');expect(container.textContent).not.toContain('本周期尚无受管请求');
  failRead=false;await click(button('重试读取'));expect(container.textContent).toContain('actual-provider');expect(requests.filter(row=>row.endpoint==='action')).toHaveLength(0);
});
it('预算配置写入统一参数源，0 与留空不同，校验失败保留草稿', async () => {
  await click(button('设置预算与模型'));await change(input('请求次数限额'),'-1');await click(button('保存并重载'));expect(container.textContent).toContain('maxRequests 须为非负数');expect(input('请求次数限额').value).toBe('-1');
  await change(input('请求次数限额'),'0');await change(input('Token 限额'),'');await click(button('保存并重载'));
  const saved=requests.filter(row=>row.payload.type==='workspace.config-update').at(-1).payload;
  expect(saved).toMatchObject({ workspaceBinding:'binding-a',expectedConfigHash:'saved-1',config:{budget:{maxRequests:0,maxTokens:null}} });expect(Object.keys(saved.config)).toEqual(['budget']);
});
it('工作区切换后的迟到用量不覆盖新范围', async () => {
  let resolve;pendingRead=new Promise(done=>{resolve=done;});await click(button('刷新用量'));pendingRead=null;binding='binding-b';budget={...fixture(),coverage:'新工作区的用量'};
  await act(async()=>{await poll();});expect(container.textContent).toContain('新工作区的用量');
  await act(async()=>resolve({...fixture(),workspaceBinding:'binding-a',coverage:'旧工作区迟到内容'}));expect(container.textContent).not.toContain('旧工作区迟到内容');
});

it('失败许可显示原范围并复用原标识续办；接纳未知只引导核对', async () => {
  budget.releases = [{ id: 'existing-permit-123456', run_id: 'run-1', work_item_id: 'work-1', session_id: 'session-1', status: 'ready', record: { error: 'native rejected' }, created_at: '2026-10-23T00:00:00Z' }];
  await click(button('刷新用量')); expect(button('重试原许可续办').closest('details').open).toBe(true);
  await click(button('重试原许可续办')); expect(requests.filter(row => row.payload.type === 'budget.release').at(-1).payload).toMatchObject({ requestId: 'existing-permit-123456', runId: 'run-1', workId: 'work-1', sessionId: 'session-1' });
  budget.releases[0].record.wake = 'sending'; await click(button('刷新用量'));
  expect(button('重试原许可续办')).toBeUndefined(); expect(container.textContent).toContain('接纳状态未知，请先核对原运行');
});
