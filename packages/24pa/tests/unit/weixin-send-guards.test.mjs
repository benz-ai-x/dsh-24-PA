import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';
import { weixinIdentity } from '../../lib/repo/weixin.js';
import { WeixinCredentialVault } from '../../lib/weixin-credentials.js';
import { WeixinAccess } from '../../lib/weixin-access.js';

// Supplemental transport contract checks. Persistence and credentials are real;
// only the Host Session service and the external iLink endpoint are replaced.
// The real Loader integration remains covered by weixin-plan-delivery.e2e.mjs.
let root, db, repos, access, row, sent;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-wx-send-'));
  db = new SqliteDb(':memory:'); await db.migrate(); repos = createRepos(db); sent = [];
  let binding = await repos.weixin.register('workspace', 'bot', 'owner');
  await repos.weixin.sessionReady(binding.generation); binding = await repos.weixin.activate(binding.generation, null);
  const identity = weixinIdentity(binding);
  await new WeixinCredentialVault(root).save({ ...identity, base: 'https://ilinkai.weixin.qq.com', token: 'test-private-token', context: 'test-private-context' });
  const agent = { session: { id: binding.session_id, header: { cwd: root, agentPreset: 'pa24' }, ownEvents: () => [] } };
  const agents = { get: () => agent, create: async () => { throw new Error('Unexpected new Session'); }, resume: async () => { throw new Error('Unexpected resume'); } };
  access = new WeixinAccess({ host: { get: name => name === 'agents' ? agents : null },
    context: () => ({ workspaceId: 'workspace', hostWorkspaceId: 'host-workspace', workspacePath: root, binding: 'workspace-binding', repo: repos.weixin, outbox: repos.outbox }),
    available: () => true, execute: work => work(), received: () => {},
    request: async (endpoint, options) => {
      if (endpoint.endsWith('getupdates')) return { http: 200, data: { ret: 0, msgs: [], get_updates_buf: '' } };
      if (endpoint.endsWith('sendmessage')) { sent.push(options.body.msg); return { http: 200, data: { ret: 0 } }; }
      throw new Error('Unexpected external endpoint');
    } });
  await access.start();
  row = (await repos.outbox.enqueue({ dedupKey: 'test-result', channel: 'weixin', target: 'owner', kind: 'text', content: { text: '原结果' },
    deliveryTarget: identity, association: { inboxEventId: 'original-input' } })).row;
});
afterEach(async () => { await access?.close(); await db?.close(); if (root) await rm(root, { recursive: true, force: true }); });

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
