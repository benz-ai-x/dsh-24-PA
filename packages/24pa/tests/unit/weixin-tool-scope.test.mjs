import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Context } from '@deepseek-ai/cordis';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import { apply } from '../../lib/tools.js';
import { PaRuntime } from '../../lib/runtime.js';
import { mountBusinessToolScope } from '../../lib/business-tool-scope.js';
import { installToolRuntime, executeTool } from '../helpers/tool-runtime.mjs';

const require = createRequire(import.meta.url);
const { createScope } = await import(createRequire(require.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-scope'));
const contexts = [];
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); });
const leadTools = ['pa24_delegate', 'pa24_jobs', 'pa24_memory'];
const workerTools = ['pa24_work', 'pa24_memory', 'pa24_run'];

async function fixture(policyFor) {
  const ctx = new Context(); contexts.push(ctx); await installToolRuntime(ctx);
  let active = true, writes = 0, created;
  const runtime = {
    skillRuns: { codingTools: async () => null }, configFor: () => ({}), providerAvailable: () => false,
    noteExtraToolResolution: () => {}, workspaceRulesSection: () => '', assertCall: async () => {},
    roleForToolMount: agent => agent.id === 'wx' ? 'weixin-access' : 'worker',
    roleFor: agent => agent.id === 'wx' ? active ? 'weixin-access' : null : 'worker',
    businessToolPolicy: policyFor ?? (agent => agent?.id === 'wx' ? { allow: leadTools, active }
      : agent?.id === 'worker' ? { allow: workerTools, active: true } : agent?.parentAgent?.id === 'wx' ? { allow: [], active: false } : null),
    control: async () => ({ items: [] }), work: async () => ({ ok: true }),
  };
  // Use the production plugin with the real Host registry, scope chain and executor.
  apply({ ...ctx, get: name => name === 'pa24' ? runtime : name === 'loader' ? { import: name => import(name) } : ctx.get(name),
    effect: fn => ctx.effect(fn), tools: ctx.tools, systemPrompt: ctx.systemPrompt,
    on: (name, fn) => { if (name === 'agent/created') created = fn; } });
  async function agent(id, parent) {
    const value = { id, parentAgent: parent, session: { id, header: { cwd: '/fixture', agentPreset: 'pa24',
      ...(parent ? { parentSession: parent.id, origin: 'subagent' } : {}) }, ownEvents: () => [] } };
    let scope;
    await ctx.plugin(Object.assign(inner => { scope = createScope(inner, value); }, { inject: ['tools', 'systemPrompt'] }));
    value.ctx = scope.ctx;
    await created({ agent: value });
    return value;
  }
  const root = await agent('wx');
  const tool = name => ({ name, description: name, parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] }, execute: async () => { writes++; return {}; } });
  return { ctx, root, agent, tool, get writes() { return writes; }, disable: () => { active = false; },
    execute: (agent, name, args = {}) => executeTool(ctx, { agent, callId: name, name, arguments: args, signal: new AbortController().signal }),
    async modelTools(agent) {
      const assembled = await ctx.systemPrompt.assemble({ scope: agent, signal: new AbortController().signal });
      return assembled.tools.map(tool => tool.name).sort();
    } };
}

describe('微信会话的实际宿主 scoped tools 边界', () => {
  it('晚挂载的团队/未知工具既不进入模型目录，也不能直接或嵌套执行', async () => {
    const f = await fixture();
    f.root.ctx.tools.register(f.tool('team_task_create'));
    f.root.ctx.tools.register(f.tool('unexpected_scoped_tool'));
    expect(await f.modelTools(f.root)).toEqual([...leadTools].sort());
    expect((await f.execute(f.root, 'team_task_create')).isError).toBe(true);
    expect((await f.execute(f.root, 'unexpected_scoped_tool')).isError).toBe(true);
    f.ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }));
    const nested = await new ToolExecutionPipeline(f.ctx).prepare({ agent: f.root, callId: 'nested', name: 'unexpected_scoped_tool',
      arguments: {}, parent: Symbol('program-subcall'), signal: new AbortController().signal });
    expect(nested.kind).toBe('post-result'); expect(nested.result.isError).toBe(true);
    expect(f.writes).toBe(0);
    expect((await f.execute(f.root, 'pa24_jobs', { action: 'list' })).isError).not.toBe(true);
  });
  it('原生业务 Worker 使用自身白名单；未登记的子会话不能继承可执行权限', async () => {
    const f = await fixture(), worker = await f.agent('worker', f.root);
    worker.ctx.tools.register(f.tool('team_task_create'));
    expect(await f.modelTools(worker)).toEqual([...workerTools].sort());
    expect((await f.execute(worker, 'team_task_create')).isError).toBe(true);
    expect((await f.execute(worker, 'pa24_work', { action: 'memo_find' })).isError).not.toBe(true);
    const unknown = await f.agent('unregistered', f.root);
    unknown.ctx.tools.register(f.tool('team_task_create'));
    expect((await f.execute(unknown, 'team_task_create')).isError).toBe(true);
    expect(f.writes).toBe(0);
  });
  it('停用立即收紧已挂载会话，其他独立会话保持原工具执行能力', async () => {
    const f = await fixture(); f.disable();
    expect((await f.execute(f.root, 'pa24_jobs', { action: 'list' })).isError).toBe(true);
    const local = await f.agent('local'); local.ctx.tools.register(f.tool('team_task_create'));
    expect((await f.execute(local, 'team_task_create')).isError).not.toBe(true);
    expect(f.writes).toBe(1);
  });
  it('本地创建的业务 Worker 在微信续办前后保持自身工具范围，原父会话不变', async () => {
    const rt = new PaRuntime({ skills: null, get: () => null }, { env: {}, workspacePath: '' });
    rt.workspace = { statePath: '/fixture' };
    const work = { role: 'tasks', parent_session_id: 'local', delivery_target: { channel: 'local' } };
    rt.workItemByChild.set('worker', work);
    const f = await fixture(agent => rt.businessToolPolicy(agent));
    const local = await f.agent('local'), worker = await f.agent('worker', local);
    worker.ctx.tools.register(f.tool('team_task_create'));
    expect(await f.modelTools(worker)).toEqual([...workerTools].sort());
    expect((await f.execute(worker, 'team_task_create')).isError).toBe(true);
    // A hot continuation keeps the same native Agent; the new input must not
    // require another agent/created event or change the original reply target.
    rt.workItemByChild.set('worker', { ...work, execution_scope: { ownerInput: { kind: 'weixin' } } });
    expect((await f.execute(worker, 'team_task_create')).isError).toBe(true);
    expect((await f.execute(worker, 'pa24_work', { action: 'memo_find' })).isError).not.toBe(true);
    expect(rt.workItemByChild.get('worker')).toMatchObject(work);
    expect(f.writes).toBe(0);
  });
  it('缺失执行门禁时装配失败，不退回只限制全局工具的旧路径', async () => {
    const agent = { id: 'wx', ctx: { plugin: spec => ({ await: async () => spec.apply({ tools: {} }) }) } };
    await expect(mountBusinessToolScope({ get: () => ({ import: name => import(name) }) }, agent,
      () => ({ allow: leadTools, active: true }))).rejects.toThrow('工具执行门禁');
  });
  it('真实角色判定保留退休身份、受管 Worker 与普通本地会话的边界', () => {
    const rt = new PaRuntime({ skills: null, get: () => null }, { env: {}, workspacePath: '' });
    rt.workspace = { statePath: '/fixture' }; rt.backupWorkspaceId = 'workspace';
    const binding = { session_id: 'wx', workspace_id: 'workspace', state: 'active', enabled: true, generation: 'generation' };
    rt.weixin.register([binding]);
    const root = { id: 'wx', session: { header: { cwd: '/fixture', agentPreset: 'pa24' } } };
    expect(rt.businessToolPolicy(root)).toEqual({ allow: leadTools, active: true });
    const child = { id: 'work', parentAgent: root, session: { header: { cwd: '/fixture', parentSession: 'wx', origin: 'subagent' } } };
    expect(rt.businessToolPolicy(child)).toEqual({ allow: [], active: false });
    rt.workItemByChild.set(child.id, { role: 'tasks', parent_session_id: 'wx' });
    expect(rt.businessToolPolicy(child)).toEqual({ allow: workerTools, active: true });
    rt.weixin.register([{ ...binding, enabled: false, state: 'retired' }]);
    expect(rt.businessToolPolicy(root)).toEqual({ allow: leadTools, active: false });
    expect(rt.businessToolPolicy(child)).toEqual({ allow: workerTools, active: true });
    expect(rt.businessToolPolicy({ id: 'local', session: { header: { cwd: '/fixture', agentPreset: 'pa24' } } })).toBeNull();
  });
});
