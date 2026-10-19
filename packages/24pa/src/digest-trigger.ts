import type { DshSession, SessionEvent } from './host.js';

export type DigestTriggerSource =
  | { kind: 'admission'; sessionId: string; turn: number }
  | { kind: 'schedule'; sessionId: string; turn: number; deliveries: { scheduleId: string; occurrenceAt: string; messageId: string }[] };

/** Host adapter for the consumed messages of the open turn. Pending inbox
 * entries and old turns never establish the source of a new delegation. */
export function captureDigestTrigger(session: DshSession): DigestTriggerSource {
  let turn: number | null = null;
  let entered: SessionEvent[] = [];
  for (const event of session.ownEvents()) {
    if (event.type === 'turn/start') { turn = event.data.turn; entered = []; }
    else if (event.type === 'turn/end' && event.data.turn === turn) { turn = null; entered = []; }
    else if (turn !== null && event.type === 'user/message' && ['schedule', 'user'].includes(event.data.source?.kind)) entered.push(event);
  }
  if (turn === null || !Number.isInteger(turn) || entered.length === 0) {
    throw new Error('无法核验当前委派轮次的输入来源；请在当前会话重新发起计划任务。');
  }
  const deliveries: Extract<DigestTriggerSource, { kind: 'schedule' }>['deliveries'] = [];
  for (const event of entered) {
    const message = event.data;
    if (message.source?.kind !== 'schedule') continue;
    if (typeof message.id !== 'string' || !message.id) throw new Error('宿主计划消息缺少可核验的消息标识，不能猜测窗口。');
    const content = Array.isArray(message.content) ? message.content.map(block => block.type === 'text' ? block.text : '').join('\n') : '';
    let reminders: unknown;
    try {
      if (content.startsWith('[SCHEDULE REMINDER BATCH]\n')) {
        reminders = JSON.parse(content.match(/^reminders_json: (.+)$/m)?.[1] ?? 'null');
      } else if (content.startsWith('[SCHEDULE REMINDER]\n')) {
        reminders = [{ schedule_id: JSON.parse(content.match(/^schedule_id_json: (.+)$/m)?.[1] ?? 'null'), occurrence_at: content.match(/^occurrence_at: (.+)$/m)?.[1] }];
      }
    } catch { /* The validation below rejects malformed host envelopes. */ }
    if (!Array.isArray(reminders) || reminders.length === 0) throw new Error('宿主计划消息格式无法核验，不能用执行时间猜测窗口。');
    for (const raw of reminders) {
      const scheduleId = raw?.schedule_id;
      const occurrenceAt = raw?.occurrence_at;
      if (typeof scheduleId !== 'string' || !scheduleId || typeof occurrenceAt !== 'string' ||
          !Number.isFinite(Date.parse(occurrenceAt)) || new Date(occurrenceAt).toISOString() !== occurrenceAt) {
        throw new Error('宿主计划消息缺少有效的计划编号或发生时间，不能猜测窗口。');
      }
      const existing = deliveries.find(row => row.scheduleId === scheduleId);
      if (existing && existing.occurrenceAt !== occurrenceAt) throw new Error('当前轮次包含同一计划的多个窗口，无法确定本事项归属；请分别重新发起。');
      if (!existing) deliveries.push({ scheduleId, occurrenceAt, messageId: message.id });
    }
  }
  return deliveries.length
    ? { kind: 'schedule', sessionId: session.id, turn, deliveries }
    : { kind: 'admission', sessionId: session.id, turn };
}
