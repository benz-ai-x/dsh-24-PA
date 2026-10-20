import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';
const require = createRequire('/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/package.json');
const { createAtScheduleRecord, ScheduleId } = require('@deepseek-ai/dsh-schedule');
const results = [];
let pg;
try {
 for (const storage of ['sqlite', 'postgres']) {
  const f = await fixture();
  try {
   if (storage === 'postgres') { pg = await startPgCluster(); f.options.env.PA24_AUDIT_DSN = pg.dsn; }
   let entries = [], history = [], deletions = [], creates = 0;
   f.ctx.get = name => name === 'schedule' ? {
    create: async (sessionId, request) => { const record = createAtScheduleRecord(ScheduleId('native-' + (++creates)), request.prompt, request.at, Date.now(), request.title); entries.push({ ...record, sessionId, status: 'active' }); return record; },
    catalog: async () => structuredClone(entries),
    delete: async req => { deletions.push(req); entries = entries.filter(e => e.id !== req.id); return { deleted: true }; },
    history: async req => ({ records: history.filter(e => e.scheduleId === req.id).map(e => ({ ...e })) }),
   } : name === 'attachments' ? { admitPromptContent: async blocks => blocks } : null;
   const path = await f.workspace('workspace', { mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'list', calendarId: 'calendar', folderToken: 'folder', maxWorkers: 8, enabledWorkers: ['digest', 'reminders'], ...(storage === 'postgres' ? { storage, pgDsnEnv: 'PA24_AUDIT_DSN' } : {}) });
   await f.rt.bind(path);
   const lead = f.agents.get(await f.rt.openLocalSession());
   lead.session.ownEvents = () => [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { id: 'owner', source: { kind: 'user' }, content: [{ type: 'text', text: '本人开启一次性简报用于验证提醒' }] } }];
   const child = { id: (await f.rt.delegate({ worker: 'reminders', title: '开启计划', instruction: '本人开启一次性简报' }, lead)).workId };
   const plan = await f.rt.work({ action: 'digest_enable', kind: 'once', afterSeconds: 1 }, child);
   const native = entries[0];
   await new Promise(resolve => setTimeout(resolve, 1100));
   history.push({ scheduleId: native.id, scheduledAt: native.scheduledAt, deliveredAt: native.scheduledAt, messageId: 'native-wake-1', prompt: native.prompt });
   if (storage === 'postgres') {
    await f.rt.db.query("create or replace function pa24.audit_fail() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_ALERT_ENQUEUE_FAILURE'; end; $$");
    await f.rt.db.query('create trigger audit_fail before insert on pa24.outbox for each row execute function pa24.audit_fail()');
   } else await f.rt.db.query("create trigger audit_fail before insert on pa24.outbox begin select raise(abort, 'AUDIT_ALERT_ENQUEUE_FAILURE'); end");
   let error;
   try { await f.rt.superviseDigests(0); } catch (e) { error = e.message; }
   const afterFailure = await f.rt.repos.digests.getPlan(plan.planId);
   const alertsAfterFailure = (await f.rt.repos.outbox.recent(100)).filter(r => r.dedup_key.startsWith('digestunconfirmed:'));
   await f.rt.db.query(storage === 'postgres' ? 'drop trigger audit_fail on pa24.outbox' : 'drop trigger audit_fail');
   const sameProcessRetry = await f.rt.superviseDigests(0);
   const alertsAfterRetry = (await f.rt.repos.outbox.recent(100)).filter(r => r.dedup_key.startsWith('digestunconfirmed:'));
   await f.rt.stop(); f.rt = f.make(); await f.rt.bind(path);
   const afterRestart = await f.rt.superviseDigests(0);
   const alertsAfterRestart = (await f.rt.repos.outbox.recent(100)).filter(r => r.dedup_key.startsWith('digestunconfirmed:'));
   // A newly enabled plan without injection proves the normal notification path.
   const lead2 = f.agents.get(await f.rt.openLocalSession());
   lead2.session.ownEvents = lead.session.ownEvents;
   const child2 = { id: (await f.rt.delegate({ worker: 'reminders', title: '对照计划', instruction: '本人开启对照简报' }, lead2)).workId };
   const control = await f.rt.work({ action: 'digest_enable', kind: 'once', afterSeconds: 1 }, child2);
   const native2 = entries[0];
   await new Promise(resolve => setTimeout(resolve, 1100));
   history.push({ scheduleId: native2.id, scheduledAt: native2.scheduledAt, deliveredAt: native2.scheduledAt, messageId: 'native-wake-2', prompt: native2.prompt });
   const controlSupervision = await f.rt.superviseDigests(0);
   const alertsControl = (await f.rt.repos.outbox.recent(100)).filter(r => r.dedup_key.startsWith('digestunconfirmed:'));
   results.push({ storage, planId: plan.planId, error, afterFailure: { status: afterFailure.status, scheduleId: afterFailure.schedule_id, lifecycle: afterFailure.lifecycle, alerts: alertsAfterFailure.length }, sameProcessRetry, alertsAfterRetry: alertsAfterRetry.length, afterRestart, alertsAfterRestart: alertsAfterRestart.length, deletedNativeIds: deletions.map(d => d.id), control: { planId: control.planId, supervision: controlSupervision, alerts: alertsControl.map(r => ({ dedupKey: r.dedup_key, status: r.status, text: r.content.text })) } });
  } finally { await f.cleanup(); await pg?.stop(); pg = null; }
 }
} finally { await pg?.stop(); }
await writeFile('/tmp/pa24-deep3-lifecycle-supervision-result.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
