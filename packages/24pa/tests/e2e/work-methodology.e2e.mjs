// Real Loader, native Sessions, scheduler and ledger. Only model responses and
// platform processes are local fixtures; this is not a five-day user trial.
import { expect, it } from 'vitest';
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { localDay } from '../../lib/calendar-time.js';

it('近期重点→建议→采纳→复盘→原生定时建议→重启：首页与对话共享记录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pa24-method-e2e-')), workspace = join(root, 'workspace'), bin = join(root, 'bin');
  let host, cluster, llm;
  try {
    const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite', zone = 'Asia/Shanghai', date = localDay(new Date(), zone).date;
    if (storage === 'postgres') cluster = await startPgCluster();
    await mkdir(workspace); await mkdir(bin);
    const state = join(root, 'lark.json'), scriptPath = join(root, 'script.json');
    await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_methods', appId: 'cli_methods' }));
    const task = { guid: 'important-undated', summary: '客户方案', status: 'open', tasklists: [{ tasklist_guid: 'personal-list' }], members: [{ id: 'ou_methods', type: 'user', role: 'assignee' }] };
    await appendFile(state + '.tasks.jsonl', JSON.stringify(task) + '\n');
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n');
    await chmod(join(bin, 'lark-cli'), 0o755);
    const sources = { version: 1, entries: [{ id: 'todos', domain: 'todo', platform: 'feishu', name: '个人待办', purpose: 'personal', ownerId: 'ou_methods', resourceKind: 'tasklist', resourceId: 'personal-list', filter: 'all', access: 'readwrite', enabled: true }], defaults: { calendar: null, todo: 'todos' }, mappings: [], meetingDurationMinutes: null };
    await writeFile(join(workspace, 'AGENTS.md'), '# 工作方法隔离验收\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_methods', timeZone: zone, folderToken: 'folder', tasklistId: 'personal-list',
      sources, enabledWorkers: ['calendar', 'digest', 'skill'], extraBusinessSkills: ['daily-planning', 'daily-review'] }) + '\n```\n');
    await writeFile(scriptPath, '{}'); llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json'), recordInputs: true });
    const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_methods', PA24_FEISHU_APP_SECRET: 'methods-test-secret', PA24_LARK_STUB_STATE: state,
      PATH: `${bin}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'methods-test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
    host = await bootHost({ env });
    let ready = await host.waitUntil(row => !!row.workspaceBinding && !!row.workspace?.localSessionId && row.transport?.connected);
    const binding = ready.workspaceBinding;
    const invoke = async (title, input, worker = 'calendar') => {
      await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker, title, instruction: '本人确认近期重点是客户方案；确认采纳方案。', completionCriteria: '取得工具回执' },
        workerTool: { name: 'pa24_work', input }, workerReply: '规划操作已返回，请依据记录核对。' }));
      await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: ready.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: title }] } });
      try {
        const result = await host.waitUntil(row => row.work.some(work => work.title === title && ['completed', 'failed', 'needs_reconciliation'].includes(work.status)), { label: title, timeoutMs: 15000 });
        expect(result.work.find(work => work.title === title).status, JSON.stringify(result.work)).toBe('completed');
      } catch (error) {
        const work = (await host.api('snapshot')).work;
        const run = work.find(row => row.title === title);
        const detail = run ? await host.api('worker.run', { runId: run.active_worker_run_id, workspaceBinding: binding }) : null;
        throw new Error(JSON.stringify({ work, calls: detail?.calls, logs: host.logs() }) + '\n' + error.message);
      }
    };
    await invoke('确认近期成果', { action: 'focus_update', expectedRevision: 0, focuses: [{ id: 'client', title: '客户方案', outcome: '交付可评审的初稿' }], instruction: '本人确认近期重点是客户方案' });
    const todos = await host.api('action', { type: 'todos.verify', workspaceBinding: binding });
    const item = { id: 'draft', title: '客户方案初稿', outcome: '交付初稿', reason: '推进主人确认的近期成果', nextAction: '整理客户需求', focusId: 'client', references: [{ kind: 'todo', id: todos.tasks[0].objectId }], estimateMinutes: 60 };
    await invoke('提出今日安排', { action: 'daily_plan_save', date, expectedRevision: 0, items: [item] });
    expect((await host.api('home', { workspaceBinding: binding })).workPlanning.plan.content.accepted).toBeNull();
    await invoke('采纳今日安排', { action: 'daily_plan_confirm', date, expectedRevision: 1, selectedItemIds: ['draft'], instruction: '确认采纳方案' });
    await appendFile(state + '.tasks.jsonl', JSON.stringify({ ...task, status: 'completed' }) + '\n');
    await invoke('日终核对成果', { action: 'daily_review_save', date, expectedRevision: 0, acceptedRevision: 2, results: [{ itemId: 'draft', status: 'completed', detail: '原待办已核验完成' }], adjustments: ['明天先确认客户反馈'] }, 'digest');
    const reviewed = await host.api('home', { workspaceBinding: binding });
    expect(reviewed.workPlanning.review.content.results[0]).toMatchObject({ status: 'completed', evidence: 'platform' });

    await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [
      { tool: { name: 'pa24_work', input: { action: 'planning_context' } } },
      { tool: { name: 'pa24_work', input: { action: 'daily_plan_save', expectedRevision: 2, items: [{ ...item, id: 'feedback', title: '核对客户反馈', references: [] }] } } },
      { text: '新建议已保存，原采纳安排仍保留。' },
    ] }));
    const change = payload => host.api('action', { workspaceBinding: binding, requestId: randomUUID(), ...payload });
    const created = await change({ type: 'plan.change', op: 'save', title: '智能今日规划', skillId: 'builtin:daily-planning', timing: { type: 'once', at: new Date(Date.now() + 5000).toISOString() }, delivery: { channel: 'none' } });
    const preview = await host.api('plans.preview', { id: created.plan.id, workspaceBinding: binding });
    await change({ type: 'plan.change', op: 'enable', id: created.plan.id, expectedRevision: created.plan.revision, confirm: true, fingerprint: preview.fingerprint });
    let run;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const inspection = await host.api('plans.inspect', { id: created.plan.id, workspaceBinding: binding });
      const id = inspection.triggers.rows.find(row => row.run_id)?.run_id;
      if (id) { run = (await host.api('skills.run', { runId: id, workspaceBinding: binding })).run; if (!['pending', 'running', 'waiting'].includes(run.status)) break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(run?.status, JSON.stringify(run)).toBe('completed');
    const home = await host.api('home', { workspaceBinding: binding });
    expect(home.workPlanning.plan.revision).toBe(3); expect(home.workPlanning.plan.content.accepted.items[0].id).toBe('draft');
    expect(home.workPlanning.plan.content.items[0].id).toBe('feedback');
    const models = llm.requests.length, calls = await readFile(state + '.calls.jsonl', 'utf8');
    await host.api('home', { workspaceBinding: binding }); expect(llm.requests.length).toBe(models); expect(await readFile(state + '.calls.jsonl', 'utf8')).toBe(calls);
    const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot });
    ready = await host.waitUntil(row => !!row.workspaceBinding && !!row.workspace?.localSessionId);
    const restored = await host.api('home', { workspaceBinding: ready.workspaceBinding });
    expect(restored.workPlanning.plan.content.accepted.items[0].id).toBe('draft'); expect(restored.workPlanning.review.content.adjustments).toEqual(['明天先确认客户反馈']);
  } finally { await host?.stop(); await llm?.close(); await cluster?.stop(); await rm(root, { recursive: true, force: true }); }
}, 180000);
