import type { NativeScheduleService } from './host.js';
import type { DigestPlanRow } from './repo.js';
import type { DigestTriggerSource } from './digest-trigger.js';

/** Native history proves enqueue only. Compare the full delivery identity with
 * completed business sources, retaining the host's explicit coverage limits. */
export async function inspectDigestDeliveries(schedule: NativeScheduleService, plan: DigestPlanRow, completed: DigestTriggerSource[], graceMs: number, now: number) {
  const key = (session: string, id: string, at: string, message: string) => JSON.stringify([session, id, at, message]);
  const done = new Set(completed.flatMap(source => source.kind === 'schedule' ? source.deliveries.map(d => key(source.sessionId, d.scheduleId, d.occurrenceAt, d.messageId)) : []));
  const seen = new Set<string>(), cursors = new Set<string>(), overdue: { scheduledAt: string; deliveredAt: string; messageId: string }[] = [];
  let before: string | undefined, observed = 0;
  const warnings: string[] = [];
  do {
    let page: Record<string, any>;
    try { page = await schedule.history({ sessionId: plan.session_id, id: plan.schedule_id!, limit: 100, ...(before ? { before } : {}) }); }
    catch (error) { warnings.push(`原生投递历史读取失败：${(error as Error).message}`); break; }
    if (!Array.isArray(page.records)) { warnings.push('原生投递历史缺少 records，覆盖范围无法核验。'); break; }
    if (page.earlierRecordsUnavailable || page.earlierRecordsPruned) warnings.push('更早原生投递历史已不可用，只核验保留范围。');
    for (const row of page.records) {
      if (typeof row.messageId !== 'string' || !row.messageId || !Number.isFinite(Date.parse(row.scheduledAt)) || !Number.isFinite(Date.parse(row.deliveredAt))) {
        warnings.push('原生投递记录缺少有效身份或时间，不能推断业务完成。'); continue;
      }
      const scheduledAt = new Date(row.scheduledAt).toISOString(), deliveredAt = new Date(row.deliveredAt).toISOString();
      const identity = key(plan.session_id, plan.schedule_id!, scheduledAt, row.messageId);
      if (seen.has(identity)) continue;
      seen.add(identity); observed += 1;
      if (!done.has(identity) && now - Date.parse(deliveredAt) > graceMs) overdue.push({ scheduledAt, deliveredAt, messageId: row.messageId });
    }
    before = typeof page.nextBefore === 'string' && page.nextBefore ? page.nextBefore : undefined;
    if (before && cursors.has(before)) { warnings.push('原生历史分页游标重复，未宣称覆盖全部记录。'); break; }
    if (before) cursors.add(before);
  } while (before);
  return { observed, overdue, warnings: [...new Set(warnings)] };
}
