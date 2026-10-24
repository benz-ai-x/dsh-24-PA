import { afterEach, expect, it } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, join, writeFile } from '../helpers/runtime.mjs';

const cleanups = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });
async function setup() {
  const f = await fixture(); cleanups.push(f.cleanup);
  const state = join(f.root, 'wecom.json'), bin = join(f.root, 'wecom-cli');
  await writeFile(state, JSON.stringify({ ownerUserid: 'wou_owner' }));
  await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_WECOM_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-wecom-cli.mjs')) + ');\n');
  await chmod(bin, 0o755); f.options.wecomCliBin = bin;
  const workspace = await f.workspace('identity', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'tasks', notifyChannel: 'wecom', calendarChannel: 'wecom', todoChannel: 'wecom' });
  await f.rt.bind(workspace);
  return { ...f, state, workspace };
}
const authorize = rt => rt.taskPlanAccess.authorize({ selectors: {}, delivery: { channel: 'wecom' } }, { contract: { actions: [] } }, null);

it('健康检查前冻结的企微投递在首次检查、重复检查及重启后均保持有效', async () => {
  const f = await setup(), authorization = await authorize(f.rt);
  await f.rt.taskPlanAccess.verify(authorization);
  expect((await f.rt.wecomCheck()).identity.state).toBe('ok');
  await f.rt.taskPlanAccess.verify(authorization);
  expect((await f.rt.wecomCheck()).identity.state).toBe('ok');
  await f.rt.taskPlanAccess.verify(authorization);
  const rt = f.make(); await rt.bind(f.workspace);
  await rt.taskPlanAccess.verify(authorization);
  expect((await rt.repos.health.identity('wecom')).changed).toBe(false);
});
it('来源先核验即建立稳定身份；换机器人后旧缓存和新投递授权均被阻断', async () => {
  const f = await setup(), id = (await f.rt.sourceRegistry.list()).entries.find(row => row.platform === 'wecom' && row.domain === 'calendar').id;
  expect((await f.rt.sourceRegistry.check(id)).state).toBe('verified');
  expect((await f.rt.sourceRegistry.list()).entries.find(row => row.id === id).status).toBe('verified');
  const original = await authorize(f.rt);
  await writeFile(f.state, JSON.stringify({ ownerUserid: 'wou_owner', botId: 'other-bot' }));
  expect((await f.rt.wecomCheck()).identity.state).toBe('error');
  expect((await f.rt.sourceRegistry.list()).entries.find(row => row.id === id).status).toBe('pending');
  await expect(f.rt.taskPlanAccess.verify(original)).rejects.toThrow(/绑定已改变/);
  await expect(authorize(f.rt)).rejects.toThrow(/绑定已改变/);
  expect((await f.rt.sourceRegistry.check(id)).state).toBe('failed');
  const rt = f.make(); await rt.bind(f.workspace);
  await expect(authorize(rt)).rejects.toThrow(/绑定已改变/);
});
