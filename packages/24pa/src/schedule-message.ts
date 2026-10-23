import type { RunInput } from './skill-run-host.js';

export interface NativeReminder { schedule_id: string; occurrence_at: string; reminder_prompt: string }

/** Only the host's schedule source establishes provenance. A quoted framing
 * in an ordinary user message is never a background trigger. */
export function scheduleReminders(message: RunInput): NativeReminder[] | null {
  if (message.source?.kind !== 'schedule') return null;
  if (!message.id) throw new Error('宿主计划消息缺少可核验的消息标识。');
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('\n');
  let reminders: unknown;
  try {
    if (text.startsWith('[SCHEDULE REMINDER BATCH]\n')) reminders = JSON.parse(text.match(/^reminders_json: (.+)$/m)?.[1] ?? 'null');
    else if (text.startsWith('[SCHEDULE REMINDER]\n')) reminders = [{
      schedule_id: JSON.parse(text.match(/^schedule_id_json: (.+)$/m)?.[1] ?? 'null'),
      occurrence_at: text.match(/^occurrence_at: (.+)$/m)?.[1],
      reminder_prompt: JSON.parse(text.match(/^reminder_prompt_json: (.+)$/m)?.[1] ?? 'null'),
    }];
  } catch { /* Validation below keeps malformed native inputs out of admission. */ }
  if (!Array.isArray(reminders) || !reminders.length) throw new Error('宿主计划消息格式无法核验，不能猜测触发时间。');
  for (const row of reminders) if (typeof row?.schedule_id !== 'string' || !row.schedule_id || typeof row.reminder_prompt !== 'string'
    || typeof row.occurrence_at !== 'string' || !Number.isFinite(Date.parse(row.occurrence_at))
    || new Date(row.occurrence_at).toISOString() !== row.occurrence_at) throw new Error('宿主计划消息缺少有效的计划编号、提示或发生时间。');
  return reminders;
}

/** Partial batches retain the host envelope and message identity for legacy
 * plans. The full original is independently saved with each admitted event. */
export function remainingScheduleMessage(message: RunInput, remaining: NativeReminder[]): RunInput | null {
  if (!remaining.length) return null;
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('\n');
  if (!text.startsWith('[SCHEDULE REMINDER BATCH]\n')) return message;
  return { ...message, content: [{ type: 'text', text: text.replace(/^reminders_json: .+$/m, () => `reminders_json: ${JSON.stringify(remaining)}`) }] };
}
