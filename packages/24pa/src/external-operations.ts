import type { ActionOperationRepo, ActionOperationRow, WorkItemRow } from './repo.js';
import { hash } from './util.js';

const RESULT_KEY = '_externalResult';
const hasResult = (row: ActionOperationRow): boolean => !!row.receipt && Object.prototype.hasOwnProperty.call(row.receipt, RESULT_KEY);
const unknownError = (message: string): Error => Object.assign(new Error(message), { outcome: 'unknown' });

/** Durable external-write stages. An acknowledged write can repair its local
 * projection; an unacknowledged running write must be reconciled, never replayed. */
export class ExternalOperations {
  constructor(private readonly repo: () => ActionOperationRepo) {}

  stage(item: Pick<WorkItemRow, 'id'>, action: string, paramsKey: string, params: Record<string, unknown>, hint?: string) {
    return this.stageWithId(`${action}:${item.id}:${hash(paramsKey)}`, item, action, params, hint);
  }

  async stageWithId(id: string, item: Pick<WorkItemRow, 'id'>, action: string, params: Record<string, unknown>, hint = '请先核对远端实际对象，确认后再继续，不自动重试。'): Promise<{ created: boolean; row: ActionOperationRow }> {
    const { row } = await this.repo().begin({ id, workItemId: item.id, action, params });
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
