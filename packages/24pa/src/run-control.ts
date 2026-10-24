/** Durable execution policy. Native events supply timestamps; this module
 * never treats a model request, a wait, or a delivery as a new Run. */
export type RunBlockKind = 'input' | 'authorization' | 'dependency' | 'budget';
export interface RunBlock { key: string; kind: RunBlockKind; reason: string; since: number }
export interface RunStepTime { key: string; start: number; through: number; end: number | null }
export interface RunAttempt { number: number; startedAt: number; endedAt: number | null; error: string | null; retry: boolean }
export interface RunFailure { key: string; message: string; code: string; status?: number; at: number }
export interface RunControl {
  limitMs: number;
  queuedAt: number;
  firstStepAt: number | null;
  executionMs: number;
  steps: RunStepTime[];
  blocks: RunBlock[];
  waits: Array<{ start: number; end: number | null }>;
  attempts: RunAttempt[];
  failures: RunFailure[];
  stop?: { requestedAt: number; settledAt: number | null; error: string | null; reviewRequestId?: string };
  terminal: { status: 'completed' | 'failed' | 'stopped' | 'timed_out' | 'needs_reconciliation'; at: number } | null;
}

function timestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('执行时间证据无效。');
}
export function initialRunControl(limitMs = 15 * 60_000, now = Date.now()): RunControl {
  timestamp(now);
  if (!Number.isSafeInteger(limitMs) || limitMs < 1000 || limitMs > 24 * 60 * 60_000) throw new Error('执行时限须为 1 秒至 24 小时。');
  return { limitMs, queuedAt: now, firstStepAt: null, executionMs: 0, steps: [], blocks: [], waits: [], attempts: [], failures: [], terminal: null };
}

/** Parallel child steps consume elapsed active time once, not once per child. */
function intervalMs(intervals: Array<{ start: number; end: number }>): number {
  let total = 0, through = 0;
  for (const item of intervals.sort((a, b) => a.start - b.start)) {
    total += Math.max(0, item.end - Math.max(through, item.start));
    through = Math.max(through, item.end);
  }
  return total;
}
function account(state: RunControl): void {
  state.executionMs = Math.max(state.executionMs, intervalMs(state.steps.map(step => ({ start: step.start, end: step.end ?? step.through }))));
}
export function recordRunStep(state: RunControl, key: string, phase: 'start' | 'end', at: number): void {
  timestamp(at);
  let step = state.steps.find(item => item.key === key);
  if (phase === 'start') {
    if (step) {
      if (step.start !== at) throw new Error('原生步骤身份对应不同开始时间，须先核对。');
      return;
    }
    if (state.terminal && at > state.terminal.at) throw new Error('运行已结束，不能接纳新的执行步骤。');
    step = { key, start: at, through: at, end: null }; state.steps.push(step);
    state.firstStepAt = state.firstStepAt === null ? at : Math.min(state.firstStepAt, at);
  } else {
    if (!step) throw new Error('原生步骤缺少开始时间，不能猜测执行用时。');
    if (at < step.start || (step.end !== null && step.end !== at)) throw new Error('原生步骤时间冲突，须先核对。');
    step.end = at;
  }
  account(state);
}

/** Heartbeats only cover sessions known to be executing in this process.
 * Reopening a record never charges the offline interval to an unfinished step. */
export function checkpointRunTime(state: RunControl, liveKeys: readonly string[], now: number): void {
  timestamp(now);
  for (const step of state.steps) if (step.end === null && liveKeys.includes(step.key)) step.through = Math.max(step.through, now);
  account(state);
}

export function blockRun(state: RunControl, block: Omit<RunBlock, 'since'>, now = Date.now()): void {
  timestamp(now);
  if (state.terminal) throw new Error('运行已经结束；补充或放行不会恢复它，请显式接续。');
  if (!block.key.trim() || !block.reason.trim()) throw new Error('等待须说明原因与需要处理的内容。');
  const existing = state.blocks.find(item => item.key === block.key);
  if (existing) { existing.kind = block.kind; existing.reason = block.reason; return; }
  if (!state.blocks.length) state.waits.push({ start: now, end: null });
  state.blocks.push({ ...block, since: now });
}
export function clearRunBlock(state: RunControl, key: string, now = Date.now()): void {
  timestamp(now);
  if (state.terminal) throw new Error('运行已经结束；迟到补充不能恢复原运行。');
  state.blocks = state.blocks.filter(block => block.key !== key);
  if (!state.blocks.length) for (const wait of state.waits) if (wait.end === null) wait.end = Math.max(wait.start, now);
}
/** Budget limits gate the next model request. Already dispatched model/tool
 * work may finish while another session of the same Run waits for budget. */
export function canFinishDispatchedStep(state: RunControl): boolean {
  return !state.terminal && !state.stop && !state.blocks.some(block => block.kind !== 'budget') && state.executionMs < state.limitMs;
}
export const budgetBlockKey = (sessionId: string): string => `budget:${sessionId}`;
/** A resumed input may pass other owned sessions' budget waits. Its own
 * next model request still passes the budget gate and consumes its permit. */
export function canResumeSession(state: RunControl, sessionId: string, ownedSessions: readonly string[]): boolean {
  const otherBudgets = new Set(ownedSessions.filter(id => id !== sessionId).map(budgetBlockKey));
  return ownedSessions.includes(sessionId) && canFinishDispatchedStep(state)
    && state.blocks.every(block => block.kind === 'budget' && otherBudgets.has(block.key));
}
export function canExecuteRun(state: RunControl): boolean {
  return !state.terminal && !state.blocks.length && state.executionMs < state.limitMs;
}
export function beginRunAttempt(state: RunControl, now = Date.now()): void {
  timestamp(now);
  if (!canExecuteRun(state)) throw new Error('运行仍有阻断、已结束或累计执行时限已用尽。');
  const previous = state.attempts.at(-1);
  if (previous?.endedAt === null) return;
  if (previous && (!previous.retry || previous.number >= 4)) throw new Error('不能自动重试；须保留原结果并核对。');
  state.attempts.push({ number: state.attempts.length + 1, startedAt: now, endedAt: null, error: null, retry: false });
}
export function failRunAttempt(state: RunControl, error: string, definitelyUnexecutedTemporary: boolean, now = Date.now()): boolean {
  timestamp(now);
  const attempt = state.attempts.at(-1);
  if (!attempt || attempt.endedAt !== null || state.terminal) throw new Error('没有可结束的执行尝试。');
  attempt.endedAt = now; attempt.error = error;
  attempt.retry = definitelyUnexecutedTemporary && attempt.number < 4 && !state.blocks.length && state.executionMs < state.limitMs;
  return attempt.retry;
}
/** Only a provider's explicit pre-stream rejection proves this model attempt
 * never reached tool dispatch. Transport ambiguity never replays a business step. */
export function recordRunFailure(state: RunControl, failure: RunFailure): void {
  state.failures ??= [];
  if (state.failures.some(item => item.key === failure.key)) return;
  state.failures.push(failure);
  if (state.terminal) return;
  const previous = state.attempts.at(-1);
  if (!previous || previous.endedAt !== null) {
    if (previous && !previous.retry) return;
    beginRunAttempt(state, failure.at);
  }
  failRunAttempt(state, failure.message, (failure.code === 'RATE_LIMIT' && failure.status === 429)
    || (failure.code === 'SERVER' && [502, 503, 504].includes(failure.status ?? 0)), failure.at);
}
export function finishRunControl(state: RunControl, status: NonNullable<RunControl['terminal']>['status'], now = Date.now()): void {
  timestamp(now);
  if (state.terminal) return;
  state.terminal = { status, at: now };
  const attempt = state.attempts.at(-1); if (attempt && attempt.endedAt === null) attempt.endedAt = now;
  for (const wait of state.waits) if (wait.end === null) wait.end = Math.max(wait.start, now);
}
export function runControlSummary(state: RunControl, now = Date.now()) {
  const end = state.terminal?.at ?? now;
  // Waiting is time in a blocked interval during which no submitted step was
  // still finishing. Already dispatched tools remain chargeable until return.
  const waits = state.waits.map(wait => ({ start: wait.start, end: wait.end ?? end }));
  const overlaps = waits.flatMap(wait => state.steps.map(step => ({ start: Math.max(wait.start, step.start), end: Math.min(wait.end, step.end ?? step.through) })).filter(item => item.end > item.start));
  const queueEnd = state.firstStepAt ?? end;
  const blockedBeforeStart = waits.map(wait => ({ start: Math.max(state.queuedAt, wait.start), end: Math.min(queueEnd, wait.end) })).filter(item => item.end > item.start);
  return { limitMs: state.limitMs, executionMs: state.executionMs, remainingMs: Math.max(0, state.limitMs - state.executionMs),
    queuedMs: Math.max(0, queueEnd - state.queuedAt - intervalMs(blockedBeforeStart)), waitingMs: Math.max(0, intervalMs(waits) - intervalMs(overlaps)),
    blocks: state.blocks, attempt: state.attempts.length, terminal: state.terminal, stop: state.stop ?? null };
}
