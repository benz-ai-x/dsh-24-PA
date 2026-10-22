import type { DshSession } from './host.js';

/** A claimed inbox item can be rejected before it reaches the model history. */
export function turnHasModelInput(session: DshSession, turn: number): boolean {
  let open: number | undefined;
  for (const event of session.ownEvents()) {
    if (event.type === 'turn/start') open = event.data.turn;
    if (open === turn && (event.type === 'user/message' || event.type === 'assistant/attempt' || event.type === 'assistant/message')) return true;
    if (event.type === 'turn/end') open = undefined;
  }
  return false;
}

/** The installed host records queue acceptance separately from consumption.
 * Replay its splices so even a pre-step rejection is tied to the input it took;
 * user/message is additional evidence for injected/steered model-visible input. */
export function consumedTurn(session: DshSession, turn: number): { messageIds: Set<string>; requestIds: Set<string> } {
  const messageIds = new Set<string>(), requestIds = new Set<string>();
  const queues = new Map<string, any[]>();
  let open: number | undefined;
  const consume = (message: any) => {
    if (open !== turn) return;
    if (typeof message?.id === 'string') messageIds.add(message.id);
    if (typeof message?.source?.rpcId === 'string') requestIds.add(message.source.rpcId);
  };
  for (const event of session.ownEvents()) {
    if (event.type === 'turn/start') open = event.data.turn;
    if (event.type === 'agent/inbox/spliced') {
      const { target, start, removedCount = 0, inserted = [], outcome } = event.data;
      const queue = queues.get(target) ?? [];
      const removed = queue.splice(start, removedCount, ...inserted);
      queues.set(target, queue);
      if (outcome !== 'canceled' && !inserted.length) removed.forEach(consume);
    }
    if (event.type === 'user/message') consume(event.data);
    if (event.type === 'turn/end') {
      if (event.data.turn === turn) break;
      open = undefined;
    }
  }
  return { messageIds, requestIds };
}
