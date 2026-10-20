import type { ActionOperationRepo, ActionOperationRow, WorkItemRow, DataChannel } from './repo.js';
import { hash } from './util.js';
import { isDeepStrictEqual } from 'node:util';

const RESULT_KEY = '_externalResult';
const hasResult = (row: ActionOperationRow): boolean => !!row.receipt && Object.prototype.hasOwnProperty.call(row.receipt, RESULT_KEY);
const unknownError = (message: string): Error => Object.assign(new Error(message), { outcome: 'unknown' });
export const isCandidateOperation = (id: string): boolean => id.startsWith('note.action:') || id.startsWith('minutes.action:');

/** Durable external-write stages. An acknowledged write can repair its local
 * projection; an unacknowledged running write must be reconciled, never replayed. */
export class ExternalOperations {
  constructor(private readonly repo: () => ActionOperationRepo) {}

  /** A candidate owns its original platform intent across new work sessions
   * and preferences. Only these known creation contracts can be recovered. */
  async candidateCreation(id: string, family: 'task' | 'calendar', args: Record<string, unknown>): Promise<{ channel: DataChannel; args: Record<string, unknown> } | null> {
    const row = await this.repo().get(id);
    if (!row) return null;
    const channel = row.action === `${family}.create` ? 'feishu'
      : row.action === (family === 'task' ? 'wecom_todo.create' : 'wecom_calendar.create') ? 'wecom' : null;
    const p = row.params, authorization = args._authorization as Record<string, unknown> ?? {};
    const scope = id.startsWith('note.action:') ? ['noteId', 'versionId', 'index'] : ['minutesId', 'index'];
    if (!channel || typeof p.summary !== 'string' || !p.summary.trim() || !row.work_item_id
      || typeof p.instruction !== 'string' || !p.instruction.trim()
      || scope.some(key => p[key] === undefined || !isDeepStrictEqual(p[key], authorization[key]))
      || (p.channel !== undefined && p.channel !== channel)
      || (channel === 'feishu' && (typeof p[family === 'task' ? 'tasklistId' : 'calendarId'] !== 'string' || !p[family === 'task' ? 'tasklistId' : 'calendarId']))
      || (family === 'calendar' && (p.kind !== 'create' || !p.start || !p.end || !(new Date(p.start) < new Date(p.end))))
      || (p.receiptFormat !== undefined && (p.receiptFormat !== `${channel}-${family}-v1`
        || ((channel === 'wecom' || family === 'calendar') && typeof p.timeZone !== 'string')))) {
      throw unknownError('候选原操作的渠道、目标或授权身份不足，需先核对，不能按当前配置重建。');
    }
    const objectId = row.receipt?.[family === 'task' ? 'guid' : 'eventId'];
    if (row.status === 'succeeded' && (typeof objectId !== 'string' || !objectId.trim())) {
      throw unknownError('候选原操作缺少可信对象回执，请先核对。');
    }
    return { channel, args: { summary: p.summary, due: p.due, timeZone: p.timeZone ?? null,
      start: p.start, end: p.end, calendarId: p.calendarId, channel,
      _tasklistId: p.tasklistId, _operationId: id, _instruction: p.instruction,
      _authorization: Object.fromEntries(['minutesId', 'noteId', 'versionId', 'index', 'sourceQuote', 'clarification', ...(family === 'calendar' ? ['instruction'] : [])].filter(key => p[key] !== undefined).map(key => [key, p[key]])) } };
  }

  stage(item: Pick<WorkItemRow, 'id'>, action: string, paramsKey: string, params: Record<string, unknown>, hint?: string) {
    return this.stageWithId(`${action}:${item.id}:${hash(paramsKey)}`, item, action, params, hint);
  }

  async stageWithId(id: string, item: Pick<WorkItemRow, 'id'>, action: string, params: Record<string, unknown>, hint = '请先核对远端实际对象，确认后再继续，不自动重试。'): Promise<{ created: boolean; row: ActionOperationRow }> {
    const { row } = await this.repo().begin({ id, workItemId: item.id, action, params });
    if (row.action !== action) throw unknownError('原操作类型与当前执行器不符，请先核对原渠道，不会重发。');
    if (isCandidateOperation(id)) {
      const normalized = JSON.parse(JSON.stringify(params));
      if (Object.keys(row.params).some(key => !isDeepStrictEqual(row.params[key], normalized[key]))) {
        throw unknownError('候选已有不同的原操作参数，不能改写原渠道或授权后重试。');
      }
    }
    if (row.status === 'succeeded') return { created: false, row };
    // Legacy memo writes saved docId before readback; preserve that recovery
    // evidence too. Both forms permit local repair, never a second write.
    if (hasResult(row) || (row.action === 'memo.save_doc' && typeof row.receipt?.docId === 'string')) return { created: true, row };
    if (row.status === 'unknown' || (row.status === 'running' && !hasResult(row))) {
      throw unknownError(`上次操作结果未知或仍在执行；${hint}`);
    }
    const claimed = await this.repo().claim(id);
    if (!claimed) throw unknownError(`该操作已被认领；${hint}`);
    return { created: true, row: claimed };
  }

  async perform<T>(id: string, invoke: () => Promise<T>): Promise<T> {
    const row = await this.repo().get(id);
    if (!row) throw new Error('外部操作尚未登记。');
    if (hasResult(row)) return row.receipt![RESULT_KEY] as T;
    if (row.status !== 'running') throw unknownError('操作未持有执行资格；请先核对远端实际对象。');
    let result: T;
    try {
      result = await invoke();
    } catch (error) {
      // Only explicit platform rejection is safe to retry. Broken envelopes,
      // timeouts and arbitrary transport errors carry no proof of non-execution.
      if ((error as { outcome?: string })?.outcome === 'failed') throw error;
      throw unknownError((error as Error).message);
    }
    try {
      await this.repo().update(id, { status: 'running', receipt: { ...row.receipt, [RESULT_KEY]: result ?? null } });
    } catch (error) {
      throw unknownError(`远端已返回，但回执保存失败；请先核对远端，不要重试：${(error as Error).message}`);
    }
    return result;
  }

  async fail(id: string, error: unknown): Promise<void> {
    const row = await this.repo().get(id);
    // Local post-processing cannot revoke a completed remote operation.
    if (row?.status === 'succeeded') return;
    const status = ['unknown', 'invalid-envelope'].includes((error as { outcome?: string })?.outcome ?? '') ? 'unknown' : 'failed';
    await this.repo().update(id, { status, error: (error as Error).message });
  }
}
