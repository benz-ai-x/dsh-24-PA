import type { DataChannel, TaskRepo, TaskRow, WorkItemRow } from './repo.js';
import { hash, isoDate } from './util.js';

/** The creation marker is not an owner edit. Date-only legacy keys stay stable; time precision is part of the identity. */
export function taskFingerprint(task: { task_guid: string; summary: string; due_at: Date | null; due_has_time?: boolean }): string {
  return hash(`${task.task_guid}\n${task.summary.replace(/^\[24PA\] /, '')}\n${isoDate(task.due_at) ?? ''}${task.due_at && task.due_has_time ? '\ntime' : ''}`);
}

/** Publish a complete observation only after dependent sources are invalidated.
 * Local planning fields and the original platform ownership are preserved. */
export async function saveTaskObservation(task: TaskRow,
  observed: Pick<TaskRow, 'summary' | 'status' | 'due_at' | 'due_has_time'>,
  repo: TaskRepo,
  notify: (sourceType: 'task', sourceId: string, fingerprint: string | null) => Promise<void>,
): Promise<TaskRow> {
  const next = { ...task, ...observed, summary: observed.summary.replace(/^\[24PA\] /, '') };
  if (task.status !== next.status || taskFingerprint(task) !== taskFingerprint(next) || task.due_has_time !== next.due_has_time) {
    await notify('task', task.task_guid, next.status === 'open' ? taskFingerprint(next) : null);
  }
  return repo.save({ ...next, last_synced_at: new Date(), external_updated_at: new Date() });
}

/** Preserve old keys for requests without local planning fields. Omitted,
 * explicit null and concrete values represent different owner instructions. */
export function taskPlanKey(args: Record<string, unknown>): string {
  if (args.plannedAt === undefined && args.estimateMinutes === undefined) return '';
  return `\nplan:${JSON.stringify({
    plannedAt: args.plannedAt === undefined ? 'unchanged' : args.plannedAt === null ? null : new Date(String(args.plannedAt)).toISOString(),
    estimateMinutes: args.estimateMinutes === undefined ? 'unchanged' : args.estimateMinutes === null ? null : Math.round(Number(args.estimateMinutes)),
  })}`;
}

interface TaskAdapter {
  create(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown>;
  update(item: WorkItemRow, task: TaskRow, args: Record<string, unknown>): Promise<unknown>;
  complete(item: WorkItemRow, task: TaskRow): Promise<unknown>;
  refresh(task: TaskRow): Promise<TaskRow | null>;
  cancel?(item: WorkItemRow, task: TaskRow, reason: string): Promise<unknown>;
}

/** Existing task objects retain their owning channel when preferences change.
 * Callers ask for task outcomes, without routing or freshness knowledge. */
export class TaskLifecycle {
  constructor(private readonly deps: {
    repo(): TaskRepo;
    createChannel(): DataChannel;
    adapters: Record<DataChannel, TaskAdapter>;
  }) {}

  async resolve(args: Record<string, unknown>): Promise<TaskRow> {
    const key = String(args.taskId ?? args.guid ?? '');
    const task = (await this.deps.repo().get(key)) ?? (await this.deps.repo().byGuid(key));
    if (!task) throw new Error('任务不存在；请先用 task_list 查看当前任务。');
    return task;
  }

  create(item: WorkItemRow, args: Record<string, unknown>, originalChannel?: DataChannel): Promise<unknown> {
    return this.deps.adapters[originalChannel ?? this.deps.createChannel()].create(item, args);
  }

  async update(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const task = await this.resolve(args);
    return this.deps.adapters[task.channel].update(item, task, args);
  }

  async complete(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const task = await this.resolve(args);
    return this.deps.adapters[task.channel].complete(item, task);
  }

  refresh(task: TaskRow): Promise<TaskRow | null> {
    return this.deps.adapters[task.channel].refresh(task);
  }

  async get(args: Record<string, unknown>): Promise<unknown> {
    const task = await this.resolve(args);
    const refreshed = await this.refresh(task);
    const view = refreshed ?? task;
    return {
      guid: view.task_guid, url: view.url, summary: view.summary,
      dueAt: isoDate(view.due_at), plannedAt: isoDate(view.planned_at), estimateMinutes: view.estimate_minutes,
      status: view.status, channel: view.channel, stale: !refreshed,
      message: refreshed ? `已按${view.channel === 'wecom' ? '企微' : '飞书'}最新状态刷新。` : view.last_synced_at ? '本次远端核对未完成，展示此前同步的投影。' : '本地投影（远端核对未完成，状态可能滞后）。',
    };
  }

  async cancel(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const task = await this.resolve(args);
    const reason = String(args.reason ?? '').trim();
    if (!reason) throw new Error('取消需要说明本人的理由，用于记录与后续核对。');
    const adapter = this.deps.adapters[task.channel];
    if (adapter.cancel) return adapter.cancel(item, task, reason);
    return { guid: task.task_guid, url: task.url, message: '旧投影缺少当前来源与影响范围，请先通过待办来源核验后取消；未执行任何写入。' };
  }
}
