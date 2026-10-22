import type { PaQueryer } from '../db.js';
import type { RunControl } from '../run-control.js';

/** Admission and continuation share a durable lock across both execution
 * paths. Child work belongs to its root Run's slot; an idle wait releases it. */
export async function hasExecutionCapacity(tx: PaQueryer, limit: number, candidate: { runId?: string; workId?: string; parentSessionId?: string } = {}): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('全局并发须为 1–8。');
  await tx.query("insert into pa24.skill_run_admission_guard (id) values ('execution-capacity') on conflict (id) do nothing");
  await tx.query("select id from pa24.skill_run_admission_guard where id = 'execution-capacity' for update");
  const runs = (await tx.query<{ id: string; status: string }>("select id, status from pa24.skill_run where status <> 'pending'")).rows;
  const controls = new Map((await tx.query<{ run_id: string; state: RunControl }>('select run_id, state from pa24.skill_run_control')).rows.map(row => [row.run_id, row.state]));
  const jobs = new Set((await tx.query<{ run_id: string }>(`select distinct run_id from pa24.skill_run_native
    where kind = 'job' and (end_data is null or end_data->>'producerReported' = 'false')`)).rows.map(row => row.run_id));
  const calls = new Set((await tx.query<{ run_id: string }>("select distinct run_id from pa24.skill_run_call where status = 'running'")).rows.map(row => row.run_id));
  // Saving a review requires the host to prove every owned session/job has
  // stopped. The original uncertain receipts deliberately remain unchanged.
  const reviewed = new Set((await tx.query<{ run_id: string }>('select distinct run_id from pa24.skill_run_review')).rows.map(row => row.run_id));
  const busy = new Set(runs.filter(run => {
    const state = controls.get(run.id);
    return ['running', 'stopping'].includes(run.status) || (state?.stop && state.stop.settledAt === null)
      || (!reviewed.has(run.id) && (state?.steps.some(step => step.end === null) || jobs.has(run.id) || calls.has(run.id)));
  }).map(run => run.id));
  if (candidate.runId && busy.has(candidate.runId)) return true;
  const sessions = (await tx.query<{ session_id: string; run_id: string }>('select session_id, run_id from pa24.skill_run_session')).rows;
  const owner = candidate.parentSessionId && sessions.find(row => row.session_id === candidate.parentSessionId);
  if (owner && busy.has(owner.run_id)) return true;
  const workers = (await tx.query<{ id: string; parent_session_id: string }>("select id, parent_session_id from pa24.work_item where execution_mode = 'worker' and status = 'running'")).rows;
  if (candidate.workId && workers.some(row => row.id === candidate.workId)) return true;
  const standalone = workers.filter(work => !sessions.some(session => session.session_id === work.parent_session_id && busy.has(session.run_id)));
  return busy.size + standalone.length < limit;
}
