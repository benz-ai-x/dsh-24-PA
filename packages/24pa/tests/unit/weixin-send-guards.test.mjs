import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';
import { weixinIdentity } from '../../lib/repo/weixin.js';
import { WeixinCredentialVault } from '../../lib/weixin-credentials.js';
import { WeixinAccess } from '../../lib/weixin-access.js';
import { PlanResults } from '../../lib/plan-results.js';
import { TaskPlanAccess } from '../../lib/task-plan-access.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { taskPlanDraft } from '../../lib/task-plan.js';
import { MemoryStore } from '../../lib/memory.js';
import { fixture, unstartableCli } from '../helpers/runtime.mjs';

// Supplemental transport contract checks. Persistence and credentials are real;
// only the Host Session service and the external iLink endpoint are replaced.
// The real Loader integration remains covered by weixin-plan-delivery.e2e.mjs.
let root, db, repos, access, row, sent, weixinDeps;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-wx-send-'));
  db = new SqliteDb(':memory:'); await db.migrate(); repos = createRepos(db); sent = [];
  let binding = await repos.weixin.register('workspace', 'bot', 'owner');
  await repos.weixin.sessionReady(binding.generation); binding = await repos.weixin.activate(binding.generation, null);
  const identity = weixinIdentity(binding);
  await new WeixinCredentialVault(root).save({ ...identity, base: 'https://ilinkai.weixin.qq.com', token: 'test-private-token', context: 'test-private-context' });
  const agent = { session: { id: binding.session_id, header: { cwd: root, agentPreset: 'pa24' }, ownEvents: () => [] } };
  const agents = { get: () => agent, create: async () => { throw new Error('Unexpected new Session'); }, resume: async () => { throw new Error('Unexpected resume'); } };
  // WeChat as a notification target is a stand-in here too, as the endpoint is: the capability itself is the subject of the last case.
  weixinDeps = extra => ({ host: { get: name => name === 'agents' ? agents : null },
    context: () => ({ workspaceId: 'workspace', hostWorkspaceId: 'host-workspace', workspacePath: root, binding: 'workspace-binding', repo: repos.weixin, outbox: repos.outbox }),
    available: () => true, execute: work => work(), received: () => {},
    request: async (endpoint, options) => {
      if (endpoint.endsWith('getupdates')) return { http: 200, data: { ret: 0, msgs: [], get_updates_buf: '' } };
      if (endpoint.endsWith('sendmessage')) { sent.push(options.body.msg); return { http: 200, data: { ret: 0 } }; }
      throw new Error('Unexpected external endpoint');
    }, ...extra });
  access = new WeixinAccess(weixinDeps({ notificationSupported: () => true }));
  await access.start();
  row = (await repos.outbox.enqueue({ dedupKey: 'test-result', channel: 'weixin', target: 'owner', kind: 'text', content: { text: '原结果' },
    deliveryTarget: identity, association: { inboxEventId: 'original-input' } })).row;
});
afterEach(async () => { vi.restoreAllMocks(); await access?.close(); await db?.close(); if (root) await rm(root, { recursive: true, force: true }); });

it('准备完成后的最终核验发现结果已过期，不向平台发送', async () => {
  await expect(access.send(row, async () => ({ status: 'expired', error: '准备期间已超过原结果的有效期。' })))
    .rejects.toMatchObject({ hold: { status: 'expired' } });
  expect(sent).toEqual([]);
});

it('凭据文件暂时不可读属于未发送，保留待处理而不是发送结果未知', async () => {
  await writeFile(join(root, '.24pa/weixin/secrets.json'), '{incomplete');
  await expect(access.send(row)).rejects.toMatchObject({ hold: { status: 'pending' } });
  expect(sent).toEqual([]);
});

it('最后核验返回期间停用入口，也不能开始新的平台请求', async () => {
  await expect(access.send(row, async () => {
    queueMicrotask(() => queueMicrotask(() => access.pause()));
    return null;
  })).rejects.toMatchObject({ hold: { status: 'pending' } });
  expect(sent).toEqual([]);
});

async function planResult() {
  await vi.waitFor(async () => expect((await access.snapshot()).phase).toBe('polling'));
  const identity = () => ({ requestId: randomUUID(), requestHash: randomUUID() });
  const markdown = '---\nname: wx-dispatch-guard\ndescription: guard\nmetadata:\n  track: agent\n  tools: []\n---\nReturn a result.';
  let entry = await repos.skills.change({ ...identity(), op: 'save', displayName: '发送前核验', version: { package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
  entry = await repos.skills.change({ ...identity(), op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
  const version = await repos.skills.version(entry.active_version);
  const draft = taskPlanDraft({ title: '发送前核验', skillId: `managed:${entry.id}`, timing: { type: 'daily' }, delivery: { channel: 'weixin' } }, 'Asia/Shanghai');
  const taskAccess = new TaskPlanAccess({ owner: () => access.notificationTarget() });
  const authorization = await taskAccess.authorize(draft.configuration, { id: draft.configuration.skillId, name: entry.name, versionId: version.id }, null);
  const plan = await repos.taskPlans.save({ ...identity(), title: draft.title, kind: draft.kind, skill: entry.name, sessionId: 'parent', scheduleSpec: draft.scheduleSpec, configuration: draft.configuration });
  const run = await repos.skillRuns.admit({ request_id: randomUUID(), request_hash: 'new', skill_id: entry.id, version_id: version.id, expectedRevision: entry.revision,
    source_session_id: 'parent', workspace_path: root, mode: 'template', trial: false, plan_id: plan.id, triggered_at: new Date(),
    snapshot: { name: entry.name, definition: version.definition, package: version.package_data, contract: null, parameters: {}, tools: [], permissionHash: 'same',
      plan: { id: plan.id, title: plan.title, generation: 'manual', source: 'manual', triggeredAt: new Date().toISOString(), configuration: draft.configuration, authorization } } });
  const path = join(root, '.24pa/memory.json'), original = JSON.stringify({ schemaVersion: 2, revision: 0, records: [], tombstones: [] });
  await writeFile(path, original);
  // Host filesystem adapter only; the MemoryStore and authority file are real.
  const memory = new MemoryStore(root, { fs: { resolve: async path => ({ path }), stat: async target => ({ version: (await stat(target.path)).mtimeMs }), readText: target => readFile(target.path, 'utf8') } });
  const results = new PlanResults({ repos: () => repos, access: taskAccess, silence: { prepare: async () => {
    const query = await memory.prepareSearch(); return () => { query({ mode: 'facts' }); return null; };
  } } });
  await repos.skillRuns.transition(run.id, 'completed', '已保存', '原计划完整结果'); await results.reconcile();
  const [notice] = await repos.planResults.inspect(run.id);
  return { results, row: notice.deliveries[0].outbox, expires: new Date(notice.deliveries[0].expires_at).getTime(), change: () => writeFileSync(path, original + '\n') };
}

it.each(['preference', 'expiry'])('最外层异步返回期间 %s 改变，在真实请求紧前仍阻止发送', async kind => {
  const prepared = await planResult();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(prepared.expires - 1);
  await expect(access.send(prepared.row, async () => {
    const check = await prepared.results.prepareSend(prepared.row);
    queueMicrotask(() => queueMicrotask(() => kind === 'preference' ? prepared.change() : clock.mockReturnValue(prepared.expires + 1)));
    return check;
  })).rejects.toMatchObject({ hold: { status: kind === 'preference' ? 'pending' : 'expired' } });
  expect(sent).toEqual([]);
});

it('能力没有成立时，服务端拒绝把微信作为通知目标，页面读到的是同一个结论', async () => {
  // The binding, the polling and the reply context are all in place; what is missing is the capability itself (#281).
  const gated = new WeixinAccess(weixinDeps());
  try {
    await gated.start();
    await vi.waitFor(async () => expect((await gated.snapshot()).phase).toBe('polling'));
    await expect(gated.notificationTarget()).rejects.toThrow('还没有通过真实平台验证');
    // The same refusal is what saving or copying a plan asks for.
    expect(() => gated.assertNotificationAdmitted()).toThrow('还没有通过真实平台验证');
    expect(() => access.assertNotificationAdmitted()).not.toThrow();
    expect((await gated.snapshot()).notificationSupported).toBe(false);
    expect((await access.snapshot()).notificationSupported).toBe(true);
  } finally { await gated.close(); }
});

it('真实 runtime 只在 fake 通道的宿主上把这项能力读成成立', async () => {
  // The wiring in runtime.ts: the page reads the answer off the transport this Host was started with (#281).
  const runtimes = [];
  try {
    const fake = await fixture({ env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } }); runtimes.push(fake);
    fake.options.larkCliBin = await unstartableCli(fake);
    await fake.rt.bind(await fake.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }));
    expect((await fake.rt.weixin.snapshot()).notificationSupported).toBe(true);
    const real = await fixture({ env: {} }); runtimes.push(real);
    await real.rt.bind(await real.workspace('a'));
    expect((await real.rt.weixin.snapshot()).notificationSupported).toBe(false);
    // The same wiring behind saving or copying a plan: refused there, admitted on the fake transport.
    await expect(real.rt.taskPlanAccess.admitDelivery({ channel: 'weixin' })).rejects.toThrow('还没有通过真实平台验证');
    await expect(real.rt.taskPlanAccess.admitDelivery({ channel: 'feishu' })).resolves.toBeUndefined();
    await expect(fake.rt.taskPlanAccess.admitDelivery({ channel: 'weixin' })).resolves.toBeUndefined();
  } finally { for (const runtime of runtimes) await runtime.cleanup(); }
});

it('运行前的核验：业务恒核；投递身份飞书、企微核，微信不核', async () => {
  const authorization = channel => ({ checkedAt: 'now', targets: [{ target: { domain: 'todo', platform: 'feishu', identityKey: 'owner', resource: { kind: 'tasklist', id: 'list' } }, capability: 'read' }],
    skill: { id: 'skill', name: 'skill', versionId: 'v', contract: { actions: ['task_list'], mode: 'template' } },
    delivery: { channel, target: 'owner', identityKey: 'owner', connectionHash: 'connection' } });
  // `verifyDelivery` is replaced below, so no identity is ever resolved here and `owner` is never asked.
  const verify = vi.fn(), verifyDelivery = vi.fn(), access = new TaskPlanAccess({ sources: { verify }, owner: vi.fn() });
  access.verifyDelivery = verifyDelivery;
  for (const channel of ['feishu', 'wecom', 'weixin']) {
    await access.verifyForRun(authorization(channel));
    expect(verify.mock.calls.at(-1)[0]).toMatchObject({ resource: { id: 'list' } });
  }
  // Business authority was asked three times, once per channel; the delivery identity only for the two that always did.
  expect(verify).toHaveBeenCalledTimes(3);
  expect(verifyDelivery.mock.calls.map(call => call[0].channel)).toEqual(['feishu', 'wecom']);
  // Enabling still asks the delivery identity of every channel: management has never depended on a target being offline.
  verifyDelivery.mockClear();
  for (const channel of ['feishu', 'wecom', 'weixin']) await access.verify(authorization(channel));
  expect(verifyDelivery.mock.calls.map(call => call[0].channel)).toEqual(['feishu', 'wecom', 'weixin']);
});
