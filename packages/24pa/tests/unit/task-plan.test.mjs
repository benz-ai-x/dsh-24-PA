import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { taskPlanDraft } from '../../lib/task-plan.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { startPgCluster } from '../helpers/pg.mjs';

const now = Date.parse('2026-10-23T01:00:00Z');
const draft = patch => taskPlanDraft({ title: '每日汇总', skillId: 'builtin:digest-morning', timing: { type: 'daily', time: '08:00:00' }, ...patch }, 'Asia/Shanghai', now);
describe('通用定时任务的无副作用配置', () => {
  it.each([
    [{ type: 'once', at: '2026-10-24T09:00:00+08:00' }, '2026-10-24T01:00:00.000Z'],
    [{ type: 'daily', time: '08:00:00' }, '2026-10-24T00:00:00.000Z'],
    [{ type: 'weekdays', time: '08:00:00' }, '2026-10-26T00:00:00.000Z'],
    [{ type: 'weekly', time: '08:00:00', weekdays: [1, 5] }, '2026-10-26T00:00:00.000Z'],
    [{ type: 'monthly', time: '08:00:00', day: 31 }, '2026-10-31T00:00:00.000Z'],
    [{ type: 'interval', seconds: 3600 }, '2026-10-23T02:00:00.000Z'],
    [{ type: 'advanced', expression: '0 8 * * *' }, '2026-10-24T00:00:00.000Z'],
  ])('规则 %j 与原生未来触发一致', (timing, first) => {
    const result = draft({ timing }); expect(result.nextTimes[0]).toBe(first);
    expect(result.configuration).toMatchObject({ executionLimitMs: 900000, timeZone: 'Asia/Shanghai', missedTtlMs: 3600000 });
  });
  it('缺省目标不代表授权；不同日历口径、投递范围和非法规则明确说明', () => {
    expect(draft({ timing: { type: 'weekdays' } }).notices.join()).toContain('不等于法定工作日');
    const monthly = draft({ timing: { type: 'monthly', day: 31, time: '09:00:00' } });
    expect(monthly.nextTimes.some(time => time.startsWith('2026-11'))).toBe(false);
    expect(() => draft({ timeZone: 'bad-zone' })).toThrow(/时区/);
    expect(() => draft({ delivery: { channel: 'wecom', voice: true } })).toThrow(/语音/);
    expect(() => draft({ timing: { type: 'interval', seconds: 1 } })).toThrow();
    expect(() => draft({ selectors: { calendar: { sourceId: '' } } })).toThrow(/业务目标/);
    expect(draft({ delivery: { channel: 'feishu', mode: 'changed' } }).notices.join()).toContain('完整结果正文');
  });
});

for (const backend of ['sqlite', 'postgres']) describe(`通用计划草稿与独立状态 (${backend})`, () => {
  let db, cluster, repos, entry;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  const identity = () => ({ requestId: randomUUID(), requestHash: randomUUID() });
  const select = row => ({ ...identity(), id: row.id, expectedRevision: row.revision });
  beforeEach(async () => {
    const markdown = '---\nname: plan-test\ndescription: plan-test\nmetadata:\n  track: agent\n  tools: []\n---\nMake a report.';
    entry = await repos.skills.change({ ...identity(), op: 'save', displayName: '计划测试', version: { package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
    entry = await repos.skills.change({ ...identity(), op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
  });
  const saveInput = patch => {
    const value = draft({ skillId: `managed:${entry.id}` });
    return { ...identity(), title: '计划 ' + randomUUID(), skill: entry.name, kind: value.kind, scheduleSpec: value.scheduleSpec, configuration: value.configuration, sessionId: 'fixed-feishu-parent', ...patch };
  };
  const authorize = async row => {
    const version = await repos.skills.version(entry.active_version);
    return repos.taskPlans.authorize({ ...select(row), authorization: { checkedAt: new Date().toISOString(), skill: {
      id: `managed:${entry.id}`, name: entry.name, versionId: version.id, packageHash: version.package_data.hash, tools: [], contract: null, resources: [] }, targets: [], delivery: null } });
  };
  it('同一保存请求只产生一个暂停计划；草稿和复制均不能继承启用授权', async () => {
    const input = saveInput(), [first, repeated] = await Promise.all([repos.taskPlans.save(input), repos.taskPlans.save(input)]);
    expect(first.id).toBe(repeated.id); expect(first.owner_enabled).toBe(false); expect(first.task_authorization).toBeNull();
    expect(first.schedule_id).toBeNull(); expect(first.created_at).toBeInstanceOf(Date);
    await expect(repos.taskPlans.save({ ...input, requestHash: 'changed' })).rejects.toThrow(/其他内容/);
    await expect(repos.taskPlans.chooseEnabled({ ...select(first), enabled: true })).rejects.toThrow(/核验/);
    const authorized = await authorize(first);
    const enabled = await repos.taskPlans.chooseEnabled({ ...select(authorized), enabled: true });
    expect(enabled.owner_enabled).toBe(true); expect(enabled.status).toBe('paused');
    const copy = await repos.taskPlans.save(saveInput({ configuration: enabled.task_config }));
    expect(copy.id).not.toBe(first.id); expect(copy.task_authorization).toBeNull(); expect(copy.owner_enabled).toBe(false);
  });
  it('禁用 Skill 可存暂停草稿，启用被阻挡；删除不能越过该引用', async () => {
    entry = await repos.skills.change({ ...identity(), op: 'disable', id: entry.id, expectedRevision: entry.revision });
    const row = await repos.taskPlans.save(saveInput());
    await expect(authorize(row)).rejects.toThrow(/禁用|启用/);
    await expect(repos.skills.change({ ...identity(), op: 'delete', id: entry.id, expectedRevision: entry.revision })).rejects.toThrow(/计划/);
  });
  it('修复一个阻断保留另一个及主人暂停选择，原生规则身份不丢失', async () => {
    let row = await authorize(await repos.taskPlans.save(saveInput()));
    row = await repos.taskPlans.chooseEnabled({ ...select(row), enabled: true });
    await repos.digests.updatePlan(row.id, { status: 'active', schedule_id: 'native-fixed' });
    await Promise.all([
      repos.taskPlans.block(row.id, { key: 'source:A', kind: 'authorization', reason: 'A 已撤权' }),
      repos.taskPlans.block(row.id, { key: 'dependency:cli', kind: 'dependency', reason: '缺 CLI' }),
    ]);
    row = await repos.taskPlans.get(row.id);
    expect(row).toMatchObject({ owner_enabled: true, status: 'paused', schedule_id: 'native-fixed' });
    row = await repos.taskPlans.chooseEnabled({ ...select(row), enabled: false });
    await repos.taskPlans.clearBlock(row.id, 'source:A');
    expect((await repos.taskPlans.blocks(row.id)).map(block => block.key)).toEqual(['dependency:cli']);
    expect((await repos.taskPlans.get(row.id)).owner_enabled).toBe(false);
    await expect(repos.taskPlans.chooseEnabled({ ...select(await repos.taskPlans.get(row.id)), enabled: true })).rejects.toThrow(/阻断/);
  });
  it('并发编辑只保存一份，不能覆盖已经授权或重新绑定的版本', async () => {
    const row = await repos.taskPlans.save(saveInput()), command = saveInput({ id: row.id, expectedRevision: row.revision });
    const results = await Promise.allSettled([repos.taskPlans.save(command), authorize(row)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });
  it('原生删除或运行未确认时先等待；回收后还原为暂停且保留历史配置', async () => {
    let row = await repos.taskPlans.save(saveInput());
    await repos.digests.updatePlan(row.id, { schedule_id: 'native-old' });
    row = await repos.taskPlans.requestDelete(select(await repos.taskPlans.get(row.id)));
    expect((await repos.taskPlans.finishDelete(row.id)).recycled_at).toBeNull();
    await repos.digests.updatePlan(row.id, { schedule_id: null });
    row = await repos.taskPlans.finishDelete(row.id);
    expect(row.recycled_at).toBeInstanceOf(Date); expect(row.status).toBe('stopped');
    const restored = await repos.taskPlans.restore(select(row));
    expect(restored).toMatchObject({ owner_enabled: false, status: 'paused', task_authorization: null, recycled_at: null });
    expect(restored.task_config).toEqual(row.task_config); expect(restored.session_id).toBe('fixed-feishu-parent');
  });
  it('按全部匹配准确分页；关键词通配符为文字，回收单列', async () => {
    const prefix = '精确%_' + randomUUID();
    const rows = [];
    for (let index = 0; index < 4; index++) rows.push(await repos.taskPlans.save(saveInput({ title: prefix + index })));
    const retired = await repos.taskPlans.requestDelete(select(rows[0])); await repos.taskPlans.finishDelete(retired.id);
    const result = await repos.taskPlans.list({ query: prefix, limit: 2, offset: 1, skillId: `managed:${entry.id}` });
    expect(result.total).toBe(3); expect(result.rows).toHaveLength(2);
    const deleted = await repos.taskPlans.list({ query: prefix, state: 'recycled' });
    expect(deleted.total).toBe(1); expect(deleted.rows[0].id).toBe(retired.id);
  });
});
