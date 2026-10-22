import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { taskPlanDraft } from '../../lib/task-plan.js';
import { PlanResults } from '../../lib/plan-results.js';
import { OutboxDelivery, DeliveryHeld } from '../../lib/outbox-delivery.js';
import { sendLarkAudioMessage } from '../../lib/lark.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`投递评审边界 (${backend})`, () => {
  let db, cluster, repos, run, plan, results, access;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    for (const table of ['task_plan_delivery_change', 'task_plan_delivery', 'task_plan_notice', 'task_plan_run_outcome', 'task_plan_block', 'skill_run_control', 'skill_run_session', 'skill_run', 'work_item', 'digest_plan', 'outbox']) await db.query(`delete from pa24.${table}`);
    const identity = () => ({ requestId: randomUUID(), requestHash: randomUUID() });
    const markdown = '---\nname: delivery-guard\ndescription: guard\nmetadata:\n  track: agent\n  tools: []\n---\nReturn a result.';
    let entry = await repos.skills.change({ ...identity(), op: 'save', displayName: '边界验证', version: { package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
    entry = await repos.skills.change({ ...identity(), op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
    const version = await repos.skills.version(entry.active_version);
    const draft = taskPlanDraft({ title: '边界计划', skillId: `managed:${entry.id}`, timing: { type: 'daily' }, delivery: { channel: 'feishu', voice: true } }, 'Asia/Shanghai');
    const config = draft.configuration, authorization = { checkedAt: new Date().toISOString(), targets: [], skill: { id: config.skillId, name: entry.name, versionId: version.id }, delivery: { channel: 'feishu', target: 'owner', identityKey: 'owner', connectionHash: 'fixed' } };
    plan = await repos.taskPlans.save({ ...identity(), title: draft.title, kind: draft.kind, skill: entry.name, sessionId: 'parent', scheduleSpec: draft.scheduleSpec, configuration: config });
    run = await repos.skillRuns.admit({ request_id: randomUUID(), request_hash: 'new', skill_id: entry.id, version_id: version.id, expectedRevision: entry.revision,
      source_session_id: 'parent', workspace_path: '/workspace', mode: 'template', trial: false, plan_id: plan.id, triggered_at: new Date(),
      snapshot: { name: entry.name, definition: version.definition, package: version.package_data, contract: null, parameters: {}, tools: [], permissionHash: 'same',
        plan: { id: plan.id, title: plan.title, generation: 'manual', source: 'manual', triggeredAt: new Date().toISOString(), configuration: config, authorization } } });
    access = { verifyDelivery: async () => {} };
    results = new PlanResults({ repos: () => repos, access, silence: { silentUntil: async () => null }, binding: () => 'workspace' });
  });
  const saved = async () => { await repos.skillRuns.transition(run.id, 'completed', '保存成功', '完整结果'); await results.reconcile(); };
  const notices = () => repos.planResults.inspect(run.id);
  const dispatcher = send => new OutboxDelivery({ repo: () => repos.outbox, routes: () => repos.messageRoutes, sent() {}, adapters: { feishu: { available: () => true, supports: () => true, send } },
    beforeSend: row => results.beforeSend(row), updated: row => results.updated(row) });
  it('数组或对象操作名不能绕过核对，也不能清空已有送达回执', async () => {
    await saved(); await dispatcher(async () => { throw new Error('发送结果未知'); }).drain();
    const original = (await notices())[0].deliveries[0];
    for (const op of [['retry'], ['review'], { toString: 'review' }]) {
      await expect(results.change({ op, requestId: randomUUID(), workspaceBinding: 'workspace', confirm: true,
        runId: run.id, outboxId: Number(original.outbox.id), fingerprint: original.fingerprint, outcome: 'sent' })).rejects.toThrow(/操作无效/);
    }
    expect((await notices())[0].deliveries[0].outbox).toMatchObject({ status: 'unknown', message_id: null });
    await expect(repos.planResults.repair({ op: ['review'], requestId: randomUUID(), requestHash: 'bad', runId: run.id, outboxId: Number(original.outbox.id), fingerprint: original.fingerprint, outcome: 'sent' })).rejects.toThrow(/操作无效/);
  });
  it('慢身份核验跨过有效期后不调用发送适配器，也不消耗发送次数', async () => {
    await saved(); const expiry = new Date((await notices())[0].deliveries[0].expires_at).getTime();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiry - 1);
    access.verifyDelivery = async () => { await Promise.resolve(); clock.mockReturnValue(expiry + 1); };
    let sends = 0; await dispatcher(async () => { sends++; return { messageId: 'unexpected' }; }).drain();
    expect(sends).toBe(0); expect((await notices())[0].deliveryStatus).toBe('expired');
    expect((await notices())[0].deliveries.every(row => row.outbox.attempts === 0)).toBe(true);
  });
  it('语音准备跨过期限后在实际 CLI 派发前停止，完整文本与业务结果保持成功', async () => {
    await saved(); const expiry = new Date((await notices())[0].deliveries[0].expires_at).getTime();
    const audio = (await notices())[0].deliveries.find(row => row.component === 'audio');
    await repos.outbox.mark(audio.outbox.id, { status: 'pending', retryInMs: 60000 });
    await dispatcher(async () => ({ messageId: 'text-confirmed' })).drain();
    await repos.outbox.mark(audio.outbox.id, { status: 'pending', retryInMs: 0 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiry - 1);
    await dispatcher(async row => {
      clock.mockReturnValue(expiry + 1);
      return sendLarkAudioMessage({ bin: '/missing/never-dispatch-expired-audio', profile: 'test', timeoutMs: 100 }, 'owner', Buffer.from('ogg'), row.dedup_key, async () => {
        const hold = await results.beforeSend(row); if (hold) throw new DeliveryHeld(hold);
      });
    }).drain();
    const [notice] = await notices(); expect(notice.deliveryStatus).toBe('partial');
    expect(notice.deliveries.find(row => row.component === 'audio').outbox).toMatchObject({ status: 'expired', attempts: 0 });
    expect(await repos.skillRuns.get(run.id)).toMatchObject({ status: 'completed', result: '完整结果' });
  });
  it('权限阻断停止排队运行会通知处理，主人暂停仍静默，两者都不计最终失败', async () => {
    await repos.taskPlans.block(plan.id, { key: 'preflight', kind: 'authorization', reason: '原日历的写入授权已撤销' });
    await results.reconcile(); let sends = 0;
    await dispatcher(async () => ({ messageId: `attention-${++sends}` })).drain();
    expect(await repos.skillRuns.get(run.id)).toMatchObject({ status: 'stopped', stop_reason: 'blocked', delivery_status: 'sent' });
    const [notice] = await notices(); expect(notice.kind).toBe('blocked'); expect(notice.deliveries[0].expires_at).toBeNull();
    expect(notice.deliveries[0].outbox.content.text).toContain('原日历的写入授权已撤销');
    expect((await repos.taskPlans.get(plan.id)).failure_count).toBe(0); expect(sends).toBe(1);
  });
});
