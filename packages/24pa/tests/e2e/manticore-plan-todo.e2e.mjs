// M02/M04 integration: real Loader, native scheduler and both ledgers; only
// model responses and platform processes are replaced by isolated fixtures.
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

it('原生计划按冻结来源创建本人待办，改默认不改投；结果可从待办关联原交办运行', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pa24-plan-todo-')), workspace = join(root, 'workspace');
  let host, cluster, llm;
  try {
    const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
    if (storage === 'postgres') cluster = await startPgCluster();
    await mkdir(workspace); const bin = join(root, 'bin'); await mkdir(bin);
    const state = join(root, 'lark.json'), scriptPath = join(root, 'script.json');
    await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app' }));
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n');
    await chmod(join(bin, 'lark-cli'), 0o755);
    const sources = { version: 1, entries: ['personal', 'project'].map(id => ({ id, name: id, domain: 'todo', platform: 'feishu', resourceKind: 'tasklist', resourceId: id + '-list', purpose: id, ownerId: 'ou_test_owner', filter: 'all', access: 'readwrite', enabled: true })), defaults: { calendar: null, todo: 'personal' }, mappings: [], meetingDurationMinutes: null };
    await writeFile(join(workspace, 'AGENTS.md'), '# M02/M04 隔离集成\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'folder', tasklistId: 'legacy-list', sources, enabledWorkers: [...DEFAULT_CONFIG.enabledWorkers, 'tasks', 'skill'], extraBusinessSkills: [] }) + '\n```\n');
    await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ tool: { name: 'pa24_work', input: { action: 'task_create', summary: 'Manticore 计划待办', description: '保存来源绑定与执行证据' } } }, { text: '待办已记录；业务工作仍未完成。' }] }));
    llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json'), recordInputs: true });
    host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret', PA24_LARK_STUB_STATE: state, PATH: bin + ':' + process.env.PATH, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) } });
    const ready = await host.waitUntil(s => Boolean(s.workspaceBinding && s.workspace?.localSessionId && s.transport?.connected));
    const binding = ready.workspaceBinding;
    const change = payload => host.api('action', { workspaceBinding: binding, requestId: randomUUID(), ...payload });
    const markdown = '---\n' + JSON.stringify({ name: 'plan-todo-' + randomUUID(), description: '定时记录本人待办', metadata: { track: 'agent', tools: ['pa24_work'], pa24: { schemaVersion: 1, mode: 'business', parameters: {}, actions: ['task_create'], expectedResult: '原待办回执', completionCriteria: '记录到获准来源并核验本人负责' } } }) + '\n---\n\n按授权来源记录待办，不能改投其他来源。';
    const saved = await change({ type: 'skill.change', op: 'save', displayName: '计划待办验证', markdown });
    await change({ type: 'workspace.config-update', config: { extraBusinessSkills: [saved.entry.name] } });
    const skillId = 'managed:' + saved.entry.id;
    await change({ type: 'skill.change', op: 'publish', id: skillId, expectedRevision: saved.entry.revision, confirm: true });
    const created = await change({ type: 'plan.change', op: 'save', title: '定时记录待办', skillId, timing: { type: 'once', at: new Date(Date.now() + 6000).toISOString() }, delivery: { channel: 'none' } });
    const preview = await host.api('plans.preview', { id: created.plan.id, workspaceBinding: binding });
    await change({ type: 'plan.change', op: 'enable', id: created.plan.id, expectedRevision: created.plan.revision, confirm: true, fingerprint: preview.fingerprint });
    const catalog = await host.api('sources');
    await change({ type: 'workspace.config-update', expectedSourcesHash: catalog.configHash, config: { sources: { ...sources, defaults: { calendar: null, todo: 'project' } } } });
    let inspection, result;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      inspection = await host.api('plans.inspect', { id: created.plan.id, workspaceBinding: binding });
      const runId = inspection.triggers.rows.find(row => row.run_id)?.run_id;
      if (runId) { result = await host.api('skills.run', { runId, workspaceBinding: binding }); if (!['pending', 'running', 'waiting'].includes(result.run.status)) break; }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    expect(result?.run.status, JSON.stringify({ inspection, result })).toBe('completed');
    expect(result.run.result).toContain('业务工作仍未完成');
    expect(result.run.plan.authorization.targets[0].target.resource.id).toBe('personal-list');
    const tasks = (await readFile(state + '.tasks.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
    const rows = [...new Map(tasks.map(row => [row.guid, row])).values()];
    expect(rows).toHaveLength(1); expect(rows[0].tasklists).toEqual([{ tasklist_guid: 'personal-list' }]);
    expect(rows[0].members).toEqual([{ id: 'ou_test_owner', type: 'user', role: 'assignee' }]);
    const todos = await host.api('todos', { workspaceBinding: binding, sourceId: 'personal' });
    expect(todos.tasks[0].workItemIds).toContain(result.run.work_item_id);
    const runs = await host.api('runs', { workspaceBinding: binding, workId: result.run.work_item_id, range: 'all' });
    expect(runs.rows.some(row => row.id === result.run.id)).toBe(true);
    const modelCount = llm.requests.length;
    await host.api('todos', { workspaceBinding: binding }); await host.api('runs', { workspaceBinding: binding, range: 'all' });
    expect(llm.requests).toHaveLength(modelCount);
  } finally { await host?.stop(); await llm?.close(); await cluster?.stop(); await rm(root, { recursive: true, force: true }); }
}, 120000);
