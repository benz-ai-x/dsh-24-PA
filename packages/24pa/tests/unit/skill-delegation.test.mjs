import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaRuntime } from '../../lib/runtime.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, path, runtimes, starts, definition;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pa24-skill-'))); path = join(root, 'workspace'); await mkdir(path);
  runtimes = []; starts = [];
  definition = { name: 'chosen', source: 'project-dsh', content: 'ORIGINAL_BODY', metadata: { track: 'agent', tools: ['pa24_work'] } };
  await writeFile(join(path, 'AGENTS.md'), '```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, maxWorkers: 1, enabledWorkers: ['skill', 'memo'], extraBusinessSkills: ['chosen'] }) + '\n```');
});
afterEach(async () => { for (const rt of runtimes) await rt.stop(); await rm(root, { recursive: true, force: true }); });
async function runtime() {
  let agent;
  const ctx = { get: () => null, skills: { register: () => () => {}, get: async name => name === 'chosen' ? structuredClone(definition) : undefined, list: async () => [definition] },
    workspaceRegistry: { create: async p => ({ id: p, path: p, title: '24私助' }) },
    sessionController: { create: async () => {}, rename: async () => {}, resolveAgent: async () => ({ agent }) },
    subagents: { startActivation: async spec => { starts.push(spec); }, interrupt: () => {}, sendMessage: vi.fn() },
  };
  const rt = new PaRuntime(ctx, { stateDirectory: root, workspacePath: '', env: {}, reminderTickMs: 60000, larkCliBin: 'missing', wecomCliBin: 'missing', cliTimeoutMs: 1000 });
  runtimes.push(rt); await rt.bind(path);
  agent = { id: await rt.openLocalSession(), session: { header: { cwd: path, agentPreset: 'pa24' } }, ctx: {} };
  return { rt, agent, ctx };
}
const args = { worker: 'skill', title: '执行选定任务', instruction: '完成', skill: 'chosen' };
async function block(rt, agent) {
  await rt.repos.workItems.insert({ id: 'occupied', title: '占位', role: 'memo', instruction: 'wait', origin: 'local', parent_session_id: agent.id, child_session_id: 'occupied', delivery: `local:${agent.id}`, status: 'running' });
}
it('排队并重建 runtime 后仍执行准入时的同一份 skill 定义', async () => {
  const first = await runtime(); await block(first.rt, first.agent);
  const admitted = await first.rt.delegate(args, first.agent);
  expect((await first.rt.repos.workItems.get(admitted.workId)).skill).toBe('chosen'); expect(starts).toHaveLength(0);
  await first.rt.stop();
  definition.content = 'CHANGED_BODY'; definition.metadata.track = 'template';
  const second = await runtime(); await second.rt.repos.workItems.update('occupied', { status: 'stopped' }); await second.rt.pump();
  expect(starts).toHaveLength(1);
  expect(JSON.stringify(starts[0].request.prompt)).toContain('ORIGINAL_BODY');
  expect(JSON.stringify(starts[0].request.prompt)).not.toContain('CHANGED_BODY');
  expect((await second.rt.repos.workItems.get(admitted.workId)).skill_definition.track).toBe('agent');
});
it('模板在委派前拒绝；撤销授权后的排队事项不启动模型', async () => {
  const { rt, agent } = await runtime(); definition.metadata.track = 'template';
  await expect(rt.delegate(args, agent)).rejects.toThrow(/模板轨/); expect(await rt.repos.workItems.list()).toHaveLength(0);
  definition.metadata.track = 'agent'; await block(rt, agent);
  const admitted = await rt.delegate(args, agent);
  await rt.updateWorkspaceConfig({ extraBusinessSkills: [] });
  await rt.repos.workItems.update('occupied', { status: 'stopped' }); await rt.pump();
  expect(starts).toHaveLength(0); expect((await rt.repos.workItems.get(admitted.workId)).status).toBe('failed');
});
it('继续事项也重新校验当前启用角色和授权，不靠旧快照扩大权限', async () => {
  const { rt, agent, ctx } = await runtime(); const admitted = await rt.delegate(args, agent);
  await rt.repos.workItems.update(admitted.workId, { status: 'completed' });
  await rt.updateWorkspaceConfig({ enabledWorkers: ['memo'] });
  await expect(rt.control({ action: 'continue', workId: admitted.workId, instruction: '继续' }, agent)).rejects.toThrow(/撤销启用/);
  expect(ctx.subagents.sendMessage).not.toHaveBeenCalled();
});
