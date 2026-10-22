import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { SkillManagement } from '../../lib/skill-management.js';

let React, createRoot, act, win, root, container, binding, definition, manager, requests, poll, delayedInspect, savedBlob, runReply;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
beforeEach(async () => {
  binding = 'a'; delayedInspect = null; savedBlob = null; runReply = null; requests = []; win.localStorage.clear();
  definition = { name: 'my-skill', description: '个人能力', source: 'project-dsh', provider: 'filesystem', path: '/workspace/.dsh/skills/my-skill.md', content: '<script>window.ran = true</script>\n真实指令', metadata: { track: 'agent' } };
  manager = new SkillManagement({ builtins: () => [{ name: 'my-skill', description: '内置能力', content: '内置正文', metadata: { track: 'template' } }], registry: { snapshot: async () => ({ skills: [definition], complete: true }), get: async () => definition }, context: () => ({ binding, cwd: '/workspace', enabled: false, allowed: [] }), plans: async () => [] });
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { savedBlob = blob; return 'blob:skill-export'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(win.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    const p = req.payload;
    try {
      let value;
      if (req.endpoint === 'snapshot') value = { workspace: { path: '/workspace', config: DEFAULT_CONFIG }, workspaceBinding: binding, work: [], outbox: [], readiness: { items: [] } };
      else if (req.endpoint === 'skills.catalog') value = await manager.list(p.workspaceBinding);
      else if (req.endpoint === 'skills.inspect') value = delayedInspect ? await delayedInspect : await manager.inspect(p.id, p.workspaceBinding);
      else if (req.endpoint === 'skills.export') value = await manager.exportMarkdown(p.id, p.fingerprint, p.workspaceBinding);
      else if (runReply && ['skills.run', 'skills.runs', 'action'].includes(req.endpoint)) value = await runReply(req);
      else if (req.endpoint === 'health') value = { capabilities: [] };
      else if (req.endpoint === 'memory') value = { items: [], total: 0, matched: 0 };
      else value = {};
      return { ok: true, json: async () => ({ ok: true, value }) };
    } catch (error) { return { ok: true, json: async () => ({ ok: false, error: { message: error.message } }) }; }
  }));
  let mod, Panel;
  win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', source)(win, win.document, win.navigator);
  mod.factory(() => React).apply({ effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' }, slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Panel)));
  await click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：Skill 管理')));
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

describe('Skill 管理面板的用户操作', () => {
  it('按来源选择、纯文本展示并下载所选指令，浏览不发送执行动作', async () => {
    await click(button('my-skill · 内置原件'));
    expect(container.textContent).toContain('内置正文');
    expect(win.document.activeElement.textContent).toBe('my-skill');
    await click(button('返回 Skill 目录'));
    await click(button('my-skill · 工作区文件'));
    expect(container.textContent).toContain('真实指令');
    expect(container.querySelector('script')).toBeNull();
    expect(win.ran).toBeUndefined();
    await click(button('下载指令 Markdown'));
    expect(await savedBlob.text()).toContain('真实指令');
    expect(requests.some(req => req.endpoint === 'action')).toBe(false);
    expect(container.textContent).toContain('不附带工作区配置、计划参数或运行历史');
    expect(button('下载完整 ZIP 包')).toBeTruthy();
  });

  it('查看后修改会报冲突，不触发下载', async () => {
    await click(button('my-skill · 工作区文件'));
    definition = { ...definition, content: '新版本' };
    await click(button('下载指令 Markdown'));
    expect(container.textContent).toContain('请刷新详情后再下载');
    expect(savedBlob).toBeNull();
    await click(button('刷新目录'));
    expect(container.textContent).toContain('新版本');
  });

  it('工作区改变后忽略旧详情响应，当前工作区重新读取', async () => {
    let resolve;
    const old = await manager.inspect('builtin:my-skill', binding);
    delayedInspect = new Promise(r => { resolve = r; });
    await click(button('my-skill · 内置原件'));
    binding = 'b';
    await act(async () => { await poll(); });
    await act(async () => { resolve({ ...old, content: '旧工作区迟到正文' }); });
    expect(container.textContent).not.toContain('旧工作区迟到正文');
    expect(requests.some(req => req.endpoint === 'skills.catalog' && req.payload.workspaceBinding === 'b')).toBe(true);
  });
  it('补充 A 的回包迟到时，不覆盖已经切换到 B 的运行详情', async () => {
    const base = await manager.inspect('builtin:my-skill', binding);
    vi.spyOn(manager, 'inspect').mockResolvedValue({ ...base, entry: { status: 'enabled', revision: 1, active_version: 'v1', draft_version: 'v1' },
      versionId: 'v1', versions: [{ id: 'v1' }], files: [] });
    const records = ['run-a-0001', 'run-b-0002'].map((id, index) => ({ run: { id, status: index ? 'completed' : 'waiting', progress: index ? 'B 的执行结果' : 'A 等待补充', mode: 'local', work_item_id: id, version_id: 'v1' },
      workspaceBinding: binding, calls: [], native: [], reviews: [], execution: { executionMs: 0, remainingMs: 900000, queuedMs: 0, waitingMs: 0, blocks: [] } }));
    let release;
    const held = new Promise(resolve => { release = resolve; });
    runReply = req => req.endpoint === 'skills.runs' ? { workspaceBinding: binding, total: 2, rows: records.map(row => row.run) }
      : req.endpoint === 'action' ? held : records.find(row => row.run.id === req.payload.runId);
    await click(button('my-skill · 内置原件'));
    await click([...container.querySelectorAll('button')].find(node => node.textContent.startsWith('run-a-00')));
    await click(button('重新检查并继续原运行'));
    await click([...container.querySelectorAll('button')].find(node => node.textContent.startsWith('run-b-00')));
    expect(container.textContent).toContain('B 的执行结果');
    await act(async () => release(records[0]));
    expect(container.textContent).toContain('B 的执行结果');
    expect(container.textContent).not.toContain('A 等待补充');
  });
});
