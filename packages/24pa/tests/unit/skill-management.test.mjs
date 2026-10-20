import { describe, expect, it, vi } from 'vitest';
import { SkillCatalog } from '../../lib/skills.js';
import { SkillManagement } from '../../lib/skill-management.js';
import { registerPanel } from '../../lib/panel.js';
import { WorkspaceExecution } from '../../lib/workspace-execution.js';

const personal = (name = 'digest-morning') => ({ name, description: '个人说明\n第二行', content: '工作区正文 <script>never()</script>', source: 'project-dsh', provider: 'filesystem', path: '/workspace/.dsh/skills/' + name + '.md', metadata: { track: 'agent', tools: ['pa24_memory'], params: { query: 'A: B' } }, invocation: { modelInvocable: false, userInvocable: true } });
function setup(options = {}) {
  const state = { binding: 'workspace-a', cwd: '/workspace', enabled: false, allowed: [], definition: personal(), ...options };
  const registry = {
    snapshot: vi.fn(async () => ({ skills: [state.definition, { ...personal('user-global'), source: 'user-dsh' }], complete: true })),
    list: vi.fn(async () => [state.definition]),
    get: vi.fn(async () => state.definition),
    ...options.registry,
  };
  const catalog = new SkillCatalog(null, () => state.cwd, () => '本地接入指南');
  const manager = new SkillManagement({ registry: options.noRegistry ? null : registry, builtins: () => catalog.builtinAll(), context: () => state, plans: options.plans ?? (async () => [{ id: 'plan-1', kind: 'morning', skill: 'digest-morning', status: 'active' }]) });
  return { manager, registry, state };
}

describe('Skill 管理读取与导出', () => {
  it('内置原件、同名工作区定义、persona、向导分开；只读取本工作区', async () => {
    const { manager, registry } = setup();
    const result = await manager.list('workspace-a');
    expect(result.discovery).toBe('complete');
    const sameName = result.entries.filter(row => row.name === 'digest-morning');
    expect(sameName.map(row => row.source)).toEqual(['builtin', 'project-dsh']);
    expect(result.entries.some(row => row.name === 'user-global')).toBe(false);
    expect(result.entries.some(row => row.type === 'persona')).toBe(true);
    expect(result.entries.some(row => row.type === 'setup')).toBe(true);
    expect(registry.get).toHaveBeenCalledTimes(1);
    const original = await manager.inspect(sameName[0].id, 'workspace-a');
    const custom = await manager.inspect(sameName[1].id, 'workspace-a');
    expect(original.content).not.toBe(custom.content);
    expect(custom.content).toContain('工作区正文');
    expect(custom.plans).toEqual([{ id: 'plan-1', kind: 'morning', status: 'active' }]);
    expect(custom.restrictions.join(' ')).toContain('尚未列入');
  });

  it('发现失败、正文失败、没有 registry、旧宿主完整性未知分别显示', async () => {
    const failedDiscovery = setup({ registry: { snapshot: async () => { throw Error('扫描中断'); } } });
    const partial = await failedDiscovery.manager.list('workspace-a');
    expect(partial).toMatchObject({ discovery: 'partial', discoveryError: '扫描中断' });
    expect(partial.entries.length).toBeGreaterThan(0);
    const failedBody = setup({ registry: { get: async () => { throw Error('正文不可读'); } } });
    expect((await failedBody.manager.list('workspace-a')).entries.find(row => row.source === 'project-dsh')).toMatchObject({ status: 'error', error: '正文不可读' });
    expect((await setup({ noRegistry: true }).manager.list('workspace-a')).discovery).toBe('unavailable');
    expect((await setup({ registry: { snapshot: undefined } }).manager.list('workspace-a')).discovery).toBe('unknown');
  });

  it('一次完整读取导出原 metadata、正文及 invocation；指纹不是持久版本', async () => {
    const { manager, registry, state } = setup();
    const row = (await manager.list('workspace-a')).entries.find(row => row.source === 'project-dsh');
    registry.get.mockClear();
    const detail = await manager.inspect(row.id, 'workspace-a');
    expect(registry.get).toHaveBeenCalledTimes(1);
    const file = await manager.exportMarkdown(row.id, detail.fingerprint, 'workspace-a');
    expect(registry.get).toHaveBeenCalledTimes(2);
    expect(file.filename).toBe('digest-morning.md');
    const frontmatter = JSON.parse(file.content.split('\n---\n')[0].slice(4));
    expect(frontmatter).toMatchObject({ name: state.definition.name, description: state.definition.description, metadata: state.definition.metadata, 'disable-model-invocation': true, 'user-invocable': true });
    expect(file.content).toContain(state.definition.content);
    expect(file.content).not.toContain('/workspace/');
  });

  it('内容、文件位置或来源变化不导出旧选择；旧工作区不能发起读取', async () => {
    const { manager, state, registry } = setup();
    const row = (await manager.list('workspace-a')).entries.find(row => row.source === 'project-dsh');
    const detail = await manager.inspect(row.id, 'workspace-a');
    state.definition = { ...state.definition, content: 'changed' };
    await expect(manager.exportMarkdown(row.id, detail.fingerprint, 'workspace-a')).rejects.toThrow('已变更');
    state.definition.path = '/workspace/.dsh/skills/new/SKILL.md';
    await expect(manager.inspect(row.id, 'workspace-a')).rejects.toThrow('来源已变更');
    state.definition.source = 'runtime';
    await expect(manager.inspect(row.id, 'workspace-a')).rejects.toThrow('来源已变更');
    registry.get.mockClear(); state.binding = 'workspace-b';
    await expect(manager.list('workspace-a')).rejects.toThrow('工作区已切换');
    await expect(manager.inspect(row.id, 'workspace-a')).rejects.toThrow('工作区已切换');
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('不接收任意路径或其他来源；计划读取失败不冒充没有关联', async () => {
    const { manager } = setup({ plans: async () => { throw Error('账本暂不可读'); } });
    for (const id of ['/etc/passwd', 'project-dsh:../../secret:x', 'user-dsh:private:x']) await expect(manager.inspect(id, 'workspace-a')).rejects.toThrow();
    const detail = await manager.inspect('builtin:worker-persona-memo', 'workspace-a');
    expect(detail).toMatchObject({ plans: null, plansError: '账本暂不可读', type: 'persona' });
    expect(detail.restrictions.join(' ')).toContain('不作为普通任务');
  });

  it('面板真实路由读取、查看与导出共用工作区只读边界，无业务动作', async () => {
    const { manager } = setup();
    const executions = new WorkspaceExecution();
    let route;
    const runtime = { skillManagement: manager, inspectWorkspace: fn => executions.read(fn), delegate: vi.fn(), digestRunNow: vi.fn(), updateWorkspaceConfig: vi.fn() };
    registerPanel({ effect: fn => fn(), connection: { fetch: { register: value => { route = value; } } } }, runtime);
    const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/24pa', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json();
    const catalog = await call('skills.catalog', { workspaceBinding: 'workspace-a' });
    expect(catalog.ok).toBe(true);
    const detail = await call('skills.inspect', { workspaceBinding: 'workspace-a', id: 'builtin:digest-morning' });
    expect(detail.ok).toBe(true);
    const file = await call('skills.export', { workspaceBinding: 'workspace-a', id: detail.value.id, fingerprint: detail.value.fingerprint });
    expect(file.value.content).toContain('digest-morning');
    expect((await call('skills.catalog', {})).ok).toBe(false);
    for (const method of ['delegate', 'digestRunNow', 'updateWorkspaceConfig']) expect(runtime[method]).not.toHaveBeenCalled();
  });
});
