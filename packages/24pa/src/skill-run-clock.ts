import type { DshSession } from './host.js';
import type { RunControlRepo } from './repo/run-control.js';
import { beginRunAttempt, checkpointRunTime, recordRunStep, recordRunFailure, type RunControl, type RunFailure } from './run-control.js';

/** Native step/job evidence supplies the clock. A timer enforces the remaining
 * active budget; persistence/recovery remains authoritative after a restart. */
export class SkillRunClock {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessions = new Map<string, Map<string, DshSession>>();
  constructor(private readonly expire: (id: string) => Promise<void>) {}

  async observe(repo: RunControlRepo, id: string, sessions: readonly DshSession[], live: (id: string) => boolean): Promise<RunControl | null> {
    if (!await repo.get(id)) return null; // Old records have unknown elapsed time.
    const observed = this.sessions.get(id) ?? new Map<string, DshSession>();
    for (const session of sessions) observed.set(session.id, session);
    this.sessions.set(id, observed);
    const liveKeys: string[] = [];
    const row = await repo.change(id, state => {
      const failures: RunFailure[] = [];
      for (const session of observed.values()) {
        const open = new Set<string>();
        for (const [index, event] of session.ownEvents().entries()) {
          if (event.type === 'assistant/attempt') {
            const finish = event.data.stream?.findLast((record: any) => record.type === 'chunk' && record.chunk?.type === 'finish')?.chunk.reason;
            if (finish?.failure && typeof event.time === 'number') failures.push({ key: `${session.id}:${index}`, ...finish.failure, at: event.time });
          }
          if (!['step/start', 'step/end', 'job/registered', 'job/settled'].includes(event.type)) continue;
          if (typeof event.time !== 'number') throw new Error('宿主未提供步骤时间，不能猜测剩余时限。');
          const job = event.type.startsWith('job/');
          const key = `${session.id}:${job ? 'job:' + event.data.jobId : event.data.turn + ':' + event.data.step}`;
          const phase = ['step/start', 'job/registered'].includes(event.type) ? 'start' : 'end';
          if (phase === 'start') open.add(key); else open.delete(key);
          recordRunStep(state, key, phase, event.time);
        }
        if (live(session.id)) liveKeys.push(...open);
      }
      if (state.firstStepAt !== null && !state.attempts.length && !state.terminal) beginRunAttempt(state, state.firstStepAt);
      checkpointRunTime(state, liveKeys, Date.now());
      failures.sort((a, b) => a.at - b.at).forEach(failure => recordRunFailure(state, failure));
    });
    this.disarm(id);
    if (liveKeys.length && !row.state.terminal) {
      const timer = setTimeout(() => { this.timers.delete(id); void this.expire(id).catch(() => {}); }, Math.max(0, row.state.limitMs - row.state.executionMs));
      timer.unref(); this.timers.set(id, timer);
    }
    return row.state;
  }
  disarm(id: string): void { const timer = this.timers.get(id); if (timer) clearTimeout(timer); this.timers.delete(id); }
  dispose(): void { for (const id of this.timers.keys()) this.disarm(id); this.sessions.clear(); }
}
