import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { DigestService } from '../../lib/digest-service.js';
import { SkillCatalog } from '../../lib/skills.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`周期计划配置恢复 (${backend})`, () => {
  let db, root, cluster, repos, native, entries, creates, deletes, service, deps;
  const rebuild = () => { repos = createRepos(db); service = new DigestService(deps); };
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-plan-')); db = new SqliteDb(join(root, 'ledger.db')); }
    await db.migrate();
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    await db.query('delete from pa24.digest_plan'); entries = []; creates = 0; deletes = [];
    native = {
      create: async (sessionId, request) => {
        const record = { id: `schedule-${++creates}`, prompt: request.prompt, title: request.title, kind: request.daily ? 'daily' : 'at', createdAt: new Date().toISOString(), scheduledAt: request.at ?? new Date(Date.now() + 86400000).toISOString(), ...(request.daily ? { daily: request.daily } : {}) };
        entries.push({ ...record, sessionId, status: 'active' }); return record;
      },
      catalog: async () => structuredClone(entries),
      delete: async ({ id }) => { deletes.push(id); const found = entries.some(e => e.id === id); entries = entries.filter(e => e.id !== id); return found ? { id, deleted: true } : { id, deleted: false, code: 'schedule_not_found' }; },
      update: async request => {
        expect(request.expected).not.toHaveProperty('sessionId'); expect(request.expected).not.toHaveProperty('status');
        const entry = entries.find(e => e.id === request.id);
        Object.assign(entry, { prompt: request.prompt, title: request.title, daily: request.change.daily });
        const { sessionId, status, ...record } = entry;
        return { id: entry.id, updated: true, record };
      },
      history: async () => ({ records: [] }),
    };
    deps = { repos: () => repos, nativeSchedule: () => native, accessSessionId: () => 'access', workspace: () => ({ statePath: '/test/workspace' }), config: () => ({ timeZone: 'Asia/Shanghai' }), skillCatalog: () => new SkillCatalog(null) };
    rebuild();
  });
  const enable = () => service.digestEnable({ kind: 'morning', time: '08:00:00' });

  it('本地首次持久化失败不能留下无账本原生计划', async () => {
    repos.digests.insertPlan = async () => { throw new Error('ledger offline'); };
    await expect(enable()).rejects.toThrow('ledger offline'); expect(creates).toBe(0);
  });
  it('远端已创建而本地回执失败，重建服务从 catalog 收编同一原生ID', async () => {
    const create = native.create;
    native.create = async (...args) => { const result = await create(...args); entries[0].status = 'inactive'; throw new Error('reply lost'); };
    await expect(enable()).rejects.toThrow('reply lost'); expect(creates).toBe(1);
    const before = (await repos.digests.listPlans())[0]; expect(before).toBeTruthy();
    rebuild(); native.create = create;
    await service.recoverPlans(); const after = await repos.digests.getPlan(before.id);
    expect(after.schedule_id).toBe('schedule-1'); expect(after.status).toBe('active'); expect(creates).toBe(1);
  });
  it('创建结果未知且零个或多个匹配时不重建、不任意选择', async () => {
    native.create = async () => { creates++; throw new Error('unknown create'); };
    await expect(enable()).rejects.toThrow('unknown create');
    rebuild(); await service.recoverPlans(); expect(creates).toBe(1);
    let plan = (await repos.digests.listPlans())[0]; expect(plan.status).toBe('paused'); expect(plan.lifecycle).toBeTruthy();
    const prompt = plan.lifecycle.request.prompt;
    entries = ['a', 'b'].map(id => ({ id, sessionId: 'access', status: 'active', prompt }));
    await service.recoverPlans(); plan = await repos.digests.getPlan(plan.id);
    expect(plan.schedule_id).toBeNull(); expect(plan.lifecycle.error).toMatch(/多个|歧义/); expect(creates).toBe(1);
  });
  it('暂停先阻止业务运行，删除失败保留ID；重建后继续清理 paused 计划', async () => {
    const result = await enable(); const del = native.delete;
    native.delete = async () => { expect((await repos.digests.getPlan(result.planId)).status).toBe('paused'); throw new Error('delete offline'); };
    const stopped = await service.digestControl({ planId: result.planId, op: 'pause' }); expect(stopped.nativeWarning).toContain('delete offline');
    expect((await repos.digests.getPlan(result.planId)).schedule_id).toBe('schedule-1');
    rebuild(); native.delete = del; await service.recoverPlans();
    expect((await repos.digests.getPlan(result.planId)).schedule_id).toBeNull(); expect(deletes).toEqual(['schedule-1']);
    await service.digestControl({ planId: result.planId, op: 'resume' }); expect(creates).toBe(2);
  });
  it('调整使用 expected 比较更新，同ID保留；冲突停止自动覆盖', async () => {
    const result = await enable();
    await service.digestControl({ planId: result.planId, op: 'adjust', time: '09:00:00' });
    const updated = await repos.digests.getPlan(result.planId);
    expect(updated.schedule_id).toBe('schedule-1'); expect(updated.schedule_spec.daily.time).toBe('09:00:00'); expect(creates).toBe(1); expect(deletes).toHaveLength(0);
    native.update = async () => ({ id: 'schedule-1', updated: false, code: 'schedule_conflict' });
    await expect(service.digestControl({ planId: result.planId, op: 'adjust', time: '10:00:00' })).rejects.toThrow(/conflict|冲突/);
    expect((await repos.digests.getPlan(result.planId)).schedule_spec.daily.time).toBe('09:00:00');
    rebuild(); await service.recoverPlans(); expect(creates).toBe(1); expect(deletes).toHaveLength(0);
  });
  it('相对一次计划先固定绝对时间，未知重试不移动目标', async () => {
    native.create = async (_session, request) => { creates++; expect(request.after_seconds).toBeUndefined(); expect(request.at).toBeTruthy(); throw new Error('unknown create'); };
    await expect(service.digestEnable({ kind: 'once', afterSeconds: 300 })).rejects.toThrow('unknown create');
    const plan = (await repos.digests.listPlans())[0], at = plan.schedule_spec.at;
    rebuild(); await expect(service.digestEnable({ kind: 'once', afterSeconds: 300 })).rejects.toThrow(/未知|核对/);
    expect((await repos.digests.getPlan(plan.id)).schedule_spec.at).toBe(at); expect(creates).toBe(1);
  });
  it('创建回执落账失败后仅补账，更新回执丢失也按 marker 恢复', async () => {
    const compare = repos.digests.comparePlan.bind(repos.digests); let fail = true;
    repos.digests.comparePlan = async (row, patch) => { if (patch.status === 'active' && fail) { fail = false; throw new Error('ack disk failure'); } return compare(row, patch); };
    await expect(enable()).rejects.toThrow('ack disk failure'); expect(creates).toBe(1);
    rebuild(); await service.recoverPlans(); const plan = (await repos.digests.listPlans())[0];
    expect(plan.schedule_id).toBe('schedule-1');
    const update = native.update; native.update = async args => { await update(args); throw new Error('update reply lost'); };
    await expect(service.digestControl({ planId: plan.id, op: 'adjust', time: '09:30:00' })).rejects.toThrow('update reply lost');
    rebuild(); await service.recoverPlans();
    expect((await repos.digests.getPlan(plan.id)).schedule_spec.daily.time).toBe('09:30:00'); expect(creates).toBe(1); expect(deletes).toHaveLength(0);
  });
  it('在途创建、并发恢复与暂停共用同一计划队列，切换前等待原操作', async () => {
    const create = native.create; let release, entered;
    const ready = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
    native.create = async (...args) => { entered(); await held; return create(...args); };
    const starting = enable(); await ready;
    const recovery = service.recoverPlans(); let paused = false;
    const pausing = service.pause().then(() => { paused = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(paused).toBe(false);
    release(); await Promise.all([starting, recovery, pausing]); expect(creates).toBe(1);
    await expect(enable()).rejects.toThrow(/切换或停止/); service.resume();
  });

});
