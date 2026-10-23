import type { PaDb } from '../db.js';
import { isDeepStrictEqual } from 'node:util';
import type { WorkItemRow } from './work.js';
export interface WorkChange { request_id: string; request_hash: string; work_item_id: string; record: { op: string; phase: 'prepared' | 'completed' | 'unknown' | 'failed'; input: Record<string, unknown>; result?: unknown; error?: string }; created_at: Date }
export class WorkControlRepo {
  constructor(private readonly db: PaDb) {}
  async get(id: string): Promise<WorkChange | null> { return (await this.db.query<WorkChange>('select * from pa24.work_change where request_id = $1', [id])).rows[0] ?? null; }
  async prepare(requestId: string, hash: string, workId: string, revision: number, input: Record<string, unknown>) {
    return this.db.withTransaction(async tx => {
      const work = (await tx.query<WorkItemRow>('select * from pa24.work_item where id = $1 for update', [workId])).rows[0];
      const prior = (await tx.query<WorkChange>('select * from pa24.work_change where request_id = $1', [requestId])).rows[0];
      if (prior) {
        if (prior.request_hash !== hash || prior.work_item_id !== workId || !isDeepStrictEqual(prior.record.input, input)) throw new Error('操作标识已用于另一项交办或输入。');
        return { row: prior, fresh: false };
      }
      if (!work || work.revision !== revision) throw new Error('交办已有新进展，请刷新后重新操作。');
      const row = (await tx.query<WorkChange>('insert into pa24.work_change (request_id,request_hash,work_item_id,record) values ($1,$2,$3,$4) returning *',
        [requestId, hash, workId, JSON.stringify({ op: input.op, phase: 'prepared', input })])).rows[0]!;
      return { row, fresh: true };
    });
  }
  async settle(row: WorkChange, phase: 'completed' | 'unknown' | 'failed', result?: unknown, error?: string) {
    await this.db.query('update pa24.work_change set record = $2 where request_id = $1', [row.request_id, JSON.stringify({ ...row.record, phase, result, error })]);
  }
  async acceptance(row: WorkChange, revision: number, op: 'accept' | 'return', evidence: string): Promise<{ work: WorkItemRow }> {
    if (!evidence.trim()) throw new Error('请说明接受依据或尚未完成的部分。');
    return this.db.withTransaction(async tx => {
      const current = (await tx.query<WorkChange>('select * from pa24.work_change where request_id = $1 for update', [row.request_id])).rows[0];
      if (current?.record.phase === 'completed') return current.record.result as { work: WorkItemRow };
      if (!current || current.record.phase !== 'prepared' || current.request_hash !== row.request_hash) throw new Error('原验收操作不能重复提交，请刷新核对。');
      const result = await tx.query<WorkItemRow>(`update pa24.work_item set acceptance_status = $3, revision = revision + 1, updated_at = now()
        where id = $1 and revision = $2 and acceptance_required = true and status = 'completed' and acceptance_status in ('pending','returned') returning *`, [row.work_item_id, revision, op === 'accept' ? 'accepted' : 'returned']);
      if (!result.rows[0]) throw new Error('该交办不需要验收、尚未完成或版本已变化，请刷新。');
      const value = { work: result.rows[0] };
      await tx.query('update pa24.work_change set record = $2 where request_id = $1', [row.request_id, JSON.stringify({ ...current.record, phase: 'completed', result: value })]);
      return value;
    });
  }
  async history(workId: string): Promise<WorkChange[]> {
    return (await this.db.query<WorkChange>('select * from pa24.work_change where work_item_id = $1 order by created_at desc', [workId])).rows;
  }
}
