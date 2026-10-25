import type { ContentBlock, DshContext, DshSession, SessionEvent, SessionHeader } from './host.js';
import { consumedTurn } from './host-turn.js';
import type { WorkItemRow } from './repo/work.js';

/** The marker is part of the exact native input, not assistant output. The
 * durable intent is committed before sending it; a returned messageId alone
 * would leave a crash window between native acceptance and the DB receipt. */
export function workExecutionContent(item: WorkItemRow): ContentBlock {
  if (!item.execution_id) throw new Error('事项缺少持久执行关联。');
  return { type: 'text', text: `[24PA execution: ${item.execution_id}]` };
}

export type WorkCompletion =
  | { kind: 'pending' }
  | { kind: 'unproven'; reason: string }
  | { kind: 'complete'; executionId: string; generation: number; turn: number; output: string; failure?: string };

/** Read-only host adapter. No Agent resolution, model input, or private log
 * writes are permitted here. Live flush and cold reads share one verifier. */
export interface WorkContinuation { messageId?: string | null; consumedAt: string }
export class WorkCompletionHistory {
  constructor(private readonly ctx: DshContext, private readonly continuations: (item: WorkItemRow) => Promise<WorkContinuation[]> = async () => []) {}

  async checkpoint(session: DshSession): Promise<void> {
    if (!await this.ctx.sessions.flush(session)) throw new Error('宿主没有持久化监听者，原回合结算等待持久化确认。');
  }

  async read(item: WorkItemRow): Promise<WorkCompletion> {
    const childId = item.child_session_id ?? item.id;
    const live = this.ctx.sessions.get?.(childId);
    if (live) {
      try {
        await this.checkpoint(live);
        return verifyWorkCompletion(item, live, await this.continuations(item));
      } catch (error) {
        // A closed write handle has drained its log. Only a retired Session
        // may use the not-live fallback; other checkpoint failures stay visible.
        const closed = error instanceof Error && error.name === 'SessionHandleClosedError';
        const retired = error instanceof Error && this.ctx.sessions.get?.(childId) !== live
          && error.message === `session "${childId}" is not live in this store`;
        if (!closed && !retired) throw error;
      }
    }
    const persistence = this.ctx.get('sessionPersistence') as {
      open?(id: string, access: 'read'): Promise<{ header: SessionHeader & { id: string }; inheritedEventCount: number;
        read(start: number): Promise<{ events: SessionEvent[] }>; close(): Promise<void> }>;
    } | null;
    if (!persistence?.open) return { kind: 'unproven', reason: '宿主未提供公开持久历史读取能力，请核对原事项结果。' };
    let handle: Awaited<ReturnType<NonNullable<typeof persistence.open>>> | undefined;
    try {
      handle = await persistence.open(childId, 'read');
      const { events } = await handle.read(0);
      const inheritedEventCount = handle.inheritedEventCount;
      return verifyWorkCompletion(item, { id: handle.header.id, header: handle.header,
        ownEvents: () => events.slice(inheritedEventCount) }, await this.continuations(item));
    } catch (error) {
      if (['SessionPersistenceNotFoundError', 'SessionPersistenceCorruptionError', 'SessionFormatUnsupportedError'].includes((error as Error).name)) {
        return { kind: 'unproven', reason: '原生持久历史缺失、损坏或格式无法核验，请先核对原事项结果。' };
      }
      throw error;
    } finally { await handle?.close(); }
  }
}

function verifyWorkCompletion(item: WorkItemRow, session: DshSession, continuations: WorkContinuation[]): WorkCompletion {
  const scope = item.execution_scope;
  const parent = session.header.parentSession;
  const parentId = typeof parent === 'string' ? parent : parent?.id;
  if (!item.execution_id || !scope || scope.generation !== (item.recovery_gen ?? 0)
    || scope.parentSessionId !== item.parent_session_id || scope.childSessionId !== (item.child_session_id ?? item.id)
    || session.id !== scope.childSessionId || parentId !== scope.parentSessionId || session.header.cwd !== scope.workspacePath) {
    return { kind: 'unproven', reason: '原回合的工作区、父子会话或代次无法核实，请核对原事项结果。' };
  }
  const events = session.ownEvents();
  const marker = workExecutionContent(item).text;
  const accepted = new Set<string>();
  const checkInput = (message: any) => {
    const source = message?.source;
    const originMatches = scope.input === 'start' ? source?.kind === 'user'
      : source?.kind === 'agent-message' && source.senderSessionId === scope.parentSessionId;
    if (originMatches && typeof message.id === 'string' && Array.isArray(message.content)
      && message.content.some((block: ContentBlock) => block.type === 'text' && block.text === marker)) accepted.add(message.id);
  };
  for (const event of events) {
    if (event.type === 'user/message') checkInput(event.data);
    if (event.type === 'agent/inbox/spliced') (event.data.inserted ?? []).forEach(checkInput);
  }
  if (accepted.size > 1) return { kind: 'unproven', reason: '同一执行标识对应多个宿主输入，需核对实际执行结果。' };
  if (!accepted.size) return { kind: 'pending' };
  const continuationIds = new Set(continuations.map(row => row.messageId).filter(Boolean));
  const completed = events.filter(event => event.type === 'turn/end' && Number.isInteger(event.data.turn)
    && [...consumedTurn(session, event.data.turn).messageIds].some(id => accepted.has(id) || continuationIds.has(id)))
    .filter(event => {
      // A durable consumed budget grant proves a later request belongs to this
      // same execution. Earlier rejected/error turns remain history, not a
      // second completion. Never replace an earlier successful completion.
      const kind = event.data.reason?.kind, endedAt = event.time;
      return !(['blocked', 'error'].includes(kind) && typeof endedAt === 'number'
        && continuations.some(row => Date.parse(row.consumedAt) > endedAt));
    });
  if (!completed.length) return { kind: 'pending' };
  if (completed.length !== 1) return { kind: 'unproven', reason: '同一输入的完成回合不唯一，请核对实际执行结果。' };
  const terminal = completed[0]!;
  const kind = terminal.data.reason?.kind;
  if (!['completed', 'error', 'aborted', 'blocked', 'max-tokens'].includes(kind)) {
    return { kind: 'unproven', reason: '原回合只有中断或无法识别的结束记录，不能证明任务完成。' };
  }
  const messages = events.filter(event => event.type === 'assistant/message' && event.data.turn === terminal.data.turn && !event.data.interrupted);
  const output = ((messages.at(-1)?.data.message?.content ?? []) as ContentBlock[])
    .filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n').trim();
  const failure = kind !== 'completed' ? String(terminal.data.reason?.error?.message ?? `Worker 回合未正常完成（${kind}）`)
    : !output ? 'Worker 未产生结果' : undefined;
  return { kind: 'complete', executionId: item.execution_id, generation: scope.generation,
    turn: terminal.data.turn, output, ...(failure ? { failure } : {}) };
}
