import { isDeepStrictEqual } from 'node:util';
import type { PaDb, PaQueryer } from '../db.js';
import { initialRunControl, canExecuteRun, type RunControl } from '../run-control.js';
import type { SkillRunRow } from './skill-run.js';

export interface RunControlRow { run_id: string; revision: number; state: RunControl; updated_at: Date }
export interface RunResumeRow { request_id: string; run_id: string; request_hash: string; message: Record<string, any>; status: 'prepared' | 'calling' | 'submitted' | 'unknown'; native_message_id: string | null; created_at: Date }

export async function initializeRunControl(tx: PaQueryer, id: string, limitMs?: number): Promise<void> {
  await tx.query('insert into pa24.skill_run_control (run_id, state) values ($1, $2) on conflict (run_id) do nothing', [id, JSON.stringify(initialRunControl(limitMs))]);
}

/** Serializes clocks, independent block reasons and continuation input before
 * the native host can consume it. Terminal runs never become runnable here. */
export class RunControlRepo {
  constructor(private readonly db: PaDb) {}
  async get(id: string): Promise<RunControlRow | null> {
    return (await this.db.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1', [id])).rows[0] ?? null;
  }
  async change(id: string, change: (state: RunControl) => void): Promise<RunControlRow> {
    return this.db.withTransaction(async tx => {
      const row = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [id])).rows[0];
      if (!row) throw new Error('该历史运行没有执行计时资料，不能假定已经计时。');
      const state = structuredClone(row.state); change(state);
      if (isDeepStrictEqual(state, row.state)) return row;
      return (await tx.query<RunControlRow>('update pa24.skill_run_control set state = $2, revision = revision + 1, updated_at = now() where run_id = $1 returning *', [id, JSON.stringify(state)])).rows[0]!;
    });
  }
  async prepareResume(input: { runId: string; requestId: string; hash: string; message: Record<string, any>; change(state: RunControl): void }): Promise<RunResumeRow> {
    return this.db.withTransaction(async tx => {
      const run = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1 for update', [input.runId])).rows[0];
      const previous = (await tx.query<RunResumeRow>('select * from pa24.skill_run_resume where request_id = $1', [input.requestId])).rows[0];
      if (previous) {
        if (previous.run_id !== input.runId || previous.request_hash !== input.hash) throw new Error('补充操作标识已用于其他内容。');
        return previous;
      }
      if (!run || !['pending', 'running', 'waiting'].includes(run.status)) throw new Error('运行已经结束或待核对，不能用迟到补充恢复。');
      const row = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [input.runId])).rows[0];
      if (!row) throw new Error('原运行缺少等待资料，不能猜测继续。');
      input.change(row.state);
      await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1, updated_at = now() where run_id = $1', [input.runId, JSON.stringify(row.state)]);
      return (await tx.query<RunResumeRow>(`insert into pa24.skill_run_resume (request_id, run_id, request_hash, message, status)
        values ($1,$2,$3,$4,'prepared') returning *`, [input.requestId, input.runId, input.hash, JSON.stringify(input.message)])).rows[0]!;
    });
  }
  async resumes(id: string): Promise<RunResumeRow[]> {
    return (await this.db.query<RunResumeRow>('select * from pa24.skill_run_resume where run_id = $1 order by created_at, request_id', [id])).rows;
  }
  async claimResume(id: string): Promise<boolean> {
    return this.db.withTransaction(async tx => {
      const candidate = (await tx.query<RunResumeRow>('select * from pa24.skill_run_resume where request_id = $1', [id])).rows[0];
      if (!candidate) return false;
      const run = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1 for update', [candidate.run_id])).rows[0];
      if (!run || !['running', 'waiting'].includes(run.status)) return false;
      const control = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [run.id])).rows[0];
      if (!control || !canExecuteRun(control.state)) return false;
      const claimed = await tx.query("update pa24.skill_run_resume set status = 'calling' where request_id = $1 and status = 'prepared' returning request_id", [id]);
      if (!claimed.rowCount) return false;
      await tx.query("update pa24.skill_run set status = 'running', progress = '沿原运行继续', updated_at = now() where id = $1", [run.id]);
      await tx.query("update pa24.work_item set status = 'running', progress = '沿原运行继续', updated_at = now() where id = $1 and active_skill_run_id = $2", [run.work_item_id, run.id]);
      return true;
    });
  }
  async submitted(id: string, nativeId: string): Promise<boolean> {
    const updated = await this.db.query(`update pa24.skill_run_resume set status = 'submitted', native_message_id = $2
      where request_id = $1 and status in ('calling','submitted','unknown') and (native_message_id is null or native_message_id = $2) returning request_id`, [id, nativeId]);
    return !!updated.rowCount;
  }
  async unknown(id: string): Promise<void> {
    await this.db.query("update pa24.skill_run_resume set status = 'unknown' where request_id = $1 and status = 'calling'", [id]);
  }
}
