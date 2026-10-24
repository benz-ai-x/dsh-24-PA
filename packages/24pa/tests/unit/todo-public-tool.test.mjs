import { afterEach, expect, it } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import ToolRuntime, { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { apply } from '../../lib/tools.js';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const source = (id, patch = {}) => ({ id, domain: 'todo', platform: 'feishu', name: id, purpose: 'personal', ownerId: 'owner', resourceKind: 'tasklist', resourceId: 'list', filter: 'all', access: 'readwrite', enabled: true, ...patch });
const config = entry => ({ version: 1, entries: [entry], defaults: { todo: entry.id, calendar: null }, mappings: [], meetingDurationMinutes: null });
async function setup(entry = source('first')) {
  const f = await fixture(); cleanups.push(f.cleanup);
  const state = join(f.root, 'lark.json'), bin = join(f.root, 'lark-cli');
  const auth = { ownerOpenId: 'owner', appId: 'cli_test_app' };
  await writeFile(state, JSON.stringify(auth));
  await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
  f.options.larkCliBin = bin;
  await f.rt.bind(await f.workspace('workspace', { mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'list', folderToken: 'folder', enabledWorkers: ['tasks'], sources: config(entry) }));
  const local = f.agents.get(await f.rt.openLocalSession());
  const delegated = await f.rt.delegate({ worker: 'tasks', title: '核对原待办', instruction: '本人明确办理待办与分派' }, local);
  const child = f.agents.get(delegated.workId), ctx = new Context();
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); cleanups.push(() => ctx.fiber.dispose());
  let definition;
  apply({ get: () => f.rt, on: () => {}, effect: fn => fn(), tools: { register: value => { if (value.name === 'pa24_work') definition = value; return () => {}; } }, systemPrompt: { section: () => () => {} } });
  ctx.tools.register(definition);
  let callId = 0;
  const execute = async args => {
    expect(validateJsonSchemaValue(definition.parameters, args)).toEqual([]);
    return ctx.tools.execute({ callId: 'todo-' + callId++, name: 'pa24_work', arguments: args, agent: child, signal: new AbortController().signal });
  };
  const run = async args => { const result = await execute(args); expect(result.isError, JSON.stringify(result)).toBe(false); return result.value; };
  const calls = async () => (await readFile(state + '.calls.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
  const supplement = async instruction => {
    const item = await f.rt.repos.workItems.get(child.id);
    await f.rt.changeWork({ op: 'supplement', workId: child.id, expectedRevision: item.revision, workspaceBinding: f.rt.workspaceBinding,
      requestId: randomUUID(), confirm: true, instruction }, local);
    // This fixture has no agent event loop. Model the accepted continuation's
    // pre-step wait removal; actual Loader coverage verifies this transition.
    await f.rt.workerRuns.clearWait(child.id);
  };
  return { ...f, state, auth, child, execute, run, calls, supplement };
}

it('实际 pa24_work 使用原回执恢复本地编号，身份切换后相同 GUID 不自动改绑或关联，新授权操作保留交办关联', async () => {
  const f = await setup();
  const created = await f.run({ action: 'task_create', summary: '原待办', description: '原描述', assigneeIds: ['owner'] });
  const local = await f.rt.repos.tasks.byGuid(created.guid);
  expect((await f.run({ action: 'task_update', taskId: local.id, description: '修改原描述' })).verification.state).toBe('verified');
  f.rt.config.sources = config(source('second')); await f.rt.sourceRegistry.synchronize();
  await writeFile(f.state, JSON.stringify({ ...f.auth, appId: 'second_app' }));
  const listed = await f.run({ action: 'task_list', role: 'all', deadline: 'all' });
  expect(listed.tasks[0]).toMatchObject({ guid: created.guid, taskId: null, workItemIds: [] });
  expect(listed.tasks[0].objectId).not.toBe(created.objectId);
  const patches = (await f.calls()).filter(row => row.args.includes('patch')).length;
  const rejected = await f.execute({ action: 'task_update', taskId: local.id, summary: '不可改绑' });
  expect(rejected.isError).toBe(false); expect(rejected.value).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(JSON.stringify(rejected)).toMatch(/原目标|来源/);
  expect((await f.calls()).filter(row => row.args.includes('patch'))).toHaveLength(patches);
  await f.supplement('已核对身份变化；明确办理 second 来源的新对象，保留原对象关联。');
  const changed = await f.run({ action: 'task_update', sourceId: 'second', objectId: listed.tasks[0].objectId, guid: created.guid, description: '新身份对象的独立修改' });
  expect(changed.verification.state).toBe('pending'); expect(changed.verification.message).toMatch(/GUID.*冲突/);
  expect((await f.rt.repos.tasks.get(local.id)).id).toBe(local.id);
  expect((await f.rt.repos.tasks.get(local.id)).summary).toBe('原待办');
  const afterExplicitUpdate = (await f.run({ action: 'task_list', role: 'all' })).tasks[0];
  expect(afterExplicitUpdate.taskId).toBeNull(); // 不借用另一身份下的本地镜像。
  expect(afterExplicitUpdate.workItemIds).toEqual([f.child.id]); // 新身份的明确操作回执关联本次交办。
});

it('实际公共工具拒绝无来源证据的旧本地编号，即便指定了当前来源', async () => {
  const f = await setup();
  const created = await f.run({ action: 'task_create', summary: '原件' });
  const local = await f.rt.repos.tasks.byGuid(created.guid);
  await f.rt.repos.operations.update(local.id, { status: 'succeeded', receipt: { guid: created.guid } });
  const before = (await f.calls()).length;
  const result = await f.execute({ action: 'task_complete', taskId: local.id, sourceId: 'first', effect: 'whole' });
  expect(result.isError).toBe(false); expect(result.value).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(JSON.stringify(result)).toMatch(/持久证据/);
  expect(await f.calls()).toHaveLength(before);
  await f.supplement('不再办理旧编号，仅查询当前来源待办。');
  expect((await f.run({ action: 'task_list', role: 'all' })).tasks[0].taskId).toBeNull();
});

it('实际工具保留允许尝试的权限证据，平台明确拒绝创建不能报告成功', async () => {
  const f = await setup(source('personal', { resourceKind: 'authorized_scope', resourceId: 'authorized' }));
  for (const assigneeIds of [[], Array(51).fill('owner')]) {
    const rejected = await f.execute({ action: 'task_create', summary: '不可创建', assigneeIds });
    expect(rejected.isError).toBe(false); expect(rejected.value).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(JSON.stringify(rejected)).toMatch(/1–50/);
    await f.supplement('重新指定本次创建的负责人，未满足参数前不创建。');
  }
  expect((await f.calls()).some(row => row.args.includes('create'))).toBe(false);
  const created = await f.run({ action: 'task_create', summary: '本人记录', assigneeIds: ['owner'], description: '说明' });
  expect(created.permissionEvidence).toEqual({ capability: 'create', verdict: 'attemptable' });
  expect(created.sourceTarget.permission.verdict).toBe('attemptable');
  const assigned = await f.run({ action: 'task_assign', guid: created.guid, assigneeIds: ['other'], instruction: '分派给 other' });
  expect(assigned.assignees.some(person => person.id === 'other')).toBe(true);
  await writeFile(f.state, JSON.stringify({ ...f.auth, failNext: { command: 'task.create', error: 'write scope denied' } }));
  const failed = await f.execute({ action: 'task_create', summary: '没有写权限' });
  expect(failed.isError).toBe(true); expect(JSON.stringify(failed)).toMatch(/write scope denied/);
  expect((await f.rt.repos.operations.todoWritesForWork(f.child.id)).filter(row => row.params.summary === '没有写权限').every(row => row.status !== 'succeeded' && !row.receipt?.platformAccepted)).toBe(true);
});
