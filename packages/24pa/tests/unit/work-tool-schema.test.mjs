import { describe, expect, it } from 'vitest';
import ToolRuntime, { validateJsonSchemaValue, assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { PaRuntime } from '../../lib/runtime.js';
import { apply } from '../../lib/tools.js';

function registeredWork(work = async args => args, name = 'pa24_work') {
  const definitions = new Map();
  apply({
    get: () => ({ workspaceRulesSection: () => '', work, runControl: work }), on: () => { }, effect: fn => fn(),
    tools: { register: definition => { definitions.set(definition.name, definition); return () => { }; } },
    systemPrompt: { section: () => () => { } }
  });
  return definitions.get(name);
}

const minimal = {
  memo_save: { topic: '备忘', content: '内容' }, memo_find: { query: '备忘' }, digest_summarize: { topic: '资料', content: '摘要' },
  task_create: { summary: '待办' }, task_update: { taskId: 't1', summary: '更名' }, task_complete: { guid: 'g1' }, task_get: { taskId: 't1' }, task_cancel: { taskId: 't1', reason: '本人取消' }, task_list: { status: 'open' },
  project_create: { name: '项目' }, project_adopt: { projectId: 'p1', tasks: [{ summary: '步骤' }] }, project_progress: { projectId: 'p1' },
  outreach_send: { openId: 'ou_1', content: '请查收', instruction: '发给甲' }, task_assign: { taskId: 't1', assigneeIds: ['ou_1'], instruction: '交给甲' },
  task_repeat_create: { title: '日报', kind: 'daily', time: '09:00:00' }, task_repeat_list: {}, task_repeat_skip: { templateId: 'tt1' }, task_repeat_stop: { templateId: 'tt1' }, task_repeat_update: { templateId: 'tt1', title: '新标题' },
  waiting_create: { title: '等材料', checkpointInSeconds: 60 }, waiting_list: {}, waiting_control: { waitingId: 'w1', op: 'received' },
  skill_run: { skill: 'authorized' }, digest_build: { kind: 'morning' }, digest_deliver: { report: '简报' },
  calendar_query: { from: '2026-10-20T00:00:00+08:00', to: '2026-10-21T00:00:00+08:00' }, calendar_busy: { from: '2026-10-20T00:00:00+08:00', to: '2026-10-21T00:00:00+08:00' },
  calendar_create: { summary: '安排', start: '2026-10-20T09:00:00+08:00', end: '2026-10-20T10:00:00+08:00' }, calendar_update: { eventId: 'e1', summary: '新标题' }, calendar_cancel: { eventId: 'e1' },
  calendar_sources: {}, calendar_reminders: { eventId: 'e1', reminderMinutes: [] },
  meeting_schedule: { title: '会议', start: '2026-10-20T09:00:00+08:00', end: '2026-10-20T10:00:00+08:00', attendees: [{ openId: 'ou_1' }], instruction: '邀请甲' },
  plan_today: { date: '2026-10-20' }, meeting_prep_enable: { eventId: 'e1' }, meeting_prep_build: { planId: 'p1' }, plan_preview: { date: '2026-10-20' }, plan_adopt: { blocks: [{ summary: '安排', start: '2026-10-20T09:00:00+08:00', end: '2026-10-20T10:00:00+08:00' }] }, overview_today: {},
  reminder_create: { kind: 'once', text: '提醒', afterSeconds: 60 }, reminder_list: {}, reminder_cancel: { ruleId: 'r1', reason: '取消' }, reminder_pause: { ruleId: 'r1' }, reminder_resume: { ruleId: 'r1' }, reminder_skip: { ruleId: 'r1' }, reminder_snooze: { ruleId: 'r1', seconds: 60 }, reminder_status: { occurrenceId: 'occ1' },
  digest_enable: { kind: 'morning', time: '09:00:00' }, digest_control: { planId: 'p1', op: 'pause' }, digest_list: {},
  minutes_build: { topic: '会议', content: '纪要', candidates: [{ summary: '行动' }] }, minutes_adopt_actions: { minutesId: 'm1', indexes: [0], instruction: '采纳第一项' },
  note_submit: { transcript: '原文', summary: '摘要', pages: [{ pageNo: 1, transcript: '原文' }] }, note_adopt_actions: { noteId: 'N-1', versionId: 'v1', indexes: [0], instruction: '采纳第一项' }, notes_search: { query: '笔记' },
};

describe('真实注册的 Worker 模型接口', () => {
  it('pa24_run progress 只要求进展字段，等待原因由运行时按 action 校验', async () => {
    const ctx = new Context(); let received;
    const args = { action: 'progress', stage: '整理资料', completed: '核对输入', next: '保存结果' };
    expect(validateJsonSchemaValue(registeredWork(undefined, 'pa24_run').parameters, args)).toEqual([]);
    try {
      await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
      ctx.tools.register(registeredWork(async value => { received = value; return value; }, 'pa24_run'));
      const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: 'progress', name: 'pa24_run', arguments: args });
      expect(result.isError).not.toBe(true); expect(received).toEqual(args);
    } finally { await ctx.fiber.dispose(); }
  });
  it('每个正式绑定动作都有模型 payload 契约，角色权限仍由 runtime 校验', () => {
    const runtime = new PaRuntime({ skills: null, get: () => null }, { env: {}, workspacePath: '' });
    const bound = runtime.roles.list().flatMap(role => Object.keys(role.actions));
    expect([...new Set([...bound, 'digest_summarize'])].sort()).toEqual(Object.keys(minimal).sort());
    for (const [action, args] of Object.entries(minimal)) expect(validateJsonSchemaValue(registeredWork().parameters, { action, ...args }), action).toEqual([]);
  });
  it('实际 ToolRuntime 将任务编号完整交给 handler（独立于 schema 校验测试）', async () => {
    const ctx = new Context(); let received;
    try {
      await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
      ctx.tools.register(registeredWork(async args => { received = args; return { received: args }; }));
      await ctx.tools.execute({ signal: new AbortController().signal, callId: 'contract', name: 'pa24_work', arguments: { action: 'task_get', taskId: 't1' } });
      expect(received).toEqual({ action: 'task_get', taskId: 't1' });
    } finally { await ctx.fiber.dispose(); }
  });

  it('使用实装宿主支持的 schema 子集', () => { expect(() => assertSupportedJsonSchema(registeredWork().parameters)).not.toThrow(); });
  it.each([
    { action: 'task_get', taskId: 'task-1' },
    { action: 'task_create', summary: '分派', description: '说明', assigneeIds: ['ou_1'], instruction: '分给甲' },
    { action: 'task_assign', guid: 'g1', assigneeIds: ['ou_1'], instruction: '分给甲' },
    ...['self', 'whole', 'whole_event', 'personal_reminder', 'leave'].map(effect => ({ action: 'task_complete', guid: 'g1', effect })),
    ...['all', 'overdue', 'today', 'undated', 'upcoming'].map(deadline => ({ action: 'task_list', deadline, role: 'following' })),
    { action: 'task_update', guid: 'remote-1', summary: '更新', due: null, plannedAt: null, estimateMinutes: null },
    { action: 'task_create', summary: '准备材料', due: '2026-10-21', plannedAt: '2026-10-20T09:00:00+08:00', estimateMinutes: 30, projectId: 'p1' },
    { action: 'project_create', name: '项目', goal: '目标' },
    { action: 'project_adopt', projectId: 'p1', tasks: [{ summary: '第一步' }] },
    { action: 'task_cancel', taskId: 'task-1', reason: '本人取消' },
    { action: 'task_repeat_create', title: '周报', kind: 'weekly', time: '09:00:00', weekdays: [1], timeZone: 'Asia/Shanghai' },
    { action: 'waiting_control', waitingId: 'w1', op: 'snooze', inSeconds: 60, note: '稍后确认' },
    { action: 'meeting_schedule', title: '评审', start: '2026-10-21T09:00:00+08:00', end: '2026-10-21T10:00:00+08:00', attendees: [{ name: '甲', openId: 'ou_1' }], instruction: '邀请甲评审' },
    { action: 'calendar_create', summary: '评审', attendees: ['ou_1'], channel: 'feishu' },
    { action: 'meeting_prep_enable', eventId: 'e1', scopeMemo: false, scopeMemory: true, scopeTasks: false, scopeMinutes: true },
    { action: 'reminder_snooze', ruleId: 'r1', seconds: 120, reason: '稍后' },
    { action: 'reminder_status', occurrenceId: 'occ1' },
    { action: 'note_submit', transcript: '原文', pages: [{ page: 1 }], doubts: [{ text: '不明' }], diagrams: [{ description: '图' }] },
    { action: 'note_adopt_actions', noteId: 'N-1', versionId: 'v1', indexes: [0], instruction: '采纳第一项' },
  ])('合法业务参数可被模型表达：$action', args => {
    expect(validateJsonSchemaValue(registeredWork().parameters, args)).toEqual([]);
  });
  it.each([{ assigneeIds: [1] }, { description: 2 }, { effect: 'guess' }, { deadline: 'tomorrow' }])('公共待办字段拒绝错误格式：%j', args => {
    expect(validateJsonSchemaValue(registeredWork().parameters, { action: 'task_create', ...args }).length).toBeGreaterThan(0);
  });
  it.each(['_operationId', '_instruction', '_authorization', '__forceLedger', 'opSuffix'])('内部字段仍拒绝：%s', name => {
    expect(validateJsonSchemaValue(registeredWork().parameters, { action: 'task_create', [name]: 'bypass' }).length).toBeGreaterThan(0);
  });
});
