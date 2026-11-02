import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { apply } from '../../lib/tools.js';
import { fixture } from '../helpers/runtime.mjs';
import { startPgCluster } from '../helpers/pg.mjs';

for (const storage of ['sqlite', 'postgres']) describe(`交办公共工具 / ${storage}`, () => {
  let cluster, f, ctx;
  beforeAll(async () => { if (storage === 'postgres') cluster = await startPgCluster(); });
  afterEach(async () => { await ctx?.fiber.dispose(); await f?.cleanup(); });
  afterAll(async () => { await cluster?.stop(); });

  async function setup() {
    if (cluster) await cluster.query('drop schema if exists pa24 cascade');
    f = await fixture({ env: cluster ? { PA24_PG_DSN: cluster.dsn } : {} });
    await f.rt.bind(await f.workspace('workspace', { storage, enabledWorkers: ['tasks'] }));
    const lead = f.agents.get(await f.rt.openLocalSession());
    const { workId } = await f.rt.delegate({ worker: 'tasks', title: '核对待办', instruction: '仅核对已有待办，不创建或删除' }, lead);
    const child = f.agents.get(workId);
    ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
    child.ctx = ctx;
    await f.rt.workerRuns.attach(child);
    apply({ get: () => f.rt, on: () => {}, effect: fn => fn(), tools: ctx.tools, systemPrompt: { section: () => () => {} } });
    let sequence = 0;
    const call = (name, args, agent = lead) => ctx.tools.execute({ callId: 'jobs-' + sequence++, name, arguments: args, agent, signal: new AbortController().signal });
    return { lead, child, workId, call };
  }

  it('list 与 inspect 经真实 ToolRuntime 返回可用 JSON，保留原交办和运行时间', async () => {
    const { workId, call } = await setup();
    const listed = await call('pa24_jobs', { action: 'list' });
    expect(listed.isError, JSON.stringify(listed)).not.toBe(true);
    expect(listed.value.items.find(item => item.id === workId).created_at).toMatch(/^\d{4}-.*Z$/);
    const inspected = await call('pa24_jobs', { action: 'inspect', workId });
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    expect(inspected.value.work).toMatchObject({ id: workId, status: 'running' });
    expect(inspected.value.work.created_at).toBe((await f.rt.repos.workItems.get(workId)).created_at.toISOString());
    expect(inspected.value.runs.rows[0].created_at).toMatch(/^\d{4}-.*Z$/);
    expect(inspected.value.runs.total).toBe(1);
  });

  it.each(['task_delete', 'memo_save', 'toString'])('未获当前职责允许的 %s 明确未执行，同一 Worker 可以继续合法步骤', async action => {
    const { workId, child, call } = await setup();
    const rejected = await call('pa24_work', { action, guid: 'original-todo' }, child);
    expect(rejected.isError, JSON.stringify(rejected)).not.toBe(true);
    expect(rejected.value).toMatchObject({ status: 'rejected', businessExecuted: false, action });
    expect(rejected.value.allowedActions).toContain('task_cancel');
    const work = await f.rt.repos.workItems.get(workId);
    expect(work.status).toBe('running');
    const detail = await f.rt.repos.workerRuns.detail(work.active_worker_run_id);
    expect(detail.run.status).toBe('running');
    expect(detail.calls).toHaveLength(1);
    expect(detail.calls[0]).toMatchObject({ tool: 'pa24_work', status: 'failed' });
    expect(await f.rt.repos.operations.todoWritesForWork(workId)).toHaveLength(0);
    const progress = await call('pa24_run', { action: 'progress', stage: '已核对动作', completed: '原待办未删除', next: '使用合法动作继续核对' }, child);
    expect(progress.isError, JSON.stringify(progress)).not.toBe(true);
    expect((await f.rt.repos.workerRuns.detail(work.active_worker_run_id)).calls.map(item => item.status)).toEqual(['failed', 'succeeded']);
    await f.rt.repos.workItems.assertResumable(workId);
  });
});
