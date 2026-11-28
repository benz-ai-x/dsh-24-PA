// Waiting for a condition on a real Host, for the e2e files that read the model's requests or the Host's own answers.
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Poll `read` until it returns something other than undefined, at most `limit` (160) times, 250 ms apart. A read that throws or rejects counts
 * as "not yet": a Host that is reloading its plugins answers nothing for a while. `label` names the wait in the error, which ends with
 * the Host's last logs.
 */
export async function until(read, label, host, limit = 160) {
  for (let index = 0; index < limit; index++) {
    let found;
    try { found = await read(); } catch { found = undefined; }
    if (found !== undefined) return found;
    await delay(250);
  }
  throw new Error(`等待${label}超时\n${JSON.stringify(host.logs()).slice(-3000)}`);
}
