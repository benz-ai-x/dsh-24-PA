import type { PaQueryer } from '../db.js';
import type { RunControl } from '../run-control.js';

/** Admission and continuation share a durable lock across both execution
 * paths. Child work belongs to its root Run's slot; an idle wait releases it. */
interface ExecutionCandidate { runId?: string; workId?: string; parentSessionId?: string }
export async function executionCapacity(tx: PaQueryer, limit: number): Promise<(candidate: ExecutionCandidate) => boolean> {
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
  // A wake reserves its root Run's slot before the host has a step receipt.
  // Sibling waits may still label the Run waiting. Consumption hands the slot
  // to real step/call evidence; definite rejection clears this reservation.
  const budgetWakes = new Set((await tx.query<{ run_id: string }>("select run_id from pa24.budget_release where status = 'ready' and record->>'wake' is not null and record->>'error' is null")).rows.map(row => row.run_id));
  const busy = new Set(runs.filter(run => {
    const state = controls.get(run.id);
    return (['running', 'waiting'].includes(run.status) && budgetWakes.has(run.id)) || ['running', 'stopping'].includes(run.status) || (state?.stop && state.stop.settledAt === null)
      || (!reviewed.has(run.id) && (state?.steps.some(step => step.end === null) || jobs.has(run.id) || calls.has(run.id)));
  }).map(run => run.id));
  const sessions = (await tx.query<{ session_id: string; run_id: string }>('select session_id, run_id from pa24.skill_run_session')).rows;
  const workers = (await tx.query<{ id: string; parent_session_id: string }>("select id, parent_session_id from pa24.work_item where execution_mode = 'worker' and (status = 'running' or (status = 'waiting_input' and exists (select 1 from pa24.budget_release br where br.run_id = active_worker_run_id and br.status = 'ready' and br.record->>'wake' is not null and br.record->>'error' is null)) or exists (select 1 from pa24.worker_run wr where wr.id = active_worker_run_id and wr.status = 'stopping') or exists (select 1 from pa24.worker_run_call wc where wc.run_id = active_worker_run_id and wc.status = 'running'))")).rows;
  const standalone = workers.filter(work => !sessions.some(session => session.session_id === work.parent_session_id && busy.has(session.run_id)));
  return candidate => {
    if (candidate.runId && busy.has(candidate.runId)) return true;
    const owner = candidate.parentSessionId && sessions.find(row => row.session_id === candidate.parentSessionId);
    if (owner && busy.has(owner.run_id)) return true;
    if (candidate.workId && workers.some(row => row.id === candidate.workId)) return true;
    return busy.size + standalone.length < limit;
  };
}
export async function hasExecutionCapacity(tx: PaQueryer, limit: number, candidate: ExecutionCandidate = {}): Promise<boolean> {
  return (await executionCapacity(tx, limit))(candidate);
}
