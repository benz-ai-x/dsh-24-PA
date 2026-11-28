// One prompt to a local 24私助 session, for the e2e files that read the model's requests from the mock's log.
import { randomUUID } from 'node:crypto';

/**
 * Send `text` to the local session `sessionId` through the page's own remote method, and return the prompt's marker with `turn()`, the
 * model's requests since. Requests are matched by the marker anywhere in the recorded input, since the Host appends context blocks
 * after the prompt: a turn can still be settling when the next one starts, and its later requests carry earlier tool results.
 */
export async function promptLocal(host, llm, sessionId, text, requestPrefix = 'local') {
  const marker = `${text} ${randomUUID()}`, before = llm.log.length;
  await host.remote('session/prompt', { request: { requestId: `${requestPrefix}-${randomUUID()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: marker }], clientTimeZone: 'Asia/Shanghai' } });
  return { marker, turn: () => llm.log.slice(before) };
}
