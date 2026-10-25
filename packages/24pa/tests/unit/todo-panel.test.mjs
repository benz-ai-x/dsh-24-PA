import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { sourceConfigurationFingerprint } from '../../lib/source-config.js';
let React, act, createRoot, win, root, container, requests, binding, failed, pending, poll, sourceFailed, sourceConfig, sourceEvidence, evidenceState, saveBarrier, todoResponse;
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const source = (id, patch = {}) => ({ id, domain: 'todo', platform: 'feishu', name: id === 'personal' ? '个人待办' : '项目待办', purpose: id === 'personal' ? 'personal' : 'project', ownerId: 'owner', resourceKind: 'tasklist', resourceId: id + '-list', filter: id === 'personal' ? 'all' : 'responsible', access: 'readwrite', enabled: true, ...patch });
const initialSources = () => ({ version: 1, entries: [
  { id: 'calendar', domain: 'calendar', platform: 'feishu', name: '工作日历', purpose: 'personal', ownerId: 'owner', resourceKind: 'calendar', resourceId: 'calendar-main', filter: 'all', access: 'readwrite', enabled: true },
  source('personal'), source('project'),
], defaults: { calendar: 'calendar', todo: 'personal' }, mappings: [], meetingDurationMinutes: 30 });
const catalog = () => ({ workspaceBinding: binding, config: structuredClone(sourceConfig), configHash: sourceConfigurationFingerprint(sourceConfig), legacy: false, removed: [],
  entries: sourceConfig.entries.map(row => ({ ...row, evidence: sourceEvidence[row.id] || null, status: sourceEvidence[row.id]?.state === 'verified' ? 'verified' : sourceEvidence[row.id] ? 'failed' : 'pending' })) });
const response = (payload, fresh = false) => ({ workspaceBinding: binding, sources: [{ sourceId: 'project', name: '项目待办', platform: 'feishu', filter: payload.role || sourceConfig.entries.find(row => row.id === 'project').filter, state: fresh ? 'complete' : 'partial', fresh, reason: fresh ? null : '一个来源未核验', checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: fresh ? '2026-10-23T00:00:00Z' : null }],
  tasks: [{ objectId: 'object-1', guid: 'guid-1', summary: payload.offset ? '后一页待办' : '提交方案', status: 'open', dueAt: null, dueDate: null, bucket: 'undated', assignees: [{ id: 'owner', name: '本人' }], url: 'https://task.example/one', workItemIds: ['work-1'],
    locations: [{ sourceId: 'project', sourceName: '项目待办', platform: 'feishu', roles: { complete: true, values: ['responsible'] }, capabilities: { update: 'allowed', cancel: 'allowed' }, locator: { url: 'https://task.example/one' } }] }],
  counts: { overdue: 2, today: 3, open: 21, undated: 1 }, fresh, complete: fresh, count: 21, total: fresh ? 21 : null, hasMore: !payload.offset, message: fresh ? '已核验 1 个来源' : '当前可展示结果，未完整核验，不能据此判断全部完成' });
beforeEach(async () => {
  requests = []; binding = 'binding-a'; failed = false; sourceFailed = true; pending = null; evidenceState = 'applied'; saveBarrier = null; sourceConfig = initialSources(); todoResponse = response;
  sourceEvidence = {
    personal: { state: 'verified', message: '个人来源身份与资源已核验', checkedAt: '2026-10-23T00:00:00Z', identity: { ownerId: 'owner', authority: 'app:test' }, resource: { id: 'personal-list' }, capabilities: { read: 'allowed', create: 'allowed', update: 'allowed', cancel: 'allowed' } },
    project: { state: 'failed', message: '项目授权已过期', checkedAt: '2026-10-23T00:00:00Z', identity: null, resource: null, capabilities: { read: 'denied', create: 'denied', update: 'unknown', cancel: 'unknown' } },
  };
  win.localStorage.clear(); win.confirm = () => true;
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'action' && req.payload.type === 'todos.verify') {
      if (pending) return pending;
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '原平台离线' } }) };
    }
    if (req.endpoint === 'action' && req.payload.type === 'workspace.config-update') {
      if (saveBarrier) await saveBarrier;
      if (req.payload.workspaceBinding !== binding) return { ok: true, json: async () => ({ ok: false, error: { message: '工作区已切换，请刷新后重新编辑。' } }) };
      if (req.payload.expectedSourcesHash !== sourceConfigurationFingerprint(sourceConfig)) return { ok: true, json: async () => ({ ok: false, error: { message: '来源配置已变更，请重新读取后合并草稿。' } }) };
      sourceConfig = structuredClone(req.payload.config.sources);
    }
    if (req.endpoint === 'sources' && sourceFailed) return { ok: true, json: async () => ({ ok: false, error: { message: '来源服务离线' } }) };
    const value = req.endpoint === 'snapshot' ? { workspace: { path: '/workspace-' + binding, config: { ...DEFAULT_CONFIG } }, workspaceBinding: binding, work: [], outbox: [], secrets: {}, readiness: { items: [] } }
      : req.endpoint === 'todos' || (req.endpoint === 'action' && req.payload.type === 'todos.verify') ? todoResponse(req.payload, req.endpoint === 'action')
      : req.endpoint === 'sources' ? catalog() : req.endpoint === 'reminders' ? { rules: [], occurrences: [] }
      : req.endpoint === 'workspace.evidence' ? { state: evidenceState, savedHash: evidenceState === 'applied' ? 'same-version' : 'saved-version', activeHash: evidenceState === 'applied' ? 'same-version' : 'active-version', impacts: {} }
      : req.endpoint === 'health' ? { capabilities: [] } : req.endpoint === 'memory' ? { items: [], total: 0, matched: 0 } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let module, Panel; win.__ModuleLoader__ = { load: value => { module = value; } };
  new Function('window', 'document', 'navigator', await readFile(new URL('../../client.js', import.meta.url), 'utf8'))(win, win.document, win.navigator);
  module.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({ effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：待办'));
  expect(card).toBeTruthy(); card.focus(); expect(win.document.activeElement).toBe(card); await act(async () => card.click());
  sourceFailed = false;
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); };
const change = async (node, value) => { expect(node).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value').set.call(node, value); node.dispatchEvent(new win.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); };
const control = (scope, label) => [...scope.querySelectorAll('label')].find(node => node.textContent.startsWith(label))?.control;
const scopePanel = () => container.querySelector('[data-testid=source-scope-panel]');
const drawer = () => container.querySelector('[role=dialog]');

it.each(['light', 'dark'])('%s 桌面 1280×800：真实待办、范围缺口、筛选分页及原对象草稿', async theme => {
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 1280, height: 800 });
  expect(container.textContent).toContain('不能据此判断全部完成');
  const firstRow = container.querySelector('[data-testid=todo-row]');
  expect(firstRow.textContent).toContain('本人'); expect(firstRow.textContent).toContain('未设置');
  expect(firstRow.textContent).toContain('项目待办'); expect(firstRow.textContent).toContain('未完成');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  await click('下一页'); expect(container.textContent).toContain('后一页待办'); expect(requests.filter(req => req.endpoint === 'todos').at(-1).payload.offset).toBe(20);
  const role = [...container.querySelectorAll('label')].find(node => node.textContent.startsWith('本人角色')).control;
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(role, 'following'); role.dispatchEvent(new win.Event('change', { bubbles: true })); });
  expect(requests.filter(req => req.endpoint === 'todos').at(-1).payload).toMatchObject({ role: 'following', offset: 0 });
  await click('延期或修改'); const draft = container.querySelector('[data-testid=todo-detail] textarea');
  expect(draft.value).toContain('sourceId=project'); expect(draft.value).toContain('guid=guid-1'); expect(draft.value).toContain('objectId=object-1');
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
  const verify = button('核验待办'); verify.focus(); expect(win.document.activeElement).toBe(verify);
  failed = true; await click('核验待办'); expect(container.querySelector('[role=alert]').textContent).toContain('原平台离线'); expect(container.textContent).toContain('提交方案');
  failed = false; await click('重试核验'); expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('本次已核验');
});
it('核验期间禁止重复提交；工作区切换丢弃旧结果与草稿', async () => {
  let finish; const old = response({}, true); old.message = '迟到的旧工作区结果';
  pending = new Promise(resolve => { finish = resolve; });
  await click('延期或修改'); await click('核验待办'); expect(button('核验中…').disabled).toBe(true);
  binding = 'binding-b'; await act(async () => { await poll(); });
  expect(container.querySelector('[data-testid=todo-detail] textarea')).toBeNull();
  await act(async () => { finish({ ok: true, json: async () => ({ ok: true, value: old }) }); });
  expect(container.textContent).not.toContain('迟到的旧工作区结果'); expect(requests.filter(req => req.payload.type === 'todos.verify')).toHaveLength(1);
});

it('来源加载失败可见并可重试，核验刷新会重新加载且保留筛选与草稿', async () => {
  expect(container.textContent).toContain('待办来源加载失败：来源服务离线');
  expect(scopePanel().textContent).not.toContain('默认写入：');
  await click('延期或修改');
  const draft = container.querySelector('[data-testid=todo-detail] textarea').value;
  await click('重试加载来源');
  expect(container.textContent).not.toContain('待办来源加载失败');
  const source = [...container.querySelectorAll('label')].find(node => node.textContent.startsWith('待办来源')).control;
  expect([...source.options].map(row => row.value)).toContain('project');
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(source, 'project'); source.dispatchEvent(new win.Event('change', { bubbles: true })); });
  sourceFailed = true; const before = requests.filter(req => req.endpoint === 'sources').length;
  await click('核验待办'); expect(requests.filter(req => req.endpoint === 'sources')).toHaveLength(before + 1);
  expect(container.textContent).toContain('待办来源加载失败'); expect(source.value).toBe('project');
  expect(container.querySelector('[data-testid=todo-detail] textarea').value).toBe(draft);
  sourceFailed = false; await click('核验待办'); expect(container.textContent).not.toContain('待办来源加载失败'); expect(source.value).toBe('project');
});

it('默认写入和角色仅在保存重读生效后迁移，失败证据不被默认徽章覆盖', async () => {
  await click('重试加载来源');
  expect(scopePanel().textContent).toContain('默认写入：个人待办');
  expect(scopePanel().textContent).toContain('我负责的');
  await click('记录待办');
  let draft = container.querySelector('textarea[aria-label="待办对话内容"]');
  expect(draft.value).toContain('sourceId=personal');
  expect(win.document.activeElement).toBe(draft);
  await click('配置待办来源');
  const calendarBefore = structuredClone(sourceConfig.entries.find(row => row.domain === 'calendar'));
  expect(drawer().querySelectorAll('article')).toHaveLength(2);
  const defaultTarget = control(drawer(), '新待办默认写入');
  const project = [...drawer().querySelectorAll('article')].find(row => row.textContent.includes('项目待办'));
  const defaultRole = control(project, '默认角色');
  await change(defaultTarget, 'project'); await change(defaultRole, 'following');
  expect([...project.querySelectorAll('.pa24-badge')].map(row => row.textContent)).not.toContain('默认写入');
  expect([...project.querySelectorAll('.pa24-badge')].map(row => row.textContent)).toContain('草稿写入目标');
  expect(scopePanel().textContent).toContain('默认写入：个人待办');
  expect(scopePanel().textContent).toContain('我负责的');
  expect(draft.value).toContain('sourceId=personal');
  const saveIndex = requests.length;
  await click('保存来源并重载');
  expect(sourceConfig.defaults.todo).toBe('project');
  expect(sourceConfig.entries.find(row => row.id === 'project').filter).toBe('following');
  expect(sourceConfig.entries.find(row => row.domain === 'calendar')).toEqual(calendarBefore);
  expect(sourceConfig.defaults.calendar).toBe('calendar'); expect(sourceConfig.meetingDurationMinutes).toBe(30);
  expect(scopePanel().textContent).toContain('默认写入：项目待办');
  expect([...project.querySelectorAll('.pa24-badge')].map(row => row.textContent)).toContain('默认写入');
  expect([...project.querySelectorAll('.pa24-badge')].map(row => row.textContent)).not.toContain('草稿写入目标');
  expect(scopePanel().textContent).toContain('项目授权已过期');
  expect(scopePanel().textContent).toContain('我关注的');
  expect(draft.value).toContain('sourceId=personal');
  const updateIndex = requests.findIndex((req, index) => index >= saveIndex && req.payload.type === 'workspace.config-update');
  const sourcesIndex = requests.findIndex((req, index) => index > updateIndex && req.endpoint === 'sources');
  const evidenceIndex = requests.findIndex((req, index) => index > sourcesIndex && req.endpoint === 'workspace.evidence');
  expect(updateIndex).toBeGreaterThanOrEqual(saveIndex); expect(sourcesIndex).toBeGreaterThan(updateIndex); expect(evidenceIndex).toBeGreaterThan(sourcesIndex);
  await act(async () => drawer().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await click('记录待办'); draft = container.querySelector('textarea[aria-label="待办对话内容"]');
  expect(draft.value).toContain('sourceId=project');
});

it('写后未生效不迁移默认，CAS 冲突也保留抽屉草稿', async () => {
  await click('重试加载来源'); await click('配置待办来源');
  let defaultTarget = control(drawer(), '新待办默认写入');
  await change(defaultTarget, 'project'); evidenceState = 'saved_not_applied';
  await click('保存来源并重载');
  expect(drawer().textContent).toContain('saved_not_applied');
  expect(defaultTarget.value).toBe('project');
  expect(scopePanel().textContent).toContain('默认写入：个人待办');
  evidenceState = 'applied';
  sourceConfig = { ...sourceConfig, entries: sourceConfig.entries.map(row => row.id === 'personal' ? { ...row, name: '另一会话的个人来源' } : row) };
  await click('保存来源并重载');
  expect(drawer().textContent).toContain('来源配置已变更');
  expect(defaultTarget.value).toBe('project');
  expect(scopePanel().textContent).toContain('默认写入：个人待办');
});

it('抽屉圈定并归还焦点，Escape 遵守未保存离开保护', async () => {
  await click('重试加载来源');
  const opener = button('配置待办来源'); opener.focus(); await act(async () => opener.click());
  expect(drawer()).toBeTruthy();
  expect(drawer().contains(win.document.activeElement)).toBe(true);
  expect(win.document.getElementById(drawer().getAttribute('aria-labelledby')).textContent).toContain('待办来源与范围');
  const focusable = [...drawer().querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')];
  const first = focusable[0], last = focusable.at(-1); last.focus();
  await act(async () => last.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  expect(win.document.activeElement).toBe(first);
  await act(async () => drawer().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(drawer()).toBeNull(); expect(win.document.activeElement).toBe(opener);
  await act(async () => opener.click()); await change(control(drawer(), '新待办默认写入'), 'project');
  win.confirm = vi.fn(() => false);
  await act(async () => drawer().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(drawer()).toBeTruthy(); expect(win.confirm).toHaveBeenCalled();
  win.confirm = vi.fn(() => true);
  await act(async () => drawer().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(drawer()).toBeNull(); expect(win.document.activeElement).toBe(opener);
});

it('保存迟到响应和工作区切换不迁移旧默认或覆盖新工作区', async () => {
  await click('重试加载来源'); await click('配置待办来源');
  await change(control(drawer(), '新待办默认写入'), 'project');
  let release; saveBarrier = new Promise(resolve => { release = resolve; });
  await click('保存来源并重载');
  binding = 'binding-b'; await act(async () => { await poll(); });
  await act(async () => release());
  expect(sourceConfig.defaults.todo).toBe('personal');
  expect(drawer()).toBeNull();
  expect(container.textContent).not.toContain('saved_not_applied');
  expect(scopePanel().textContent).not.toContain('默认写入：项目待办');
  expect(requests.filter(req => req.payload.type === 'workspace.config-update')).toHaveLength(1);
});

it('新增来源保存后引导本人授权并分步核验，attemptable 不冒充已证实写权限', async () => {
  await click('重试加载来源'); await click('配置待办来源'); await click('添加待办来源');
  let article = [...drawer().querySelectorAll('article')].at(-1);
  expect(control(article, '默认角色').value).toBe('all');
  await change(control(article, '来源名称'), '新个人清单');
  await change(control(article, '资源标识'), 'new-personal-list');
  await click('保存来源并重载');
  const id = sourceConfig.entries.at(-1).id;
  expect(sourceConfig.defaults.todo).toBe('personal');
  expect(requests.filter(req => ['source.check', 'todos.verify'].includes(req.payload.type))).toHaveLength(0);
  article = [...drawer().querySelectorAll('article')].find(row => row.textContent.includes('新个人清单'));
  expect(article.textContent).toContain('待核验');
  expect(drawer().textContent).toContain('本人完成平台授权');
  sourceEvidence[id] = { state: 'verified', message: '身份与资源已核验；创建仅可尝试', checkedAt: '2026-10-25T00:00:00Z', identity: { ownerId: 'owner', authority: 'app:test' }, resource: { id: 'new-personal-list' }, capabilities: { read: 'allowed', create: 'attemptable', update: 'unknown', cancel: 'unknown' } };
  const check = [...article.querySelectorAll('button')].find(row => row.textContent === '检查并核验待办');
  await act(async () => check.click());
  const checks = requests.filter(req => ['source.check', 'todos.verify'].includes(req.payload.type));
  expect(checks.map(req => req.payload.type)).toEqual(['source.check', 'todos.verify']);
  expect(checks.every(req => req.payload.sourceId === id)).toBe(true);
  expect(article.textContent).toContain('写权限待核验');
  expect(article.textContent).not.toContain('已证实写权限');
});

it('多来源部分失败保留结果，真实空、无匹配与无来源分别呈现', async () => {
  let scenario = 'partial';
  todoResponse = (payload, verifying) => {
    if (scenario === 'none') return { workspaceBinding: binding, sources: [], tasks: [], counts: { overdue: 0, today: 0, open: 0, undated: 0 }, fresh: false, complete: false, count: 0, total: null, hasMore: false };
    const result = response(payload, scenario === 'fresh' && verifying);
    if (scenario === 'partial') {
      result.sources.push({ sourceId: 'personal', name: '个人待办', platform: 'feishu', filter: 'all', state: 'failed', fresh: false, reason: '个人来源无权', checkedAt: '2026-10-23T00:00:00Z', lastCompleteAt: null });
      result.complete = false; result.total = null;
      return result;
    }
    result.tasks = []; result.count = 0; result.hasMore = false; result.counts = { overdue: 0, today: 0, open: 0, undated: 0 };
    result.total = result.complete ? 0 : null;
    if (scenario === 'saved') {
      result.complete = true; result.total = 0;
      result.sources[0].state = 'complete'; result.sources[0].fresh = false; result.sources[0].lastCompleteAt = '2026-10-23T00:00:00Z'; result.sources[0].reason = null;
    }
    return result;
  };
  await act(async () => [...container.querySelector('[data-testid=todo-detail]').querySelectorAll('button')].find(node => node.textContent === '刷新').click());
  expect(container.textContent).toContain('提交方案');
  expect(container.querySelector('[data-testid=source-query-state]').textContent).toContain('部分来源核验失败');
  expect(scopePanel().textContent).toContain('个人来源无权');
  scenario = 'saved'; await act(async () => [...container.querySelector('[data-testid=todo-detail]').querySelectorAll('button')].find(node => node.textContent === '刷新').click());
  expect(container.textContent).toContain('保存的完整观察为空');
  await change(control(container, '搜索待办'), '没有匹配');
  expect(container.textContent).toContain('保存的完整观察中没有匹配');
  scenario = 'fresh'; await click('核验待办');
  expect(container.textContent).toContain('当前筛选没有匹配待办');
  await change(control(container, '搜索待办'), ''); await click('核验待办');
  expect(container.textContent).toContain('当前范围没有待办');
  scenario = 'none'; sourceConfig = { ...sourceConfig, entries: [], defaults: { calendar: null, todo: null }, mappings: [] };
  await click('核验待办');
  expect(container.textContent).toContain('尚未登记待办来源');
  expect(scopePanel().textContent).toContain('尚未登记来源');
});
