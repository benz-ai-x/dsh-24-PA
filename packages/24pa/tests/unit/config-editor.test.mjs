import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../../lib/config.js';
import { readWorkspaceConfiguration, writeWorkspaceConfiguration } from '../../lib/workspace-config.js';
import { effectiveSources, sourceConfigurationFingerprint } from '../../lib/source-config.js';

let React, createRoot, act, win, root, container, saved, requests, failSave, workspacePath, pendingSave, binding, pollSnapshots, evidenceState;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
});
const snapshot = () => ({ workspace: { path: '/test/workspace', config: structuredClone(saved) }, workspaceBinding: binding, configMeta: { fields: CONFIG_FIELDS }, work: [], outbox: [], secrets: {}, readiness: { items: [] } });
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label);
const field = name => [...container.querySelectorAll('label')].find(node => node.textContent.includes(`（${name}）`))?.control;
const modelField = (role, key) => container.querySelector(`input[aria-label="${role} ${key}"]`);
const click = async node => { expect(node).toBeTruthy(); await act(async () => { node.click(); await pendingSave; }); };
const openConfig = async () => click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：参数配置')));
const loadRoutes = async workerModels => {
  saved = { ...saved, workerModels };
  await click(button('返回卡片')); await click(button('刷新')); await openConfig();
};
const change = async (node, value) => {
  expect(node).toBeTruthy();
  await act(async () => {
    const proto = node.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new win.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
beforeEach(async () => {
  const setIntervalOriginal = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 2500) pollSnapshots = callback;
    return setIntervalOriginal(callback, delay, ...args);
  });
  binding = 'binding-a'; saved = structuredClone(DEFAULT_CONFIG); requests = []; failSave = false; pendingSave = Promise.resolve(); evidenceState = 'applied';
  workspacePath = await mkdtemp(join(tmpdir(), 'pa24-config-editor-'));
  win.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'action' && req.payload.type === 'workspace.config-update') {
      if (failSave) return { ok: true, json: async () => ({ ok: false, error: { message: '校验失败：maxWorkers' } }) };
      // The server boundary reads its own latest file, including simulated
      // concurrent chat edits; exercise the real merge/validation path.
      let saveFailure;
      pendingSave = (async () => {
        await writeFile(join(workspacePath, 'AGENTS.md'), '# Rules\n\n```json\n' + JSON.stringify(saved) + '\n```\n');
        await writeWorkspaceConfiguration(workspacePath, req.payload.config, async () => {}, { expectedSourcesHash: req.payload.expectedSourcesHash });
        saved = (await readWorkspaceConfiguration(workspacePath)).config;
      })().catch(error => { saveFailure = error; });
      await pendingSave;
      if (saveFailure) return { ok: true, json: async () => ({ ok: false, error: { message: saveFailure.message } }) };
    }
    const sources = effectiveSources(saved);
    const value = req.endpoint === 'sources' ? { workspaceBinding: binding, config: sources, configHash: sourceConfigurationFingerprint(sources), legacy: saved.sources === null, entries: sources.entries, removed: [] }
      : req.endpoint === 'workspace.evidence' ? { state: evidenceState, savedHash: evidenceState === 'applied' ? 'same-version' : 'saved-version', activeHash: evidenceState === 'applied' ? 'same-version' : 'active-version', loadedAt: '2026-10-25T00:00:00Z', impacts: {} }
      : req.endpoint === 'snapshot' || req.endpoint === 'action' ? snapshot() : req.endpoint === 'health' ? { capabilities: [] } : req.endpoint === 'memory' ? { items: [], total: 0, matched: 0 } : req.endpoint === 'digests' ? { plans: [], skills: [] } : {};
    return { ok: true, json: async () => ({ ok: true, value }) };
  }));
  let mod, Panel;
  win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', source)(win, win.document, win.navigator);
  mod.factory(name => { if (name !== 'react') throw Error(name); return React; }).apply({
    effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' },
    slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } },
    uiWorkspace: { openSession: () => {} },
  });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  await click(container.querySelector('#pa24-tab-setup'));
  await openConfig();
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); await rm(workspacePath, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('工作区参数编辑：真实 React DOM 用户操作', () => {
  it('首次改旧日历默认会物化来源，保留原来源并把新默认写回配置源', async () => {
    const before = effectiveSources(saved).entries[0];
    await change(field('calendarId'), 'new-calendar'); await click(button('保存并重载'));
    expect(saved.sources.entries.find(row => row.id === before.id)).toEqual(before);
    const next = saved.sources.entries.find(row => row.id === saved.sources.defaults.calendar);
    expect(next.resourceId).toBe('new-calendar'); expect(next.id).not.toBe(before.id);
    expect(requests.filter(req => req.payload.type === 'source.check')).toHaveLength(0);
  });
  it('来源浏览只读；旧配置一次保存后物化且不重复迁移', async () => {
    expect(container.querySelector('.pa24-sources').textContent).toContain('迁移候选');
    expect(requests.filter(row => row.payload.type === 'source.check')).toHaveLength(0);
    await click(button('保存来源并重载'));
    expect(saved.sources.entries).toHaveLength(2);
    expect(saved.sources.defaults.calendar).toBe('legacy-calendar-feishu');
    expect(button('保存来源并重载').disabled).toBe(true);
    expect(container.querySelector('.pa24-sources').textContent).not.toContain('迁移候选');
  });
  it('新增项目日历默认按本人参与筛选，保存后进入同一配置源', async () => {
    await click(button('添加日历来源'));
    const article = [...container.querySelectorAll('.pa24-sources article')].at(-1);
    const control = name => [...article.querySelectorAll('label')].find(row => row.textContent.startsWith(name)).control;
    await change(control('来源名称'), '项目日历');
    await change(control('用途'), 'project');
    await change(control('资源标识'), 'project-calendar');
    expect(control('默认筛选').value).toBe('involved');
    expect([...article.querySelectorAll('button')].find(row => row.textContent === '只读检查').disabled).toBe(true);
    await click(button('保存来源并重载'));
    expect(saved.sources.entries.at(-1)).toMatchObject({ name: '项目日历', purpose: 'project', filter: 'involved', resourceId: 'project-calendar' });
    expect((await readWorkspaceConfiguration(workspacePath)).config.sources).toEqual(saved.sources);
  });
  it('新增个人待办默认全部，五档默认角色可进入真实配置源', async () => {
    await click(button('添加待办来源'));
    const article = [...container.querySelectorAll('.pa24-sources article')].at(-1);
    const control = name => [...article.querySelectorAll('label')].find(row => row.textContent.startsWith(name)).control;
    expect(control('默认筛选').value).toBe('all');
    expect([...control('默认筛选').options].map(row => row.value)).toEqual(['all', 'responsible', 'following', 'assigned', 'creator']);
    await change(control('来源名称'), '个人待办');
    await change(control('资源标识'), 'personal-todos');
    await change(control('默认筛选'), 'creator');
    await click(button('保存来源并重载'));
    expect(saved.sources.entries.at(-1)).toMatchObject({ name: '个人待办', purpose: 'personal', filter: 'creator', resourceId: 'personal-todos' });
  });
  it('来源发生并发修改时拒绝覆盖，保留当前草稿和磁盘另一方的修改', async () => {
    const article = container.querySelector('.pa24-sources article');
    await change([...article.querySelectorAll('label')].find(row => row.textContent.startsWith('来源名称')).control, '我的草稿');
    saved.sources = effectiveSources(saved); saved.sources.entries[0].name = '其他会话修改';
    await click(button('保存来源并重载'));
    expect(container.querySelector('.pa24-sources [role=alert]').textContent).toContain('来源配置已变更');
    expect(saved.sources.entries[0].name).toBe('其他会话修改');
    expect([...article.querySelectorAll('input')][0].value).toBe('我的草稿');
  });
  it('来源写后未生效保留草稿并显示 saved_not_applied 源文件与生效版本差异', async () => {
    const article = container.querySelector('.pa24-sources article'), input = [...article.querySelectorAll('label')].find(row => row.textContent.startsWith('来源名称')).control;
    await change(input, '尚未生效的草稿');
    evidenceState = 'saved_not_applied';
    const evidenceCalls = requests.filter(req => req.endpoint === 'workspace.evidence').length;
    await click(button('保存来源并重载'));
    const alert = container.querySelector('.pa24-sources [role=alert]');
    expect(alert.textContent).toContain('saved_not_applied');
    expect(alert.textContent).toContain('saved-version');
    expect(alert.textContent).toContain('active-version');
    expect(requests.filter(req => req.endpoint === 'workspace.evidence').length).toBeGreaterThan(evidenceCalls);
    expect(input.value).toBe('尚未生效的草稿');
    expect(button('保存来源并重载').disabled).toBe(false);
    expect(container.querySelector('.pa24-sources').textContent).not.toContain('来源已保存并重载；新登记或变更的范围需要只读检查。');
  });
  it('移除全部登记同时清空默认目标，保存后不自动复活旧来源', async () => {
    await click(button('移除登记')); await click(button('移除登记'));
    await click(button('保存来源并重载'));
    expect(saved.sources).toMatchObject({ entries: [], defaults: { calendar: null, todo: null }, mappings: [] });
    expect(container.querySelector('.pa24-sources').textContent).toContain('尚未登记来源');
  });
  it('外部修改另一个字段后，仅提交用户修改字段并采用保存后的规范化基线', async () => {
    await change(field('larkProfile'), '  personal  ');
    saved = { ...saved, maxWorkers: 5 };
    await click(button('刷新'));
    await click(button('保存并重载'));
    const request = requests.find(r => r.payload.type === 'workspace.config-update');
    expect(request.payload.config).toEqual({ larkProfile: 'personal' });
    expect(saved.maxWorkers).toBe(5);
    expect(field('larkProfile').value).toBe('personal');
    expect(field('maxWorkers').value).toBe('5');
    expect(button('保存并重载').disabled).toBe(true);
    expect(container.textContent).toContain('已保存并重载生效');
  });
  it('服务端失败保留草稿并可直接重试', async () => {
    await change(field('maxWorkers'), '4'); failSave = true;
    await click(button('保存并重载'));
    expect(field('maxWorkers').value).toBe('4');
    expect(container.querySelector('[role=alert]').textContent).toContain('校验失败');
    expect(button('保存并重载').disabled).toBe(false);
    failSave = false; await click(button('保存并重载'));
    expect(saved.maxWorkers).toBe(4);
    expect(button('保存并重载').disabled).toBe(true);
  });
  it('修改 TTS 子字段时仅提交对应子字段，保留外部密钥引用变更', async () => {
    await change(field('tts.engine'), 'melo'); await change(field('tts.meloDir'), '/opt/melo');
    saved = { ...saved, tts: { ...saved.tts, volcKeyEnv: 'EXTERNAL_TTS_KEY' } };
    await click(button('刷新')); await click(button('保存并重载'));
    expect(requests.find(r => r.payload.type === 'workspace.config-update').payload.config).toEqual({ tts: { engine: 'melo', meloDir: '/opt/melo' } });
    expect(saved.tts.volcKeyEnv).toBe('EXTERNAL_TTS_KEY');
    expect(button('保存并重载').disabled).toBe(true);
  });
  it('修改 tasks.model 保留并发更新的 tasks.provider 和 handwriting.model', async () => {
    await loadRoutes({ tasks: { provider: 'old-provider', model: 'old-model', simplePersona: true }, handwriting: { provider: 'vision', model: 'old-vision' } });
    await change(modelField('待办管理', 'model'), '  new-model  ');
    saved.workerModels.tasks.provider = 'chat-provider'; saved.workerModels.handwriting.model = 'chat-vision';
    await click(button('刷新')); await click(button('保存并重载'));
    expect(requests.find(r => r.payload.type === 'workspace.config-update').payload.config).toEqual({ workerModels: { tasks: { model: 'new-model' } } });
    expect(saved.workerModels).toEqual({ tasks: { provider: 'chat-provider', model: 'new-model', simplePersona: true }, handwriting: { provider: 'vision', model: 'chat-vision' } });
    expect(modelField('待办管理', 'provider').value).toBe('chat-provider');
    expect(modelField('手写整理', 'model').value).toBe('chat-vision');
    expect(button('保存并重载').disabled).toBe(true);
  });
  it('清空单个路由字段和关闭精简不会删除并发新增的兄弟字段', async () => {
    await loadRoutes({ tasks: { provider: '', model: 'old-model', simplePersona: true } });
    await change(modelField('待办管理', 'model'), ''); await click(modelField('待办管理', '精简提示词'));
    saved.workerModels.tasks.provider = 'chat-provider';
    await click(button('保存并重载'));
    expect(requests.find(r => r.payload.type === 'workspace.config-update').payload.config).toEqual({ workerModels: { tasks: { model: '', simplePersona: false } } });
    expect(saved.workerModels.tasks).toEqual({ provider: 'chat-provider', model: '', simplePersona: false });
    expect(button('保存并重载').disabled).toBe(true);
  });
  it('新路由仅填 model 可保存；最后一个字段清空后删除空路由', async () => {
    await change(modelField('备忘整理', 'model'), 'memo-model'); await click(button('保存并重载'));
    expect(saved.workerModels.memo).toEqual({ provider: '', model: 'memo-model' });
    expect(requests.find(r => r.payload.type === 'workspace.config-update').payload.config).toEqual({ workerModels: { memo: { model: 'memo-model' } } });
    await change(modelField('备忘整理', 'model'), ''); await click(button('保存并重载'));
    expect(requests.filter(r => r.payload.type === 'workspace.config-update').at(-1).payload.config).toEqual({ workerModels: { memo: { model: '' } } });
    expect(saved.workerModels).toEqual({}); expect(button('保存并重载').disabled).toBe(true);
  });
  it('只改密钥时参数保存禁用；密钥独立提交且成功后清空', async () => {
    await change(field('feishuAppSecret'), 'new-test-key');
    expect(button('保存并重载').disabled).toBe(true);
    expect(button('保存密钥').disabled).toBe(false);
    expect(container.textContent).toContain('密钥有未保存修改');
    await click(button('保存密钥'));
    expect(requests.filter(r => r.endpoint === 'action').map(r => r.payload)).toEqual([{ type: 'workspace.secret-update', workspaceBinding: 'binding-a', values: { feishuAppSecret: 'new-test-key' } }]);
    expect(field('feishuAppSecret').value).toBe('');
    expect(button('保存密钥').disabled).toBe(true);
  });
  it('参数保存不丢弃独立密钥草稿，未保存离开仍受保护', async () => {
    await change(field('maxWorkers'), '3'); await change(field('feishuAppSecret'), 'still-unsaved');
    await click(button('保存并重载'));
    expect(field('feishuAppSecret').value).toBe('still-unsaved');
    win.confirm = vi.fn(() => false);
    await click(button('返回卡片'));
    expect(win.confirm).toHaveBeenCalledOnce();
    expect(field('feishuAppSecret').value).toBe('still-unsaved');
  });
  it('未操作的表单不会因轮询到外部配置变更而变脏', async () => {
    saved = { ...saved, maxWorkers: 6 };
    await click(button('刷新'));
    expect(button('保存并重载').disabled).toBe(true);
    expect(requests.some(r => r.payload.type === 'workspace.config-update')).toBe(false);
  });
});


describe('配置草稿的工作区归属', () => {
  it('工作区切换清除旧参数/密钥草稿，提交携带新绑定身份', async () => {
    await change(field('maxWorkers'), '3'); await change(field('feishuAppSecret'), 'A-secret-draft');
    binding = 'binding-b'; saved = { ...saved, maxWorkers: 5 };
    await click(button('刷新'));
    expect(field('maxWorkers').value).toBe('5');
    expect(field('feishuAppSecret').value).toBe('');
    expect(button('保存并重载').disabled).toBe(true);
    await change(field('maxWorkers'), '6'); await click(button('保存并重载'));
    expect(requests.find(r => r.payload.type === 'workspace.config-update').payload.workspaceBinding).toBe('binding-b');
  });
});


it('较早轮询的 A 快照晚到，不覆盖手动刷新得到的 B 配置', async () => {
  const originalFetch = globalThis.fetch.getMockImplementation(), oldSnapshot = snapshot();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  globalThis.fetch.mockImplementationOnce(async () => { await held; return { ok: true, json: async () => ({ ok: true, value: oldSnapshot }) }; });
  await act(async () => { pollSnapshots(); });
  globalThis.fetch.mockImplementation(originalFetch);
  binding = 'binding-b'; saved = { ...saved, maxWorkers: 5 };
  await click(button('刷新'));
  expect(field('maxWorkers').value).toBe('5');
  await act(async () => { release(); await held; });
  expect(field('maxWorkers').value).toBe('5');
  await change(field('maxWorkers'), '6'); await click(button('保存并重载'));
  expect(requests.find(r => r.payload.type === 'workspace.config-update').payload.workspaceBinding).toBe('binding-b');
});
