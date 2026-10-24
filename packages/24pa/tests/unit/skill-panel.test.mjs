import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { SkillManagement } from '../../lib/skill-management.js';
import { makeSkillPackage, skillPackageManifest, skillPackagePreview } from '../../lib/skill-package.js';

let React, createRoot, act, win, root, container, binding, definition, manager, requests, poll, delayedInspect, savedBlob, runReply, packageReply, copied;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const skillRow = source => [...container.querySelectorAll('.pa24-skill-row')].find(node => node.querySelector('strong')?.textContent === 'my-skill' && node.textContent.includes(source));
const fileButton = path => container.querySelector(`[data-file-path="${path}"]`);
const folderButton = path => container.querySelector(`[data-folder-path="${path}"]`);
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const press = async (node, key) => { expect(node).toBeTruthy(); await act(async () => node.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true }))); };
const packageValue = (req, pkg) => {
  const manifest = skillPackageManifest(pkg), p = req.payload;
  const base = { id: p.id, source: p.id.startsWith('builtin:') ? 'builtin' : p.id.startsWith('managed:') ? 'managed' : 'project-dsh', snapshot: p.versionId ? 'immutable-version' : 'current-read',
    fingerprint: p.fingerprint, versionId: p.versionId, packageHash: manifest.packageHash, observedAt: '2026-10-25T00:00:00.000Z', workspaceBinding: binding };
  return p.path === undefined ? { ...base, ...manifest } : { ...base, packageBytes: manifest.bytes, ...skillPackagePreview(pkg, p.path) };
};
beforeEach(async () => {
  binding = 'a'; delayedInspect = null; savedBlob = null; runReply = null; packageReply = null; copied = null; requests = []; win.localStorage.clear();
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async value => { copied = value; }) } });
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
      else if (req.endpoint === 'skills.package-content') value = packageReply ? await packageReply(req) : await manager.packageContent(p);
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
  it('总览卡保留中性检查状态，不用健康徽章展示能力描述', async () => {
    await click(button('返回卡片'));
    const card = [...container.querySelectorAll('.pa24-cap')].find(node => node.textContent.includes('创建与导入 Skill'));
    expect(card.textContent).toContain('status.unchecked');
    expect(card.textContent).not.toContain('包、版本与运行');
  });

  it('目录保留禁用与删除状态，不以正常类型标签覆盖异常状态', async () => {
    const original = manager.list.bind(manager);
    vi.spyOn(manager, 'list').mockImplementation(async expected => {
      const base = await original(expected);
      return { ...base, entries: [...base.entries,
        { id: 'managed:disabled', name: '停用能力', description: '已停用', source: 'managed', type: 'task', status: 'loaded', managedStatus: 'disabled' },
        { id: 'managed:deleted', name: '删除能力', description: '仅历史可查', source: 'managed', type: 'task', status: 'loaded', managedStatus: 'deleted' },
      ] };
    });
    await click(button('刷新目录'));
    for (const [name, label] of [['停用能力', '已禁用'], ['删除能力', '已删除']]) {
      const row = [...container.querySelectorAll('.pa24-skill-row')].find(node => node.querySelector('strong')?.textContent === name);
      expect(row.textContent).toContain(label);
      expect(row.querySelectorAll('.pa24-skill-tag')).toHaveLength(2);
    }
  });

  it('按来源选择、纯文本展示并下载所选指令，浏览不发送执行动作', async () => {
    await click(skillRow('内置原件'));
    expect(win.document.activeElement.textContent).toBe('my-skill');
    await click(button('指令正文'));
    expect(container.textContent).toContain('内置正文');
    await click(button('返回 Skill 目录'));
    await click(skillRow('工作区文件'));
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
    await click(skillRow('工作区文件'));
    definition = { ...definition, content: '新版本' };
    await click(button('下载指令 Markdown'));
    expect(container.textContent).toContain('请刷新详情后再下载');
    expect(savedBlob).toBeNull();
    await click(button('刷新目录'));
    await click(button('指令正文'));
    expect(container.textContent).toContain('新版本');
  });

  it('工作区改变后忽略旧详情响应，当前工作区重新读取', async () => {
    let resolve;
    const old = await manager.inspect('builtin:my-skill', binding);
    delayedInspect = new Promise(r => { resolve = r; });
    await click(skillRow('内置原件'));
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
    await click(skillRow('内置原件'));
    await click([...container.querySelectorAll('button')].find(node => node.textContent.startsWith('run-a-00')));
    await click(button('重新检查并继续原运行'));
    await click([...container.querySelectorAll('button')].find(node => node.textContent.startsWith('run-b-00')));
    expect(container.textContent).toContain('B 的执行结果');
    await act(async () => release(records[0]));
    expect(container.textContent).toContain('B 的执行结果');
    expect(container.textContent).not.toContain('A 等待补充');
  });

  const browserPackage = body => makeSkillPackage([
    { path: 'SKILL.md', bytes: Buffer.from('---\nname: my-skill\ndescription: 包测试\n---\n' + body) },
    { path: 'references/a.txt', bytes: Buffer.from('A 文件正文') },
    { path: 'references/nested/b.txt', bytes: Buffer.from('B 文件正文') },
    { path: 'assets/pixel.bin', bytes: Buffer.from([0, 255, 1]) },
    { path: 'empty.txt', bytes: Buffer.alloc(0) },
    { path: 'long.txt', bytes: Buffer.alloc(256 * 1024 + 20, 97) },
  ]);

  it('包页签懒加载真实树，折叠、键盘、相对路径复制和各预览状态可用', async () => {
    const pkg = browserPackage('默认指令'); packageReply = req => packageValue(req, pkg);
    await click(skillRow('内置原件'));
    expect(requests.some(req => req.endpoint === 'skills.package-content')).toBe(false);
    expect(container.querySelector('.pa24-skill-layout')).toBeTruthy();
    await click(button('包内容'));
    expect(requests.filter(req => req.endpoint === 'skills.package-content').length).toBe(2);
    expect(fileButton('SKILL.md').getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('.pa24-package-path').textContent).toBe('SKILL.md');
    await click(folderButton('references'));
    expect(folderButton('references').getAttribute('aria-expanded')).toBe('false');
    expect(fileButton('references/a.txt')).toBeNull();
    await press(folderButton('references'), 'ArrowRight');
    expect(folderButton('references').getAttribute('aria-expanded')).toBe('true');
    await click(fileButton('references/a.txt'));
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('A 文件正文');
    const info = pkg.files.find(file => file.path === 'references/a.txt');
    expect(container.querySelector('.pa24-package-preview').textContent).toContain(info.hash.slice(0, 12));
    await click(button('复制路径')); expect(copied).toBe('references/a.txt');
    await click(fileButton('assets/pixel.bin'));
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('二进制文件');
    expect(container.querySelector('.pa24-package-preview pre')).toBeNull();
    await click(fileButton('empty.txt'));
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('空文件 · 0 B');
    await click(fileButton('long.txt'));
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('仅显示前 256 KiB');
    expect(container.querySelector('.pa24-package-preview pre').textContent).toHaveLength(256 * 1024);
    expect(requests.filter(req => req.endpoint === 'skills.package-content').every(req => !req.payload.path || !req.payload.path.startsWith('/'))).toBe(true);
    expect(requests.some(req => req.endpoint === 'action')).toBe(false);
  });

  it('文件快速切换时 A 正文迟到不能覆盖 B', async () => {
    const pkg = browserPackage('默认指令'); let release;
    packageReply = req => req.payload.path === 'references/a.txt' ? new Promise(resolve => { release = () => resolve(packageValue(req, pkg)); }) : packageValue(req, pkg);
    await click(skillRow('内置原件')); await click(button('包内容'));
    await click(fileButton('references/a.txt'));
    await click(fileButton('references/nested/b.txt'));
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('B 文件正文');
    await act(async () => release());
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('B 文件正文');
    expect(container.querySelector('.pa24-package-preview').textContent).not.toContain('A 文件正文');
    expect(container.querySelector('.pa24-package-path').textContent).toBe('references/nested/b.txt');
  });

  it('Skill 快速切换时 A 清单迟到不能覆盖 B，详情页签支持方向键 Home End Enter', async () => {
    const a = browserPackage('A 迟到正文'), b = browserPackage('B 当前正文'); let release;
    packageReply = req => {
      const first = req.payload.id === 'builtin:my-skill', pkg = first ? a : b;
      if (first && !req.payload.path) return new Promise(resolve => { release = () => resolve(packageValue(req, pkg)); });
      return packageValue(req, pkg);
    };
    await click(skillRow('内置原件')); await click(button('包内容'));
    await click(skillRow('工作区文件'));
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('B 当前正文');
    await act(async () => release());
    expect(container.querySelector('.pa24-package-preview').textContent).toContain('B 当前正文');
    expect(container.querySelector('.pa24-package-preview').textContent).not.toContain('A 迟到正文');
    await press(button('包内容'), 'End'); expect(button('指令正文').getAttribute('aria-selected')).toBe('true');
    await press(button('指令正文'), 'Home'); expect(button('概览').getAttribute('aria-selected')).toBe('true');
    await press(button('概览'), 'ArrowLeft'); expect(button('指令正文').getAttribute('aria-selected')).toBe('true');
    await press(button('指令正文'), 'Enter'); expect(button('指令正文').getAttribute('aria-selected')).toBe('true');
  });

  it('目录刷新失败保留并明确标识同工作区上次结果', async () => {
    expect(skillRow('内置原件')).toBeTruthy();
    vi.spyOn(manager, 'list').mockRejectedValue(new Error('网络离线'));
    await click(button('刷新目录'));
    expect(container.textContent).toContain('网络离线'); expect(container.textContent).toContain('上次目录');
    expect(skillRow('内置原件')).toBeTruthy();
  });
});
