import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../../lib/config.js';
import { readWorkspaceConfiguration, writeWorkspaceConfiguration } from '../../lib/workspace-config.js';

let React, createRoot, act, win, root, container, saved, requests, failSave, workspacePath, pendingSave;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
});
const snapshot = () => ({ workspace: { path: '/test/workspace', config: structuredClone(saved) }, configMeta: { fields: CONFIG_FIELDS }, work: [], outbox: [], secrets: {}, readiness: { items: [] } });
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
  saved = structuredClone(DEFAULT_CONFIG); requests = []; failSave = false; pendingSave = Promise.resolve();
  workspacePath = await mkdtemp(join(tmpdir(), 'pa24-config-editor-'));
  win.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (req.endpoint === 'action' && req.payload.type === 'workspace.config-update') {
      if (failSave) return { ok: true, json: async () => ({ ok: false, error: { message: '校验失败：maxWorkers' } }) };
      // The server boundary reads its own latest file, including simulated
      // concurrent chat edits; exercise the real merge/validation path.
      pendingSave = (async () => {
        await writeFile(join(workspacePath, 'AGENTS.md'), '# Rules\n\n```json\n' + JSON.stringify(saved) + '\n```\n');
        await writeWorkspaceConfiguration(workspacePath, req.payload.config, async () => {});
        saved = (await readWorkspaceConfiguration(workspacePath)).config;
      })();
      await pendingSave;
    }
    const value = req.endpoint === 'snapshot' || req.endpoint === 'action' ? snapshot() : req.endpoint === 'health' ? { capabilities: [] } : req.endpoint === 'memory' ? { items: [], total: 0, matched: 0 } : req.endpoint === 'digests' ? { plans: [], skills: [] } : {};
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
    expect(requests.filter(r => r.endpoint === 'action').map(r => r.payload)).toEqual([{ type: 'workspace.secret-update', values: { feishuAppSecret: 'new-test-key' } }]);
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
