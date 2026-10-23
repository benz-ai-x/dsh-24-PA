import type { DshSession, SessionEvent } from './host.js';
import type { RunInput } from './skill-run-host.js';
import { scheduleReminders } from './schedule-message.js';

export type DigestTriggerSource =
  | { kind: 'admission'; sessionId: string; turn: number }
  | { kind: 'schedule'; sessionId: string; turn: number; deliveries: { scheduleId: string; occurrenceAt: string; messageId: string; generation?: string }[] };

/** The immutable host prompt carries the confirmed plan mutation identity. */
export function scheduleGeneration(prompt: unknown): string | undefined {
  return typeof prompt === 'string' ? prompt.match(/\n24PA计划操作：([0-9a-f-]{36})$/)?.[1] : undefined;
}

/** Host adapter for the consumed messages of the open turn. Pending inbox
 * entries and old turns never establish the source of a new delegation. */
export function captureDigestTrigger(session: DshSession, scheduleOnly = false): DigestTriggerSource | null {
  let turn: number | null = null;
  let entered: SessionEvent[] = [];
  for (const event of session.ownEvents()) {
    if (event.type === 'turn/start') { turn = event.data.turn; entered = []; }
    else if (event.type === 'turn/end' && event.data.turn === turn) { turn = null; entered = []; }
    else if (turn !== null && event.type === 'user/message' && ['schedule', 'user'].includes(event.data.source?.kind)) entered.push(event);
  }
  if (scheduleOnly && !entered.some(event => event.data.source?.kind === 'schedule')) return null;
  if (turn === null || !Number.isInteger(turn) || entered.length === 0) {
    throw new Error('无法核验当前委派轮次的输入来源；请在当前会话重新发起计划任务。');
  }
  const deliveries: Extract<DigestTriggerSource, { kind: 'schedule' }>['deliveries'] = [];
  for (const event of entered) {
    const message = event.data;
    if (message.source?.kind !== 'schedule') continue;
    for (const raw of scheduleReminders(message as RunInput) ?? []) {
      const scheduleId = raw?.schedule_id;
      const occurrenceAt = raw?.occurrence_at;
      const generation = scheduleGeneration(raw?.reminder_prompt);
      const existing = deliveries.find(row => row.scheduleId === scheduleId);
      if (existing && (existing.occurrenceAt !== occurrenceAt || existing.generation !== generation)) throw new Error('当前轮次包含同一计划的多个窗口，无法确定本事项归属；请分别重新发起。');
      if (!existing) deliveries.push({ scheduleId, occurrenceAt, messageId: message.id, ...(generation ? { generation } : {}) });
    }
  }
  return deliveries.length
    ? { kind: 'schedule', sessionId: session.id, turn, deliveries }
    : { kind: 'admission', sessionId: session.id, turn };
}
