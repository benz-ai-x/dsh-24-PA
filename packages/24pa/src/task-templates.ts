import { randomUUID } from 'node:crypto';
import { createEveryScheduleRecord, createDailyScheduleRecord, createWeeklyScheduleRecord, resolveRecurringOccurrence, ScheduleId, type RecurringScheduleRecord } from '@deepseek-ai/dsh-schedule';
import type { Repos, TaskTemplateRow, TaskTemplateInstanceRow } from './repo.js';
import type { ExternalOperations } from './external-operations.js';
import { text, hash, isoDate } from './util.js';
import { taskExternal } from './feishu-channels.js';

function next(record: RecurringScheduleRecord, after: number): Date {
  if (Date.parse(record.scheduledAt) > after) return new Date(record.scheduledAt);
  const resolved = resolveRecurringOccurrence(record, after);
  return new Date(resolved.nextScheduledAt ?? resolved.occurrenceAt);
}
function identity(title: string, tasklist: string, zone: string, schedule: any): string {
  return hash(JSON.stringify({ title, tasklist, zone, kind: schedule.kind, every: schedule.everySeconds ?? null, time: schedule.time ?? null, weekdays: [...new Set(schedule.weekdays ?? [])].sort() }));
}

/** One module owns the template and its occurrence chain, including recovery. */
export class TaskTemplates {
  constructor(private readonly deps: {
    repos(): Repos; zone(): string; tasklist(): string; available(): boolean;
    gate<T>(work: () => Promise<T>): Promise<T>;
    operations: ExternalOperations;
    createRemote(title: string, tasklist: string, operationId: string): Promise<{ data: any }>;
  }) {}
  create(args: Record<string, unknown>) { return this.deps.gate(() => this.createInside(args)); }
  private async createInside(args: Record<string, unknown>, replaceId?: string): Promise<unknown> {
    const title = text(args.title, 500), zone = String(args.timeZone ?? this.deps.zone()), tasklist = this.deps.tasklist();
    if (!title) throw new Error('周期任务需要标题。');
    const now = Date.now(), kind = String(args.kind), id = ScheduleId('template-validation');
    let schedule: RecurringScheduleRecord;
    if (kind === 'every') {
      const seconds = Number(args.everySeconds);
      if (!Number.isInteger(seconds) || seconds < 60) throw new Error('周期任务模板 every 需要 ≥60 秒的整数间隔。');
      schedule = createEveryScheduleRecord(id, title, seconds, now, title.slice(0, 100));
    } else if (kind === 'daily' || kind === 'weekly') {
      const time = String(args.time ?? '');
      const weekdays = Array.isArray(args.weekdays) ? [...new Set(args.weekdays.map(Number))].sort() : [];
      if (kind === 'weekly' && (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7))) throw new Error('weekly 模板需要 weekdays（ISO 1–7）。');
      schedule = kind === 'daily' ? createDailyScheduleRecord(id, title, { time, time_zone: zone }, now, title.slice(0, 100))
        : createWeeklyScheduleRecord(id, title, { time, time_zone: zone, weekdays }, now, title.slice(0, 100));
    } else throw new Error('周期模板支持 every、daily、weekly。');
    const signature = identity(title, tasklist, zone, schedule);
    const existing = (await this.deps.repos().taskTemplates.list('active')).find(row => identity(row.title, row.tasklist_id, row.time_zone, row.schedule) === signature);
    if (existing) {
      if (replaceId && existing.id !== replaceId) await this.deps.repos().taskTemplates.stop(replaceId);
      return { templateId: existing.id, nextDueAt: isoDate(existing.next_due_at), reused: true, message: '已有相同完整规则的活动模板，返回原模板。' };
    }
    const templateId = `ttpl-${signature.slice(0, 16)}-${randomUUID().slice(0, 8)}`;
    schedule = { ...schedule, id: ScheduleId(templateId) };
    const due = next(schedule, now);
    const origin = kind === 'every' ? `every ${args.everySeconds}s` : `${kind} ${args.time} ${zone}${kind === 'weekly' ? ` ${(schedule as any).weekdays.join(',')}` : ''}`;
    const row = await this.deps.repos().taskTemplates.createWithFirst({ id: templateId, title, tasklist_id: tasklist, schedule, origin_expression: origin, status: 'active', next_due_at: due, time_zone: zone }, replaceId);
    return { templateId: row.id, nextDueAt: isoDate(due), message: `周期任务模板已建立（${origin}）；每次发生生成一个真实飞书任务，支持跳过本次/停止以后。` };
  }
  async list(): Promise<unknown> {
    const templates = [];
    for (const row of await this.deps.repos().taskTemplates.list()) templates.push({ templateId: row.id, title: row.title, status: row.status, expression: row.origin_expression, nextDueAt: isoDate(row.next_due_at), recentInstances: (await this.deps.repos().taskTemplates.instancesOf(row.id, 8)).map(i => ({ dueAt: isoDate(i.due_at), status: i.status, taskId: i.task_id, error: i.error })) });
    return { templates };
  }
  private async required(args: Record<string, unknown>): Promise<TaskTemplateRow> {
    const row = await this.deps.repos().taskTemplates.get(String(args.templateId ?? ''));
    if (!row) throw new Error('模板不存在；请先建立模板。'); return row;
  }
  skip(args: Record<string, unknown>) { return this.deps.gate(async () => {
    const template = await this.required(args);
    if (template.status !== 'active' || !template.next_due_at) throw new Error('模板已停止，没有可跳过的当前实例。');
    await this.repairChain(template);
    const current = await this.required(args);
    const instance = await this.deps.repos().taskTemplates.instance(`${current.id}:${current.next_due_at!.toISOString()}`);
    if (!instance || instance.status !== 'pending') throw new Error('当前实例已处理，不能把已有外部结果解释为跳过。');
    await this.finish(current, instance, { status: 'skipped' });
    return { templateId: current.id, skippedDueAt: isoDate(instance.due_at), message: '已跳过本次；后继实例已建立，模板按计划继续。' };
  }); }
  stop(args: Record<string, unknown>) { return this.deps.gate(async () => {
    const template = await this.required(args); await this.deps.repos().taskTemplates.stop(template.id);
    return { templateId: template.id, status: 'stopped', message: '已停止以后的生成；已生成任务与历史保留。' };
  }); }
  update(args: Record<string, unknown>) { return this.deps.gate(async () => {
    const template = await this.required(args);
    const hasTiming = ['kind', 'time', 'everySeconds', 'weekdays', 'timeZone'].some(key => args[key] !== undefined);
    if (!hasTiming && !args.title) throw new Error('需要新的标题或周期规则。');
    if (!hasTiming) { await this.deps.repos().taskTemplates.update(template.id, { title: text(args.title, 500) }); return { templateId: template.id, message: '以后任务标题已修改，已生成任务不变。' }; }
    const result = await this.createInside({ title: args.title ?? template.title, kind: args.kind ?? template.schedule.kind, time: args.time ?? template.schedule.time, everySeconds: args.everySeconds ?? template.schedule.everySeconds, weekdays: args.weekdays ?? template.schedule.weekdays, timeZone: args.timeZone ?? template.time_zone }, template.id);
    return { ...result as object, oldTemplateStopped: template.id };
  }); }
  private finish(template: TaskTemplateRow, instance: TaskTemplateInstanceRow, patch: { status: string; taskId?: string; error?: string }) {
    return this.deps.repos().taskTemplates.finishAndAdvance(template, instance, patch, next(template.schedule, Math.max(Date.now(), new Date(instance.due_at).getTime())));
  }
  private async repairChain(template: TaskTemplateRow): Promise<void> {
    if (!template.next_due_at) throw new Error(`模板 ${template.id} 缺少下次发生，需核对历史规则。`);
    const due = new Date(template.next_due_at), id = `${template.id}:${due.toISOString()}`;
    const instance = await this.deps.repos().taskTemplates.instance(id);
    if (!instance) await this.deps.repos().taskTemplates.insertInstance({ id, templateId: template.id, dueAt: due });
    else if (['generated', 'skipped', 'failed'].includes(instance.status)) await this.finish(template, instance, { status: instance.status, ...(instance.task_id ? { taskId: instance.task_id } : {}), ...(instance.error ? { error: instance.error } : {}) });
  }
  tick(): Promise<number> { return this.deps.gate(async () => {
    if (!this.deps.available()) return 0;
    const repos = this.deps.repos();
    for (const instance of await repos.taskTemplates.recoverableInstances()) {
      const op = await repos.operations.get(`ttask:${instance.id}`);
      // A prior durable result permits projection repair; an unacknowledged
      // running operation is handled below as unknown, never sent a second time.
      if (instance.status === 'generating' || op?.receipt?._externalResult !== undefined) {
        const template = await repos.taskTemplates.get(instance.template_id);
        if (template?.status === 'active') await repos.taskTemplates.updateInstance(instance.id, { status: 'pending' });
      }
    }
    for (const template of await repos.taskTemplates.list('active')) await this.repairChain(template);
    let generated = 0;
    for (const instance of await repos.taskTemplates.claimDueInstances(new Date(), 20)) {
      const template = (await repos.taskTemplates.get(instance.template_id))!;
      const operationId = `ttask:${instance.id}`;
      try {
        const staged = await this.deps.operations.stageWithId(operationId, { id: 'pa24-system-templates' }, 'task.repeat_generate', { instanceId: instance.id, title: template.title, tasklist: template.tasklist_id });
        if (!staged.created) { await this.finish(template, instance, { status: 'generated', taskId: operationId }); continue; }
        const title = String(staged.row.params.title), tasklist = String(staged.row.params.tasklist ?? template.tasklist_id);
        const { data } = await this.deps.operations.perform(operationId, () => this.deps.createRemote(title, tasklist, operationId));
        const external = taskExternal(data);
        await repos.tasks.save({ id: operationId, work_item_id: null, task_guid: external.guid, url: external.url, summary: title, due_at: instance.due_at, due_has_time: true, planned_at: null, estimate_minutes: null, status: 'open', external_updated_at: new Date(), last_synced_at: new Date() });
        await repos.operations.update(operationId, { status: 'succeeded', receipt: { guid: external.guid, url: external.url } });
        await this.finish(template, instance, { status: 'generated', taskId: operationId }); generated++;
      } catch (error) {
        await this.deps.operations.fail(operationId, error);
        await this.finish(template, instance, { status: 'failed', error: (error as Error).message });
      }
    }
    return generated;
  }); }
}
