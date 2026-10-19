import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, join, readFile, writeFile, deferred } from '../helpers/runtime.mjs';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { ReminderEngine } from '../../lib/reminders.js';
import { createAtScheduleRecord, ScheduleId } from '@deepseek-ai/dsh-schedule';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`R3 周期与等待公开入口 (${backend})`, () => {
  let f, local, cluster, nativeCreates, entries, nativeUnknown, workspacePath;
  beforeEach(async () => {
    f = await fixture({ cliTimeoutMs: 10000 }); nativeCreates = 0; entries = []; nativeUnknown = false;
    for (const [name, variable] of [['lark', 'PA24_LARK_STUB_STATE'], ['wecom', 'PA24_WECOM_STUB_STATE']]) {
      const state = join(f.root, name + '.json'), bin = join(f.root, name + '-cli');
      await writeFile(state, '{}');
      await writeFile(bin, '#!/usr/bin/env node\nprocess.env.' + variable + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
      f.options[name + 'CliBin'] = bin;
    }
    const schedule = {
      create: async (sessionId, request) => {
        const record = createAtScheduleRecord(ScheduleId('schedule-' + (++nativeCreates)), request.prompt, request.at, Date.now(), request.title);
        entries.push({ ...record, sessionId, status: 'active' });
        if (nativeUnknown) throw new Error('native receipt lost'); return record;
      }, catalog: async () => structuredClone(entries), history: async () => ({ entries: [] }),
      delete: async ({ id }) => { entries = entries.filter(row => row.id !== id); return { deleted: true }; },
    };
    f.ctx.get = name => name === 'schedule' ? schedule : name === 'attachments' ? { admitPromptContent: async blocks => blocks } : null;
    if (backend === 'postgres') { cluster = await startPgCluster(); f.options.env.PA24_R3_TEST_DSN = cluster.dsn; }
    workspacePath = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'list', calendarId: 'calendar', folderToken: 'folder', maxWorkers: 8,
      enabledWorkers: ['memo', 'calendar', 'reminders', 'tasks', 'digest'], ...(backend === 'postgres' ? { storage: 'postgres', pgDsnEnv: 'PA24_R3_TEST_DSN' } : {}) });
    await f.rt.bind(workspacePath); f.rt.transport = new FakeFeishuTransport('test'); local = f.agents.get(await f.rt.openLocalSession());
  });
  afterEach(async () => { await f?.cleanup(); await cluster?.stop(); cluster = null; });
  const worker = async role => {
    if (role === 'digest') local.session.ownEvents = () => [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { id: 'owner-request', source: { kind: 'user' }, content: [{ type: 'text', text: '本人要求跟进当前检查点' }] } }];
    return { id: (await f.rt.delegate({ worker: role, title: role, instruction: '本人交办' }, local)).workId };
  };
  const dueTemplate = async id => {
    const due = new Date(Date.now() - 1000), instance = (await f.rt.repos.taskTemplates.instancesOf(id)).find(row => row.status === 'pending');
    await f.rt.db.query('update pa24.task_template_instance set id = $2, due_at = $3 where id = $1', [instance.id, `${id}:${due.toISOString()}`, due]);
    await f.rt.repos.taskTemplates.update(id, { next_due_at: due }); return `${id}:${due.toISOString()}`;
  };
  const journal = async name => (await readFile(join(f.root, name), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const newWaiting = async child => f.rt.work({ action: 'waiting_create', title: '等预算回复', dedupKey: 'mail-1', checkpointAt: new Date(Date.now() - 1000).toISOString() }, child);

  it('完整规则去重、仅星期/时区变化可替换；skip 保留后继，stop 保留历史', async () => {
    const child = await worker('tasks');
    const args = { action: 'task_repeat_create', title: '检查预算', kind: 'weekly', time: '09:00:00', weekdays: [1], timeZone: 'Asia/Shanghai' };
    const created = await Promise.all(Array.from({ length: 5 }, () => f.rt.work(args, child)));
    expect(new Set(created.map(row => row.templateId)).size).toBe(1);
    const first = created[0].templateId;
    const unchanged = await f.rt.work({ action: 'task_repeat_update', templateId: first, weekdays: [1] }, child);
    expect(unchanged).toMatchObject({ templateId: first, reused: true }); expect(unchanged.oldTemplateStopped).toBeUndefined();
    const changed = await f.rt.work({ action: 'task_repeat_update', templateId: first, weekdays: [2] }, child);
    expect(changed.templateId).not.toBe(first); expect((await f.rt.repos.taskTemplates.get(first)).status).toBe('stopped');
    const zoned = await f.rt.work({ action: 'task_repeat_update', templateId: changed.templateId, timeZone: 'UTC' }, child);
    expect(zoned.templateId).not.toBe(changed.templateId);
    const before = (await f.rt.repos.taskTemplates.get(zoned.templateId)).next_due_at;
    await f.rt.work({ action: 'task_repeat_skip', templateId: zoned.templateId }, child);
    const rows = await f.rt.repos.taskTemplates.instancesOf(zoned.templateId);
    expect(rows.map(row => row.status).sort()).toEqual(['pending', 'skipped']);
    expect((await f.rt.repos.taskTemplates.get(zoned.templateId)).next_due_at.getTime()).toBeGreaterThan(before.getTime());
    await f.rt.work({ action: 'task_repeat_stop', templateId: zoned.templateId }, child);
    expect((await f.rt.repos.taskTemplates.instancesOf(zoned.templateId)).every(row => row.status === 'skipped')).toBe(true);
  });

  it('首实例失败回滚；远端成功/本地失败保留回执，后继与投影均可恢复', async () => {
    const child = await worker('tasks'), args = { action: 'task_repeat_create', title: '检查账单', kind: 'every', everySeconds: 60 };
    const repo = f.rt.repos.taskTemplates, insert = repo.insertInstance.bind(repo);
    repo.insertInstance = async () => { throw new Error('first instance unavailable'); };
    await expect(f.rt.work(args, child)).rejects.toThrow('first instance unavailable'); expect(await repo.list('active')).toHaveLength(0);
    repo.insertInstance = insert;
    const { templateId } = await f.rt.work(args, child), instanceId = await dueTemplate(templateId);
    const save = f.rt.repos.tasks.save.bind(f.rt.repos.tasks); let failed = false;
    f.rt.repos.tasks.save = async row => { if (!failed) { failed = true; throw new Error('projection failed'); } return save(row); };
    await f.rt.materializeTemplateInstances(); expect((await repo.instance(instanceId)).status).toBe('failed');
    await f.rt.materializeTemplateInstances(); expect((await repo.instance(instanceId)).status).toBe('generated');
    expect(await journal('lark.json.tasks.jsonl')).toHaveLength(1);
    expect((await repo.instancesOf(templateId)).filter(row => row.status === 'pending')).toHaveLength(1);
  });

  it('claim 后重启恢复；无回执 running 作为未知不重放，仍推进下一发生', async () => {
    const child = await worker('tasks'), { templateId } = await f.rt.work({ action: 'task_repeat_create', title: '巡检', kind: 'every', everySeconds: 60 }, child);
    const first = await dueTemplate(templateId); await f.rt.repos.taskTemplates.claimDueInstances(new Date(), 5);
    await f.rt.stop(); f.rt = f.make(); await f.rt.bind(workspacePath); f.rt.transport = new FakeFeishuTransport('test');
    await f.rt.materializeTemplateInstances(); expect((await f.rt.repos.taskTemplates.instance(first)).status).toBe('generated');
    const second = await dueTemplate(templateId);
    const op = `ttask:${second}`; await f.rt.repos.operations.begin({ id: op, workItemId: 'pa24-system-templates', action: 'task.repeat_generate', params: { title: '巡检' } }); await f.rt.repos.operations.claim(op);
    await f.rt.materializeTemplateInstances();
    expect((await f.rt.repos.operations.get(op)).status).toBe('unknown'); expect((await f.rt.repos.taskTemplates.instance(second)).error).toContain('未知');
    expect((await f.rt.repos.taskTemplates.instancesOf(templateId)).some(row => row.status === 'pending')).toBe(true);
    expect(await journal('lark.json.tasks.jsonl')).toHaveLength(1);
  });

  it('后继提交失败不丢当前发生，成功操作恢复不重复远端写入', async () => {
    const child = await worker('tasks'), { templateId } = await f.rt.work({ action: 'task_repeat_create', title: '同步报告', kind: 'every', everySeconds: 60 }, child);
    const id = await dueTemplate(templateId), repo = f.rt.repos.taskTemplates, insert = repo.insertInstance.bind(repo);
    repo.insertInstance = async () => { throw new Error('successor unavailable'); };
    await expect(f.rt.materializeTemplateInstances()).rejects.toThrow('successor unavailable');
    expect((await f.rt.repos.operations.get(`ttask:${id}`)).status).toBe('succeeded');
    repo.insertInstance = insert; await f.rt.materializeTemplateInstances();
    expect((await repo.instance(id)).status).toBe('generated'); expect((await repo.instancesOf(templateId)).filter(row => row.status === 'pending')).toHaveLength(1);
    expect(await journal('lark.json.tasks.jsonl')).toHaveLength(1);
  });

  it('同源等待唯一且原生计划唯一，tick 不询问；agent skill 只交付一次', async () => {
    const child = await worker('tasks'), results = await Promise.all(Array.from({ length: 5 }, () => newWaiting(child)));
    expect(new Set(results.map(row => row.waitingId)).size).toBe(1); expect(nativeCreates).toBe(1);
    await Promise.all([f.rt.dispatchWaitingCheckpoints(), f.rt.dispatchWaitingCheckpoints()]);
    expect((await f.rt.repos.waiting.get(results[0].waitingId)).ask_count).toBe(0); expect(await f.rt.repos.outbox.recent()).toHaveLength(0);
    const digest = await worker('digest'), planId = results[0].planId;
    expect(await f.rt.work({ action: 'digest_build', planId }, digest)).toMatchObject({ agentTrack: true, skill: { name: 'waiting-followup' }, facts: { waiting: { title: '等预算回复' } } });
    await Promise.all(Array.from({ length: 3 }, () => f.rt.work({ action: 'digest_deliver', planId, report: '预算回复收到了吗？来源：等待事项。可选择收到、继续等、改时间或取消。' }, digest)));
    const waiting = await f.rt.repos.waiting.get(results[0].waitingId); expect(waiting.ask_count).toBe(1); expect(waiting.checkpoint_at).toBeNull();
    expect((await f.rt.repos.outbox.recent()).filter(row => row.dedup_key.startsWith('digest:'))).toHaveLength(1);
    await f.rt.work({ action: 'waiting_control', waitingId: waiting.id, op: 'received' }, child);
    expect((await f.rt.repos.outbox.recent()).find(row => row.dedup_key.startsWith('digest:')).status).toBe('expired');
    expect((await newWaiting(child)).waitingId).not.toBe(waiting.id);
  });

  it.each(['received', 'cancel'])('%s 与慢免打扰读取交叠时不新增过期询问', async op => {
    const child = await worker('tasks'), waiting = await newWaiting(child), digest = await worker('digest');
    await f.rt.work({ action: 'digest_build', planId: waiting.planId }, digest);
    const entered = deferred(), release = deferred(); f.rt.silencePolicy.silentUntil = async () => { entered.resolve(); return release.promise; };
    const delivery = f.rt.work({ action: 'digest_deliver', planId: waiting.planId, report: '收到了吗？' }, digest); const settled = delivery.catch(error => error);
    await entered.promise; await f.rt.work({ action: 'waiting_control', waitingId: waiting.waitingId, op }, child); release.resolve(null);
    expect((await settled).message).toContain('已改变'); expect((await f.rt.repos.waiting.get(waiting.waitingId)).ask_count).toBe(0);
    expect((await f.rt.repos.outbox.recent()).filter(row => row.dedup_key.startsWith('digest:'))).toHaveLength(0);
  });

  it('免打扰延期为新原生检查点，通知事务失败不增加询问次数', async () => {
    const child = await worker('tasks'), waiting = await newWaiting(child), digest = await worker('digest');
    await f.rt.work({ action: 'digest_build', planId: waiting.planId }, digest);
    const until = new Date(Date.now() + 3600000); f.rt.silencePolicy.silentUntil = async () => until;
    await expect(f.rt.work({ action: 'digest_deliver', planId: waiting.planId, report: '收到了吗？' }, digest)).rejects.toThrow('免打扰');
    expect((await f.rt.repos.waiting.get(waiting.waitingId)).checkpoint_at.toISOString()).toBe(until.toISOString()); expect(nativeCreates).toBe(2);
    expect((await f.rt.repos.waiting.get(waiting.waitingId)).ask_count).toBe(0);
    f.rt.silencePolicy.silentUntil = async () => null;
    const second = await f.rt.work({ action: 'waiting_create', title: '等新材料', dedupKey: 'mail-2', checkpointAt: new Date(Date.now() - 1000).toISOString() }, child), another = await worker('digest');
    await f.rt.work({ action: 'digest_build', planId: second.planId }, another);
    const transaction = f.rt.db.withTransaction.bind(f.rt.db); let fail = true;
    f.rt.db.withTransaction = work => transaction(client => work({ query: async (sql, values) => { if (fail && sql.includes('insert into pa24.outbox')) { fail = false; throw new Error('outbox unavailable'); } return client.query(sql, values); } }));
    await expect(f.rt.work({ action: 'digest_deliver', planId: second.planId, report: '材料收到了吗？' }, another)).rejects.toThrow('outbox unavailable');
    expect((await f.rt.repos.waiting.get(second.waitingId)).ask_count).toBe(0);
    await f.rt.work({ action: 'digest_deliver', planId: second.planId, report: '材料收到了吗？' }, another);
    expect((await f.rt.repos.waiting.get(second.waitingId)).ask_count).toBe(1);
  });

  it('原生创建未知经重启恢复；旧同源多项报告歧义', async () => {
    const child = await worker('tasks'); nativeUnknown = true;
    await expect(newWaiting(child)).rejects.toThrow('native receipt lost');
    await f.rt.stop(); f.rt = f.make(); await f.rt.bind(workspacePath); f.rt.transport = new FakeFeishuTransport('test'); local = f.agents.get(await f.rt.openLocalSession()); nativeUnknown = false;
    const result = await newWaiting(await worker('tasks')); expect(result.reused).toBe(true); expect(nativeCreates).toBe(1);
    await f.rt.repos.waiting.insert({ id: 'historical-duplicate', title: '旧重复项', dedupKey: 'mail-1' });
    await expect(newWaiting(await worker('tasks'))).rejects.toThrow('多个历史活动项');
  });

  it.each(['feishu', 'wecom'])('%s 三类日历提醒按原归属取消，周期明确 all', async channel => {
    f.rt.config.calendarChannel = channel; const child = await worker('reminders');
    for (const kind of ['once', 'daily', 'weekly']) {
      const request = { action: 'reminder_create', kind, text: `测试 ${kind}`, ...(kind === 'once' ? { afterSeconds: 300 } : { time: '09:00:00', ...(kind === 'weekly' ? { weekdays: [1, 3] } : {}) }) };
      const created = await f.rt.work(request, child);
      const listed = await f.rt.work({ action: 'reminder_list' }, child), row = listed.rules.find(row => row.ruleId === created.ruleId);
      expect(row).toMatchObject({ calendarChannel: channel, eventId: created.eventId, status: 'delegated', nextDueAt: null }); expect(row.firstStart).toBeTruthy();
      f.rt.config.calendarChannel = channel === 'feishu' ? 'wecom' : 'feishu';
      await f.rt.work({ action: 'reminder_cancel', ruleId: created.ruleId, reason: '本人取消整条规则' }, child);
      expect((await f.rt.repos.reminders.getRule(created.ruleId)).status).toBe('stopped');
      expect(await f.rt.work(request, child)).toMatchObject({ ruleId: created.ruleId, status: 'stopped', reused: true });
      f.rt.config.calendarChannel = channel;
    }
    if (channel === 'wecom') {
      const calls = (await journal('wecom.json.calls.jsonl')).filter(row => row.args.includes('cancel'));
      expect(calls).toHaveLength(3); expect(calls[0].args).not.toContain('--repeat-mod');
      for (const row of calls.slice(1)) expect(JSON.parse(row.args[row.args.indexOf('--repeat-mod') + 1])).toEqual({ repeat_edit_type: 'all' });
    }
  });

  it('归档默认保留原生提醒；显式停止报告部分失败与剩余规则', async () => {
    const child = await worker('reminders');
    const one = await f.rt.work({ action: 'reminder_create', text: '一', afterSeconds: 300 }, child);
    const two = await f.rt.work({ action: 'reminder_create', text: '二', afterSeconds: 600 }, child);
    await f.rt.maintenanceArchiveExecute({ confirmStop: true, stopRules: false });
    expect((await f.rt.repos.reminders.getRule(one.ruleId)).status).toBe('delegated');
    const write = f.rt.calendarWrite.bind(f.rt); f.rt.calendarWrite = async (item, kind, args, id) => { if (args.eventId === two.eventId) throw new Error('platform unavailable'); return write(item, kind, args, id); };
    const result = await f.rt.maintenanceArchiveExecute({ confirmStop: true, stopRules: true });
    expect(result.rulesStopped).toBe(1); expect(result.failures).toHaveLength(1); expect(result.remaining.reminderRules.map(row => row.id)).toEqual([two.ruleId]);
    expect((await f.rt.repos.reminders.getRule(two.ruleId)).status).toBe('delegated');
  });

  it('旧计时入口和并发稍后明确拒绝，恢复停止历史规则与未发送意图', async () => {
    const child = await worker('reminders');
    for (const args of [{ kind: 'every', everySeconds: 60 }, { kind: 'once', afterSeconds: 1, linkTaskGuid: 't' }, { kind: 'once', afterSeconds: 1, linkEventId: 'e' }]) await expect(f.rt.work({ action: 'reminder_create', text: '旧规则', ...args }, child)).rejects.toThrow('已退役');
    const old = await f.rt.reminders.create({ kind: 'once', text: '历史', afterSeconds: 1, timeZone: 'UTC' });
    const occurrence = `${old.ruleId}:legacy`;
    await f.rt.repos.reminders.insertOccurrence({ id: occurrence, ruleId: old.ruleId, dueAt: new Date() });
    await f.rt.repos.outbox.enqueue({ dedupKey: `reminder:${occurrence}`, channel: 'feishu', target: 'owner', kind: 'text', content: { text: '旧提醒' } });
    const attempts = await Promise.allSettled(Array.from({ length: 2 }, () => f.rt.work({ action: 'reminder_snooze', ruleId: old.ruleId, seconds: 5, reason: '稍后' }, child)));
    expect(attempts.every(row => row.status === 'rejected')).toBe(true);
    await f.rt.stop(); f.rt = f.make(); await f.rt.bind(workspacePath);
    expect(f.rt.reminders.timer).toBeNull(); expect(f.rt.reminders.closed).toBe(true);
    expect((await f.rt.repos.reminders.getRule(old.ruleId))).toMatchObject({ status: 'stopped', record: { stopReason: expect.stringContaining('F45') } });
    expect((await f.rt.repos.outbox.recent()).find(row => row.dedup_key === `reminder:${occurrence}`).status).toBe('expired');
  });

  it('升级过期旧等待询问；控制取消新旧待投递意图而保留已发生历史', async () => {
    const child = await worker('tasks'), waiting = await newWaiting(child);
    for (const suffix of ['pending', 'sent', 'unknown']) {
      await f.rt.repos.outbox.enqueue({ dedupKey: `waiting:${waiting.waitingId}:${suffix}`, channel: 'feishu', target: 'owner', kind: 'text', content: { text: '旧询问' } });
      await f.rt.db.query('update pa24.outbox set status = $2 where dedup_key = $1', [`waiting:${waiting.waitingId}:${suffix}`, suffix]);
    }
    await f.rt.stop(); f.rt = f.make(); await f.rt.bind(workspacePath); local = f.agents.get(await f.rt.openLocalSession());
    const states = Object.fromEntries((await f.rt.repos.outbox.recent()).filter(row => row.dedup_key.startsWith('waiting:')).map(row => [row.dedup_key.split(':').at(-1), row.status]));
    expect(states).toEqual({ pending: 'expired', sent: 'sent', unknown: 'unknown' });
    await f.rt.repos.outbox.enqueue({ dedupKey: `waiting:${waiting.waitingId}:late`, channel: 'feishu', target: 'owner', kind: 'text', content: { text: '旧询问残留' } });
    await f.rt.work({ action: 'waiting_control', waitingId: waiting.waitingId, op: 'cancel' }, await worker('tasks'));
    expect((await f.rt.repos.outbox.recent()).find(row => row.dedup_key.endsWith(':late')).status).toBe('expired');
  });

  it.each(['silence', 'source'])('历史在途 %s 查询晚返回时，公开取消后不产生通知', async phase => {
    const child = await worker('reminders'), entered = deferred(), release = deferred(), notifications = [];
    const engine = new ReminderEngine(f.rt.db, { notify: async (...args) => notifications.push(args), outboxState: async () => null,
      sourceValid: async () => { if (phase === 'source') { entered.resolve(); await release.promise; } return { valid: true }; },
    }, { silentUntil: async () => { if (phase === 'silence') { entered.resolve(); await release.promise; } return null; } });
    const old = await engine.create({ kind: 'once', text: '历史来源提醒', at: new Date(Date.now() + 1000).toISOString(), timeZone: 'UTC', link: { sourceType: 'task', sourceId: 'legacy', fingerprint: 'old' } });
    await f.rt.repos.reminders.updateRule(old.ruleId, { next_due_at: new Date(Date.now() - 1000) });
    const tick = engine.tick(); await entered.promise;
    await f.rt.work({ action: 'reminder_cancel', ruleId: old.ruleId, reason: '本人取消' }, child); release.resolve(); await tick; engine.stop();
    expect(notifications).toHaveLength(0); expect((await f.rt.repos.reminders.getRule(old.ruleId)).status).toBe('stopped');
  });
});
