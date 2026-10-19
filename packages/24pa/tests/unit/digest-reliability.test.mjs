import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DigestService } from '../../lib/digest-service.js';
import { SkillCatalog } from '../../lib/skills.js';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { startPgCluster } from '../helpers/pg.mjs';

const catalog = new SkillCatalog({
  register: () => () => {},
  list: async () => [{ name: 'custom-brief', description: '简报', provider: 'filesystem', source: 'project-dsh', metadata: {} }],
  get: async name => name === 'custom-brief' ? { name, description: '', content: '按完成标准 X 生成简报。' } : undefined,
});

// Replace the former mocked-status delivery tests with the business interface
// running against both real local ledger adapters. No private method calls.
for (const backend of ['sqlite', 'postgres']) describe(`周期工作耐久交付 (${backend})`, () => {
  let db, cluster, root, repos, digest, deps, config, failInsert, failTarget;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-digest-')); db = new SqliteDb(join(root, 'ledger.db')); }
    await db.migrate();
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  beforeEach(async () => {
    for (const table of ['digest_work_binding', 'digest_occurrence', 'digest_plan', 'outbox']) await db.query(`delete from pa24.${table}`);
    failInsert = false; failTarget = false;
    const faultDb = {
      query: (...args) => db.query(...args),
      withTransaction: work => db.withTransaction(client => work({ query: async (sql, values) => {
        if (failInsert && sql.startsWith('insert into pa24.outbox') && values?.[3] === 'text') throw new Error('injected text enqueue failure');
        return client.query(sql, values);
      } })),
    };
    repos = createRepos(faultDb);
    config = { timeZone: 'Asia/Shanghai', calendarId: 'cal', notifyChannel: 'feishu', ownerOpenId: 'owner', tts: { engine: 'volcengine' } };
    deps = {
      repos: () => repos, config: () => config, skillCatalog: () => catalog,
      accessSessionId: () => 'access', workspace: () => ({ statePath: '/tmp/digest-test' }),
      startedAt: () => new Date().toISOString(), nativeSchedule: () => ({ create: async () => ({ id: 'schedule-1' }), delete: async () => {} }),
      memory: () => null, reviewQueueCount: async () => 0, inspectNoteTrust: async () => { throw new Error('unexpected note'); },
      syncCalendarWindow: async () => ({ ok: true }),
      notifyOwner: async () => { throw new Error('completion must commit outbox with the ledger'); },
      ownerNotification: async (dedupKey, report) => {
        if (failTarget) throw new Error('injected owner lookup failure');
        return { dedupKey, channel: config.notifyChannel, target: 'owner', kind: 'text', content: { text: report } };
      },
    };
    digest = new DigestService(deps);
  });
  const plan = (skill = 'custom-brief', voice = false, kind = 'morning') => repos.digests.insertPlan({ id: 'plan', kind, title: '晨报', schedule_id: 'schedule-1', session_id: 'access', schedule_spec: {}, status: 'active', last_window: null, voice, skill });
  const item = id => ({ id });
  const outbox = () => repos.outbox.recent(50);

  it('agent 轨交接不发送；同事项交付和重复交付只生成一份全文', async () => {
    await plan();
    const built = await digest.digestBuild(item('work'), { planId: 'plan' });
    expect(built.agentTrack).toBe(true); expect(built.skill.content).toContain('完成标准');
    expect(await outbox()).toHaveLength(0);
    await digest.digestDeliver(item('work'), { planId: 'plan', report: '生成结果' });
    expect((await digest.digestDeliver(item('work'), { planId: 'plan', report: '重复内容' })).reused).toBe(true);
    expect((await outbox()).map(row => row.content.text)).toEqual(['生成结果']);
    await expect(digest.digestDeliver(item('work'), { planId: 'plan', report: '' })).rejects.toThrow(/report/);
  });

  it('全文入队失败回滚语音与完成状态；恢复后按序各一条', async () => {
    await plan('custom-brief', true); await digest.digestBuild(item('work'), { planId: 'plan' });
    failInsert = true;
    await expect(digest.digestDeliver(item('work'), { planId: 'plan', report: '应恢复的结果' })).rejects.toThrow('injected');
    expect(await outbox()).toHaveLength(0);
    expect((await repos.digests.runForWorkItem('plan', 'work')).status).toBe('delivering');
    failInsert = false;
    await digest.digestDeliver(item('work'), { planId: 'plan', report: '应恢复的结果' });
    expect((await outbox()).sort((a, b) => a.id - b.id).map(row => row.kind)).toEqual(['audio', 'text']);
    expect((await repos.digests.runForWorkItem('plan', 'work')).outbox_key).toBeTruthy();
  });

  it('主人目标解析失败不宣称完成，重试可交付', async () => {
    await plan(); await digest.digestBuild(item('work'), { planId: 'plan' }); failTarget = true;
    await expect(digest.digestDeliver(item('work'), { planId: 'plan', report: '结果' })).rejects.toThrow('owner lookup');
    expect((await repos.digests.runForWorkItem('plan', 'work')).status).toBe('delivering');
    failTarget = false; await digest.digestDeliver(item('work'), { planId: 'plan', report: '结果' });
    expect(await outbox()).toHaveLength(1);
  });

  it('迟到事项重建 module 后续办保持原窗口，未绑定事项不得冒用最新窗口', async () => {
    await plan(); vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T04:00:00Z'));
    const old = await digest.digestBuild(item('old-work'), { planId: 'plan' });
    vi.setSystemTime(new Date('2026-10-19T04:00:00Z'));
    const fresh = await digest.digestBuild(item('new-work'), { planId: 'plan' });
    digest = new DigestService(deps);
    expect((await digest.digestBuild(item('old-work'), { planId: 'plan' })).windowKey).toBe(old.windowKey);
    await expect(digest.digestDeliver(item('unbound-work'), { planId: 'plan', report: '猜测' })).rejects.toThrow('归属');
    expect((await digest.digestDeliver(item('old-work'), { planId: 'plan', report: '旧窗口结果' })).windowKey).toBe(old.windowKey);
    expect(fresh.windowKey).not.toBe(old.windowKey);
    expect((await repos.digests.runForWorkItem('plan', 'new-work')).status).toBe('delivering');
    expect((await outbox())[0].dedup_key).toBe(`digest:plan:${old.windowKey}`);
  });

  it('暂停后拒绝交付，并发重复交付只入队一次', async () => {
    await plan(); await digest.digestBuild(item('work'), { planId: 'plan' });
    await digest.digestControl({ planId: 'plan', op: 'pause' });
    await expect(digest.digestDeliver(item('work'), { planId: 'plan', report: '暂停结果' })).rejects.toThrow('暂停');
    expect(await outbox()).toHaveLength(0);
    await digest.digestControl({ planId: 'plan', op: 'resume' });
    await Promise.all([1, 2].map(() => digest.digestDeliver(item('work'), { planId: 'plan', report: '结果' })));
    expect(await outbox()).toHaveLength(1);
  });

  it('旧完成但未入队的数据补交保存的正文，事务提交前再次检查暂停', async () => {
    const p = await plan();
    const { row } = await repos.digests.claimRun({ planId: p.id, windowKey: 'legacy-window', workItemId: 'work' });
    await repos.digests.updateOccurrence(row.id, { status: 'model_done', report: '旧版本已保存结果' });
    await digest.digestDeliver(item('work'), { planId: p.id, report: '重试不能替换已保存结果' });
    expect((await outbox())[0].content.text).toBe('旧版本已保存结果');
    await repos.digests.updatePlan(p.id, { status: 'paused' });
    await expect(digest.deliverPrepared(p, row, '过时调用')).rejects.toThrow('暂停');
  });

  it('会前准备使用同一协议，故障恢复和重复调用不覆盖正文', async () => {
    const p = await plan('meeting-prep', false, 'meeting_prep');
    const { row } = await repos.digests.claimRun({ planId: p.id, windowKey: 'event', workItemId: 'prep' });
    failInsert = true;
    await expect(digest.deliverPrepared(p, row, '准备包')).rejects.toThrow('injected');
    expect((await repos.digests.runForWorkItem(p.id, 'prep')).status).toBe('delivering');
    failInsert = false;
    await digest.deliverPrepared(p, row, '准备包'); await digest.deliverPrepared(p, row, '重复准备包');
    expect((await outbox()).map(row => row.content.text)).toEqual(['准备包']);
  });

  it('模板轨手动运行独立于日窗口，非法 skill 不留下空运行', async () => {
    await plan('digest-morning');
    expect((await digest.digestRunNow('plan')).windowKey).toMatch(/^manual-/);
    await digest.digestBuild(item('scheduled'), { planId: 'plan' });
    await digest.digestControl({ planId: 'plan', op: 'skill', skill: 'custom-brief' });
    await expect(digest.digestRunNow('plan')).rejects.toThrow('agent 轨');
    await repos.digests.updatePlan('plan', { skill: 'deleted' });
    await expect(digest.digestRunNow('plan')).rejects.toThrow('已不在目录中');
    expect(await repos.digests.occurrencesOf('plan')).toHaveLength(2);
  });

  it('没有 TTS 或企微渠道的语音计划降级为全文文本', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await plan('digest-morning', true); config.tts.engine = 'none';
    await digest.digestBuild(item('work'), { planId: 'plan' });
    config.notifyChannel = 'wecom'; await digest.digestRunNow('plan');
    expect(await outbox()).toHaveLength(2);
    expect((await outbox()).every(row => row.kind === 'text')).toBe(true);
  });
});
