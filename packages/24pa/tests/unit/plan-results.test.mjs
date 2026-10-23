import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { taskPlanDraft } from '../../lib/task-plan.js';
import { PlanResults } from '../../lib/plan-results.js';
import { OutboxDelivery } from '../../lib/outbox-delivery.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`计划结果与投递 (${backend})`, () => {
  let db, cluster, repos, entry, version, plan, config, authorization, results, silentUntil, owner;
  const identity = () => ({ requestId: randomUUID(), requestHash: randomUUID() });
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  beforeEach(async () => {
    for (const table of ['task_plan_delivery_change', 'task_plan_delivery', 'task_plan_notice', 'task_plan_run_outcome', 'plan_trigger', 'task_plan_change', 'task_plan_block',
      'skill_run_call', 'skill_run_native', 'skill_run_review', 'skill_run_session', 'skill_run_control', 'skill_run_resume', 'skill_run', 'work_item', 'digest_plan', 'outbox']) await db.query(`delete from pa24.${table}`);
    const markdown = '---\nname: result-test\ndescription: result\nmetadata:\n  track: agent\n  tools: []\n---\nReturn a result.';
    entry = await repos.skills.change({ ...identity(), op: 'save', displayName: '结果核验', version: { package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
    entry = await repos.skills.change({ ...identity(), op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
    version = await repos.skills.version(entry.active_version);
    const draft = taskPlanDraft({ title: '日报', skillId: `managed:${entry.id}`, timing: { type: 'daily' }, delivery: { channel: 'feishu' } }, 'Asia/Shanghai');
    config = draft.configuration;
    authorization = { checkedAt: new Date().toISOString(), skill: { id: config.skillId, name: entry.name, versionId: version.id, packageHash: version.package_data.hash, tools: [], contract: null, resources: [] },
      targets: [], delivery: { channel: 'feishu', target: 'owner-a', identityKey: 'owner-a', connectionHash: 'fixed' } };
    plan = await repos.taskPlans.save({ ...identity(), title: draft.title, kind: draft.kind, skill: entry.name, sessionId: 'parent', scheduleSpec: draft.scheduleSpec, configuration: config });
    plan = await repos.taskPlans.authorize({ ...identity(), id: plan.id, expectedRevision: plan.revision, authorization });
    plan = await repos.taskPlans.chooseEnabled({ ...identity(), id: plan.id, expectedRevision: plan.revision, enabled: true });
    owner = 'owner-a'; silentUntil = null;
    results = new PlanResults({ repos: () => repos, access: { verifyDelivery: async destination => { if (destination.target !== owner) throw new Error('身份改变'); } },
      silence: { silentUntil: async () => silentUntil }, binding: () => 'workspace' });
  });
  const admit = (overrides = {}) => repos.skillRuns.admit({ request_id: randomUUID(), request_hash: 'new', skill_id: entry.id, version_id: version.id,
    expectedRevision: entry.revision, source_session_id: 'parent', workspace_path: '/workspace', mode: 'template', trial: false,
    plan_id: plan.id, triggered_at: new Date(), trigger_kind: 'manual',
    snapshot: { name: entry.name, definition: version.definition, package: version.package_data, contract: null, parameters: {}, tools: [], permissionHash: 'same',
      plan: { id: plan.id, title: plan.title, generation: 'manual', source: 'manual', triggeredAt: new Date().toISOString(), configuration: structuredClone(config), authorization: structuredClone(authorization) } }, ...overrides });
  const finish = async (status = 'completed', result = '结果正文', overrides) => {
    const run = await admit(overrides); await repos.skillRuns.transition(run.id, status, status === 'completed' ? '已保存结果' : '执行错误', result); return run;
  };
  const notices = run => repos.planResults.inspect(run.id);
  const dispatcher = send => new OutboxDelivery({ repo: () => repos.outbox, routes: () => repos.messageRoutes, sent() {},
    adapters: { feishu: { available: () => true, supports: () => true, send } }, beforeSend: row => results.beforeSend(row), updated: row => results.updated(row) });

  it('结果、比较基准、通知意图耐久保存；并发结算不重复文本或语音', async () => {
    config.delivery.voice = true; const run = await finish();
    await Promise.all([results.reconcile(), results.reconcile()]);
    expect((await repos.skillRuns.get(run.id)).result).toBe('结果正文');
    const [notice] = await notices(run); expect(notice.deliveryStatus).toBe('pending');
    expect(notice.deliveries.map(row => row.component).sort()).toEqual(['audio', 'text']);
    expect(notice.deliveries.every(row => row.outbox.target === 'owner-a')).toBe(true);
    expect((await repos.taskPlans.get(plan.id)).last_success_hash).toBeTruthy();
    expect((await db.query('select * from pa24.task_plan_run_outcome')).rows).toHaveLength(1);
  });
  it('仅变化按成功正文比较，通知过期不回退基准；正文时间戳变化也通知', async () => {
    config.delivery.mode = 'changed';
    const one = await finish('completed', '相同正文', { triggered_at: new Date(Date.now() - 3600001) });
    await results.reconcile(); let sends = 0;
    await dispatcher(async () => { sends++; return { messageId: 'sent' }; }).drain();
    expect((await notices(one))[0].deliveryStatus).toBe('expired');
    const two = await finish('completed', '相同正文'); await results.reconcile();
    expect((await notices(two))[0].deliveryStatus).toBe('suppressed');
    const three = await finish('completed', '相同正文\n时间：09:00'); await results.reconcile();
    expect((await notices(three))[0].deliveryStatus).toBe('pending'); expect(sends).toBe(0);
    expect((await repos.outbox.recent()).length).toBe(2);
  });
  it('等待、内部重试和主动停止不计最终失败，成功重置；第三次最终失败保留主人选择并阻断', async () => {
    const waiting = await admit();
    for (let i = 0; i < 3; i++) { await repos.skillRuns.transition(waiting.id, 'waiting', '等待主人'); await results.reconcile(); }
    expect((await notices(waiting))).toHaveLength(1);
    expect((await repos.taskPlans.get(plan.id)).failure_count).toBe(0);
    await repos.skillRuns.transition(waiting.id, 'failed', '最终失败'); await results.reconcile();
    await finish('stopped'); await results.reconcile(); expect((await repos.taskPlans.get(plan.id)).failure_count).toBe(1);
    await finish(); await results.reconcile(); expect((await repos.taskPlans.get(plan.id)).failure_count).toBe(0);
    for (const status of ['failed', 'timed_out', 'failed']) { await finish(status); await results.reconcile(); }
    await results.reconcile(); expect(await repos.taskPlans.get(plan.id)).toMatchObject({ failure_count: 3, owner_enabled: true, status: 'paused' });
    expect((await repos.taskPlans.blocks(plan.id)).map(row => row.key)).toEqual(['failures']);
  });
  it('第三次失败在新触发准入前结算，不依赖后台轮询先后', async () => {
    for (let i = 0; i < 3; i++) await finish('failed');
    const result = await repos.planTriggers.admit({ plan, source: 'manual', generation: 'manual', occurrence: randomUUID(), triggeredAt: new Date(), sessionId: 'parent' });
    expect(result.trigger.status).toBe('rejected'); expect(result.run).toBeNull();
    expect((await repos.taskPlans.get(plan.id)).failure_count).toBe(3);
    expect((await repos.taskPlans.blocks(plan.id)).map(row => row.key)).toEqual(['failures']);
  });
  it('普通结果免打扰暂缓不消耗重试次数；明确预约可覆盖，失败通知仍遵守免打扰且不过期', async () => {
    silentUntil = new Date(Date.now() + 7200000); const one = await finish(); await results.reconcile();
    let sends = 0; const worker = dispatcher(async () => ({ messageId: `msg-${++sends}` })); await worker.drain();
    let row = (await notices(one))[0].deliveries[0].outbox;
    expect(row).toMatchObject({ status: 'pending', attempts: 0 }); expect(new Date(row.next_attempt_at).getTime()).toBeLessThan(silentUntil.getTime());
    config.delivery.overrideQuiet = true;
    const two = await finish(); await results.reconcile(); await worker.drain();
    expect((await notices(two))[0].deliveryStatus).toBe('sent');
    const failed = await finish('failed', undefined, { triggered_at: new Date(Date.now() - 7200000) }); await results.reconcile(); await worker.drain();
    const [failure] = await notices(failed); expect(failure.deliveries[0]).toMatchObject({ expires_at: null, override_quiet: false });
    expect(failure.deliveryStatus).toBe('pending'); expect(sends).toBe(1);
    silentUntil = null; await repos.outbox.mark(failure.deliveries[0].outbox.id, { status: 'pending', retryInMs: 0 }); await worker.drain();
    expect((await notices(failed))[0].deliveryStatus).toBe('sent');
  });
  it('文本成功与语音失败分别保存；投递失败不改变业务成功或连续失败次数', async () => {
    config.delivery.voice = true; const run = await finish(); await results.reconcile(); let sends = 0;
    const worker = dispatcher(async row => { sends++; if (row.kind === 'audio') throw Object.assign(new Error('TTS 暂不可用'), { outcome: 'failed' }); return { messageId: 'text-sent' }; });
    await worker.drain();
    const audio = (await notices(run))[0].deliveries.find(row => row.component === 'audio');
    for (let i = 0; i < 2; i++) { await repos.outbox.mark(audio.outbox.id, { status: 'pending', retryInMs: 0 }); await worker.drain(); }
    expect((await notices(run))[0].deliveryStatus).toBe('partial');
    expect((await notices(run))[0].deliveries.find(row => row.component === 'audio').outbox.status).toBe('failed');
    expect(await repos.skillRuns.get(run.id)).toMatchObject({ status: 'completed', delivery_status: 'partial', result: '结果正文' });
    expect((await repos.taskPlans.get(plan.id)).failure_count).toBe(0); expect(sends).toBe(4);
  });
  it('身份变化不能改投；未知发送不能自动重发；已有平台回执重启只修复本地状态', async () => {
    const one = await finish(); await results.reconcile(); owner = 'owner-b'; let sends = 0;
    await dispatcher(async () => ({ messageId: `message-${++sends}` })).drain();
    expect((await notices(one))[0].deliveryStatus).toBe('failed'); expect(sends).toBe(0);
    owner = 'owner-a'; const two = await finish(); await results.reconcile();
    const worker = dispatcher(async () => { sends++; throw new Error('回执丢失'); }); await worker.drain(); await worker.drain();
    expect((await notices(two))[0].deliveryStatus).toBe('unknown'); expect(sends).toBe(1);
    const three = await finish(); await results.reconcile(); const row = (await notices(three))[0].deliveries[0].outbox;
    await repos.outbox.claim(5); await repos.outbox.mark(row.id, { status: 'sending', messageId: 'remote-confirmed' });
    owner = 'owner-b'; await worker.recover(); await worker.drain();
    expect((await notices(three))[0].deliveryStatus).toBe('sent'); expect(sends).toBe(1);
  });
  it('等待已经结束时旧处理通知不迟到推送；仅异常和仅保存策略仍保留结果', async () => {
    const run = await admit(); await repos.skillRuns.transition(run.id, 'waiting', '请补充地点'); await results.reconcile();
    await repos.skillRuns.transition(run.id, 'completed', '完成', '正文'); await results.reconcile(); let sends = 0;
    await dispatcher(async () => ({ messageId: `message-${++sends}` })).drain();
    expect((await notices(run)).find(notice => notice.kind === 'attention').deliveryStatus).toBe('expired'); expect(sends).toBe(1);
    config.delivery.mode = 'errors'; const errors = await finish(); await results.reconcile(); expect((await notices(errors))[0].deliveryStatus).toBe('suppressed');
    config.delivery.channel = 'none'; authorization.delivery = null; const local = await finish(); await results.reconcile();
    expect((await notices(local))[0].deliveryStatus).toBe('not_requested'); expect((await repos.skillRuns.get(local.id)).result).toBe('结果正文');
  });
  const repair = async (run, op, extra = {}) => {
    const row = (await notices(run)).at(-1).deliveries[0];
    return { op, runId: run.id, outboxId: Number(row.outbox.id), fingerprint: row.fingerprint, requestId: randomUUID(), workspaceBinding: 'workspace', confirm: true, ...extra };
  };
  it('未知结果先留核对依据；确认未送达不自动补投，明确补投只恢复原 Outbox', async () => {
    const run = await finish(); await results.reconcile(); let sends = 0;
    await dispatcher(async () => { sends++; throw new Error('回执丢失'); }).drain();
    await expect(results.change(await repair(run, 'retry'))).rejects.toThrow(/未知/);
    await expect(results.change(await repair(run, 'review', { outcome: 'not_sent' }))).rejects.toThrow(/核对依据/);
    const reviewed = await repair(run, 'review', { outcome: 'not_sent', evidence: '在原会话核验该时间段，没有此消息。' });
    await results.change(reviewed); await results.change(reviewed);
    expect((await notices(run))[0].deliveryStatus).toBe('failed');
    const worker = dispatcher(async row => { sends++; expect(row.target).toBe('owner-a'); return { messageId: 'original-result' }; });
    await worker.drain(); expect(sends).toBe(1);
    const retry = await repair(run, 'retry'); await results.change(retry); await worker.drain(); await results.change(retry); await worker.drain();
    expect(sends).toBe(2); const [notice] = await notices(run); expect(notice.deliveryStatus).toBe('sent');
    expect(notice.deliveries[0].changes).toHaveLength(2);
    expect((await db.query('select id from pa24.skill_run')).rows).toHaveLength(1); expect(await repos.outbox.recent()).toHaveLength(1);
  });
  it('未知送达经原消息 ID 核对只补本地状态，过期或身份变化都不重发', async () => {
    const run = await finish(); await results.reconcile(); let sends = 0;
    const worker = dispatcher(async () => { sends++; throw new Error('回执丢失'); }); await worker.drain();
    const reviewed = await repair(run, 'review', { outcome: 'sent', evidence: '原平台消息链接与正文一致', messageId: 'verified-message' });
    await results.change(reviewed); owner = 'owner-b'; await worker.drain();
    expect(sends).toBe(1); expect((await notices(run))[0].deliveries[0].outbox).toMatchObject({ status: 'sent', message_id: 'verified-message' });
    await expect(results.change({ ...reviewed, requestId: randomUUID() })).rejects.toThrow(/回执已变化/);
    await expect(results.change({ ...reviewed, workspaceBinding: 'other' })).rejects.toThrow(/工作区/);
  });
});
