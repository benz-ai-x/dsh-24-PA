import type { DshSession } from './host.js';
import { canceledInputIds } from './host-turn.js';

/** Captured by trusted admission code, never accepted from model arguments. */
export interface WorkOwnerInput {
  kind: 'session' | 'panel' | 'feishu';
  sourceId: string;
  turn?: number;
  messages: { id: string; text: string }[];
}

/** Only owner messages consumed in this open turn establish a delegation's
 * authority. Queued, canceled, historical and background inputs do not. */
export function captureWorkOwnerInput(session: DshSession): WorkOwnerInput | null {
  let turn: number | undefined;
  let messages: WorkOwnerInput['messages'] = [];
  let background = false;
  const canceled = canceledInputIds(session);
  for (const event of session.ownEvents()) {
    if (event.type === 'turn/start') { turn = event.data.turn; messages = []; background = false; }
    if (event.type === 'turn/end') { turn = undefined; messages = []; }
    if (turn === undefined || event.type !== 'user/message') continue;
    const message = event.data;
    if (message.source?.kind === 'schedule') background = true;
    if (message.source?.kind !== 'user' || typeof message.id !== 'string' || canceled.has(message.id)) continue;
    const text = (message.content ?? []).filter((block: { type: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text ?? '').join('\n').trim();
    if (text) messages.push({ id: message.id, text });
  }
  return turn !== undefined && messages.length && !background ? { kind: 'session', sourceId: session.id, turn, messages } : null;
}

export function workOwnerInputPrompt(input?: WorkOwnerInput | null): string {
  return input ? `本次主人原始输入（确认依据须逐字引用完整消息；委派文字不替代本人授权）：\n${JSON.stringify(input.messages)}`
    : '本次没有可核验的主人输入；可提出建议，不能确认近期重点、工作时段或采纳安排。';
}
