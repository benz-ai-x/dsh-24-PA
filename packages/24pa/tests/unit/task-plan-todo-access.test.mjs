import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { SourceRegistry } from '../../lib/source-registry.js';
import { SourceAccess } from '../../lib/source-access.js';
import { TaskPlanAccess } from '../../lib/task-plan-access.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`计划待办真实来源契约 (${backend})`, () => {
  let db, cluster, repos;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  it.each(['feishu:tasklist', 'feishu:authorized_scope', 'wecom:authorized_scope'])('%s 逐对象写入绑定可读原范围，保留显式写入登记要求', async mode => {
    const [platform, resourceKind] = mode.split(':'), id = mode.replace(':', '-');
    const source = { id, domain: 'todo', platform, resourceKind, resourceId: resourceKind === 'tasklist' ? 'original-list' : 'authorized', name: id,
      purpose: 'personal', ownerId: 'owner', filter: 'all', access: 'readwrite', enabled: true };
    const config = { ownerOpenId: 'owner', timeZone: 'Asia/Shanghai', sources: { version: 1, entries: [source], defaults: { todo: id, calendar: null }, mappings: [], meetingDurationMinutes: null } };
    const adapter = new SourceAccess({ config: () => config,
      lark: async args => args[0] === 'auth' ? { data: { verified: true, appId: 'app', identities: { user: { tokenStatus: 'valid', openId: 'owner' } } } }
        : args[1] === 'tasklists' ? { data: { tasklist: { guid: 'original-list', owner: { type: 'user', id: 'owner' } } } } : { data: { items: [] } },
      wecom: async () => ({ data: { items: [] }, raw: { extra_identity_context: '机器人身份： 名字：助手 ID：bot 授权真人用户身份： 名字：主人 ID：owner' } }) });
    const registry = new SourceRegistry({ repo: () => repos.sources, config: () => config, connectionHash: () => 'original', gate: (_, work) => work(), probe: source => adapter.check(source) });
    const access = new TaskPlanAccess({ sources: registry, owner: async () => { throw new Error('不应投递'); } });
    const evidence = await registry.check(id);
    expect(evidence).toMatchObject({ state: 'verified', capabilities: { read: 'allowed', update: 'unknown', cancel: 'unknown' } });
    for (const action of ['task_update', 'task_complete', 'task_cancel']) {
      const skill = { id: 'managed:test', tools: ['pa24_work'], resources: [], contract: { mode: 'business', actions: [action] } };
      const plan = { selectors: {}, delivery: { channel: 'none' } };
      const authorization = await access.authorize(plan, skill, null);
      expect(authorization.targets[0].target).toMatchObject({ sourceId: id, resource: { kind: resourceKind, id: source.resourceId }, permission: { capability: 'read', verdict: 'allowed' } });
      config.sources.defaults.todo = null;
      await access.verify(authorization);
      expect(await access.action(authorization, action, { guid: 'original-task' })).toMatchObject({ sourceId: id, channel: platform, guid: 'original-task' });
      source.access = 'read';
      await expect(access.verify(authorization)).rejects.toThrow(/只读|变更/);
      config.sources.defaults.todo = id;
      await expect(access.authorize(plan, skill, null)).rejects.toThrow(/只读|写入/);
      source.access = 'readwrite';
    }
  });
});
