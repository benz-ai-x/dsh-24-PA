import type { DataChannel, TaskRepo, TaskRow, WorkItemRow } from './repo.js';
import { isoDate } from './util.js';

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

  create(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    return this.deps.adapters[this.deps.createChannel()].create(item, args);
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
    return { guid: task.task_guid, url: task.url, message: '飞书任务平台不提供删除/取消接口。按平台真实能力：可用 task_update 在标题中标注取消原因，或 task_complete 归档；未执行任何写入。' };
  }
}
