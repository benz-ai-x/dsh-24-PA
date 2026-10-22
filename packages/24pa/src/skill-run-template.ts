import type { Repos, SkillRunRow } from './repo.js';
import type { SkillDefinitionLike } from './skills.js';
import { withExecutionSignal } from './execution-cancellation.js';
import { beginRunAttempt, checkpointRunTime, recordRunStep } from './run-control.js';

/** The template track shares Run accounting without inventing native model
 * events. Cancellation remains active until its outstanding reads have ended. */
export class SkillRunTemplates {
  private readonly active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(private readonly generate: (def: SkillDefinitionLike, parameters: Record<string, unknown>) => Promise<string>,
    private readonly control: <T>(work: () => Promise<T>) => Promise<T>) {}

  start(run: SkillRunRow, repos: Repos): Promise<void> {
    const abort = new AbortController();
    const done = this.execute(run, repos, abort).finally(() => this.active.delete(run.id));
    this.active.set(run.id, { abort, done });
    return done;
  }
  async stop(id: string): Promise<boolean> {
    const current = this.active.get(id);
    if (!current) return false;
    current.abort.abort(new Error('模板运行已停止。'));
    await current.done;
    return true;
  }
  dispose(): void { for (const current of this.active.values()) current.abort.abort(new Error('工作区运行已结束。')); }

  private async execute(run: SkillRunRow, repos: Repos, abort: AbortController): Promise<void> {
    const key = 'template', started = Date.now();
    const initial = await repos.runControls.change(run.id, state => {
      recordRunStep(state, key, 'start', started); beginRunAttempt(state, started);
    });
    let expired = false, timeoutWrite: Promise<unknown> | undefined;
    const markTimeout = async () => {
      await repos.runControls.change(run.id, state => checkpointRunTime(state, [key], Date.now()));
      await repos.skillRuns.transition(run.id, 'timed_out', '累计执行达到时限；模板读取已取消，保留已取得的记录');
    };
    const timer = setTimeout(() => {
      expired = true; abort.abort(new Error('累计执行时限已用尽。'));
      // No model/tool admission is possible here. The control lease keeps the
      // old ledger available while a configuration change drains this read.
      timeoutWrite = this.control(markTimeout);
      void timeoutWrite.catch(() => {}); // Joined below, never a lost receipt.
    }, Math.max(0, initial.state.limitMs - initial.state.executionMs));
    try {
      const result = await withExecutionSignal(abort.signal, () => this.generate(run.snapshot.definition, run.snapshot.parameters));
      await repos.runControls.change(run.id, state => recordRunStep(state, key, 'end', Date.now()));
      if (Date.now() - started + initial.state.executionMs >= initial.state.limitMs) expired = true;
      if (!expired && !abort.signal.aborted) await repos.skillRuns.transition(run.id, 'completed', '模板已生成；未调用模型，未请求投递', result);
    } catch (error) {
      if (!abort.signal.aborted) await repos.skillRuns.transition(run.id, 'failed', `模板执行失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
      const state = await repos.runControls.get(run.id);
      if (state?.state.steps.find(step => step.key === key)?.end === null) await repos.runControls.change(run.id, state => recordRunStep(state, key, 'end', Date.now()));
      await timeoutWrite?.catch(() => {});
      if (expired) await markTimeout();
    }
  }
}
