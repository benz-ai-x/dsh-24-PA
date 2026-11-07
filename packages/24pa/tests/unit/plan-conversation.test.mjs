import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { createDailyScheduleRecord, createWeeklyScheduleRecord, createAtScheduleRecord, ScheduleId } from '@deepseek-ai/dsh-schedule';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { apply } from '../../lib/tools.js';
import { fixture, join, writeFile } from '../helpers/runtime.mjs';
import { installToolRuntime, executeTool } from '../helpers/tool-runtime.mjs';

let f, parent, toolContext, definition, nativeRows, creates, turn, callId;
beforeEach(async () => {
  f = await fixture({ env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'fixture-secret' } });
  nativeRows = []; creates = 0; turn = 0; callId = 0;
  const record = (id, input) => input.daily ? createDailyScheduleRecord(id, input.prompt, input.daily, Date.now(), input.title)
    : input.weekly ? createWeeklyScheduleRecord(id, input.prompt, input.weekly, Date.now(), input.title)
    : createAtScheduleRecord(id, input.prompt, input.at, Date.now(), input.title);
  const native = { create: async (sessionId, input) => {
    creates++; const row = { ...record(ScheduleId('test-native-' + randomUUID()), input), sessionId, status: 'active' }; nativeRows.push(row); return row;
  }, catalog: async () => structuredClone(nativeRows), delete: async ({ id }) => { nativeRows = nativeRows.filter(row => row.id !== id); return { deleted: true }; },
  update: async ({ id, sessionId, change, prompt, title }) => { const row = { ...record(id, { ...change, prompt, title }), sessionId, status: 'active' };
    nativeRows = nativeRows.map(old => old.id === id ? row : old); return { record: row, updated: true }; } };
  const get = f.ctx.get; f.ctx.get = name => name === 'schedule' ? native : get(name);
  const state = join(f.root, 'lark.json'), bin = join(f.root, 'lark-cli');
  await writeFile(state, JSON.stringify({ ownerOpenId: 'owner', appId: 'cli_test_app' }));
  await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755); f.options.larkCliBin = bin;
  await f.rt.bind(await f.workspace('plan-consistency', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list',
    maxWorkers: 8, enabledWorkers: ['reminders', 'skill', 'digest', 'calendar'], extraBusinessSkills: ['daily-planning', 'daily-review'] }));
  parent = f.agents.get(await f.rt.openLocalSession());
  toolContext = new Context(); await installToolRuntime(toolContext);
  apply({ get: () => f.rt, on: () => {}, effect: fn => fn(), tools: { register: value => { if (value.name === 'pa24_work') definition = value; return () => {}; } }, systemPrompt: { section: () => () => {} } });
  toolContext.tools.register(definition);
});
afterEach(async () => { vi.restoreAllMocks(); await toolContext?.fiber.dispose(); await f?.cleanup(); });
const ownerSays = text => {
  const id = randomUUID(), currentTurn = ++turn; parent.session.ownEvents = () => [{ type: 'turn/start', data: { turn: currentTurn } },
    { type: 'user/message', data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } }];
  return id;
};
const delegate = async (text, consume = true) => {
  ownerSays(text);
  const item = await f.rt.delegate({ worker: 'reminders', title: '管理我的周期计划', instruction: '按本次主人消息管理计划' }, parent);
  const child = f.agents.get(item.workId), input = f.nativeInputs.get('start-' + item.workId);
  if (consume) child.session.ownEvents().push(...[{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: input }, { type: 'step/start', data: { turn: 1, step: 1 } }].map(event => ({ ...event, time: Date.now() })));
  return child;
};
const execute = async (child, args) => {
  expect(validateJsonSchemaValue(definition.parameters, args)).toEqual([]);
  return executeTool(toolContext, { callId: 'plan-' + ++callId, name: 'pa24_work', arguments: args, agent: child, signal: new AbortController().signal });
};
const run = async (child, args) => { const result = await execute(child, args); expect(result.isError, JSON.stringify(result)).toBe(false); return result.value; };
const confirm = async preview => {
  const child = await delegate(preview.confirmationText);
  return { child, input: { action: 'digest_control', op: 'confirm', previewId: preview.previewId, instruction: preview.confirmationText } };
};
const command = (op, row, extra = {}) => ({ op, id: row?.id, expectedRevision: row?.revision, workspaceBinding: f.rt.workspaceBinding, requestId: randomUUID(), ...extra });

it('PC-01/03 实际公共工具新建晨报与面板同默认，预览无写入，主人确认才启用且不重复', async () => {
  const child = await delegate('为我新建每天九点的智能晨报，带语音。');
  const preview = await run(child, { action: 'digest_enable', kind: 'morning', voice: true });
  const panel = await f.rt.taskPlans.draft({ preset: 'morning', workspaceBinding: f.rt.workspaceBinding });
  expect(preview.configuration.skillId).toBe(panel.configuration.skillId);
  expect(preview).toMatchObject({ pendingConfirmation: true, usesModel: true, voice: true, timeZone: 'Asia/Shanghai', authorization: { delivery: { channel: 'feishu', target: 'owner' } } });
  expect(preview.message).toContain('不会自动采纳'); expect(creates).toBe(0); expect(await f.rt.repos.digests.listPlans()).toEqual([]);
  const forged = await execute(child, { action: 'digest_control', op: 'confirm', previewId: preview.previewId, instruction: preview.confirmationText });
  expect(forged.isError).toBe(true); expect(creates).toBe(0);
  const accepted = await confirm(preview);
  const [one, two] = await Promise.all([run(accepted.child, accepted.input), run(accepted.child, accepted.input)]);
  expect(one.plan.id).toBe(two.plan.id); expect(creates).toBe(1);
  expect(one.plan).toMatchObject({ voice: true, skill: 'daily-planning', owner_enabled: true, status: 'active' });
  let row = (await f.rt.taskPlans.inspect({ id: one.plan.id, workspaceBinding: f.rt.workspaceBinding })).plan;
  const edit = command('settings', row, { settings: { time: '10:00:00', voice: false } });
  const check = await f.rt.taskPlans.settingsPreview(edit); row = (await f.rt.changeTaskPlan({ ...edit, fingerprint: check.fingerprint, confirm: true })).plan;
  const listed = await run(accepted.child, { action: 'digest_list', query: row.id });
  expect(listed.plans[0]).toMatchObject({ id: one.plan.id, voice: false, skill: 'daily-planning', schedule_spec: { daily: { time: '10:00:00' } }, history: { kind: 'runs', planId: row.id } });
  expect(typeof listed.plans[0].created_at).toBe('string'); // Actual ToolRuntime rejects Date objects.
});

it('PC-01 明确固定模板不会被智能默认改写，未放行智能能力不扩展维护权限', async () => {
  const child = await delegate('我只要免模型的固定模板晨报。');
  const preview = await run(child, { action: 'digest_enable', kind: 'morning', skill: 'digest-morning' });
  expect(preview).toMatchObject({ title: '固定模板晨报', usesModel: false, configuration: { skillId: 'builtin:digest-morning' } });
  f.rt.config.extraBusinessSkills = [];
  const blocked = await execute(child, { action: 'digest_enable', kind: 'morning' });
  expect(blocked.isError).toBe(true); expect(await f.rt.repos.digests.listPlans()).toEqual([]); expect(f.rt.config.extraBusinessSkills).toEqual([]);
});

it('PC-02 面板创建的语音计划可从对话调整、暂停和恢复，同一身份与历史保留', async () => {
  const draft = await f.rt.taskPlans.draft({ preset: 'morning', skillId: 'builtin:digest-morning', workspaceBinding: f.rt.workspaceBinding });
  let row = (await f.rt.changeTaskPlan(command('save', null, { ...draft.form, delivery: { channel: 'feishu', voice: true } }))).plan;
  const before = await f.rt.taskPlans.preview({ id: row.id, workspaceBinding: f.rt.workspaceBinding });
  row = (await f.rt.changeTaskPlan(command('enable', row, { confirm: true, fingerprint: before.fingerprint }))).plan;
  const nativeId = row.schedule_id, child = await delegate('把面板里的这个晨报改为十点，语音继续。');
  const preview = await run(child, { action: 'digest_control', planId: row.id, op: 'adjust', time: '10:00:00' });
  const accepted = await confirm(preview); const edited = await run(accepted.child, accepted.input);
  expect(edited.plan).toMatchObject({ id: row.id, voice: true, status: 'active', schedule_id: nativeId, task_authorization: row.task_authorization });
  const pauseText = '暂停这个晨报。', pauseChild = await delegate(pauseText);
  const pause = { action: 'digest_control', planId: row.id, op: 'pause', instruction: pauseText };
  expect((await run(pauseChild, pause)).plan.status).toBe('paused');
  const resume = await run(pauseChild, { action: 'digest_control', planId: row.id, op: 'resume' });
  const resumeInput = await confirm(resume); expect((await run(resumeInput.child, resumeInput.input)).plan.status).toBe('active');
  await run(pauseChild, pause); // Replay the original pause receipt, not a new pause over the later resume.
  expect(await f.rt.repos.taskPlans.get(row.id)).toMatchObject({ id: row.id, voice: true, owner_enabled: true, status: 'active', task_config: { skillId: 'builtin:digest-morning' } });
  expect((await f.rt.repos.digests.listPlans()).length).toBe(1);
});

it('PC-06 同类与同名计划明确选择，预览后另入口已创建则不能重复创建', async () => {
  const child = await delegate('新建晨报。'), preview = await run(child, { action: 'digest_enable', kind: 'morning' });
  const draft = await f.rt.taskPlans.draft({ preset: 'morning', workspaceBinding: f.rt.workspaceBinding });
  for (let i = 0; i < 2; i++) await f.rt.changeTaskPlan(command('save', null, { ...draft.form, title: '我的晨报' }));
  const conflict = await confirm(preview); expect((await execute(conflict.child, conflict.input)).isError).toBe(true);
  const selection = await run(child, { action: 'digest_control', op: 'resume', query: '我的晨报' });
  expect(selection.selectionRequired).toBe(true); expect(selection.candidates).toHaveLength(2);
  expect((await run(child, { action: 'digest_enable', kind: 'morning' })).candidates).toHaveLength(2); expect(creates).toBe(0);
  const added = await run(child, { action: 'digest_enable', kind: 'morning', op: 'new' });
  expect(added.existingPlans).toHaveLength(2); expect(added.message).toContain('额外新建');
  const accepted = await confirm(added); await run(accepted.child, accepted.input);
  expect(await f.rt.repos.digests.listPlans()).toHaveLength(3); expect(creates).toBe(1);
});

it('PC-07 保存与启用之间投递身份改变，保留暂停草稿而不采用新身份', async () => {
  const child = await delegate('新建晨报。'), preview = await run(child, { action: 'digest_enable', kind: 'morning' });
  const original = f.rt.taskPlans.change.bind(f.rt.taskPlans);
  vi.spyOn(f.rt.taskPlans, 'change').mockImplementation(async input => {
    const result = await original(input);
    if (input.op === 'save') await writeFile(join(f.root, 'lark.json'), JSON.stringify({ ownerOpenId: 'owner', appId: 'another_app' }));
    return result;
  });
  const accepted = await confirm(preview); expect((await execute(accepted.child, accepted.input)).isError).toBe(true);
  expect(await f.rt.repos.digests.listPlans()).toMatchObject([{ status: 'paused', owner_enabled: false, task_authorization: null }]);
  expect(creates).toBe(0);
});

it('PC-06/07 未采用、过期、换身份及换工作区的确认不能写入', async () => {
  const child = await delegate('先预览晨报。'), preview = await run(child, { action: 'digest_enable', kind: 'morning' });
  const queued = await delegate(preview.confirmationText, false);
  expect((await execute(queued, { action: 'digest_control', op: 'confirm', previewId: preview.previewId, instruction: preview.confirmationText })).isError).toBe(true);
  const confirmed = await confirm(preview);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60000);
  expect((await execute(confirmed.child, confirmed.input)).isError).toBe(true); clock.mockRestore();
  f.rt.config.ownerOpenId = 'changed-owner';
  expect((await execute(confirmed.child, confirmed.input)).isError).toBe(true); f.rt.config.ownerOpenId = 'owner';
  for (const row of await f.rt.repos.workItems.list()) if (row.status === 'running') await f.rt.control({ action: 'stop', workId: row.id }, parent);
  await f.rt.bind(await f.workspace('different-workspace', { enabledWorkers: ['reminders'] }));
  expect((await execute(confirmed.child, confirmed.input)).isError).toBe(true);
  expect(await f.rt.repos.digests.listPlans()).toEqual([]); expect(creates).toBe(0);
});
