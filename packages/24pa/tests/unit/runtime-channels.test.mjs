import { afterEach, describe, expect, it } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';
import { SdkFeishuTransport } from '../../lib/feishu.js';
import { taskFingerprint } from '../../lib/task-lifecycle.js';
import { sendLarkAudioMessage } from '../../lib/lark.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const f = await fixture(); cleanups.push(f.cleanup);
  const state = join(f.root, 'lark-state.json'), bin = join(f.root, 'lark-cli');
  await writeFile(state, '{}');
  await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
  f.options.larkCliBin = bin;
  const a = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'list', folderToken: 'folder', enabledWorkers: ['memo', 'tasks'] }); await f.rt.bind(a);
  const local = f.agents.get(await f.rt.openLocalSession());
  return { ...f, state, bin, local, calls: async () => (await readFile(state + '.calls.jsonl', 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse) };
}
const createCount = calls => calls.filter(c => c.args.includes('+create') && c.args.includes('docs')).length;

describe('R3 Runtime 渠道边界', () => {
  it('真实模式没有长连接也用 CLI 保存备忘；缺 CLI 失败后同一意图可修复且只创建一次', async () => {
    const f = await setup(); expect(f.rt.getTransport()).toBeNull();
    const task = await f.rt.delegate({ worker: 'memo', title: '保存备忘', instruction: '记下材料' }, f.local);
    const child = { id: task.workId }, args = { action: 'memo_save', topic: '材料', content: '已核对的内容' };
    f.options.larkCliBin = join(f.root, 'missing');
    await expect(f.rt.work(args, child)).rejects.toThrow(/无法启动/);
    f.options.larkCliBin = f.bin;
    expect(await f.rt.work(args, child)).toMatchObject({ demo: false, docUrl: expect.stringContaining('feishu') });
    expect(await f.rt.work(args, child)).toMatchObject({ reused: true });
    expect(createCount(await f.calls())).toBe(1);
  });
  it('旧 demo 成功记录本人再次保存时补真实文档；已有文档不再创建', async () => {
    const f = await setup(); f.rt.config.mode = 'demo';
    const task = await f.rt.delegate({ worker: 'memo', title: '保存备忘', instruction: '记下材料' }, f.local);
    const child = { id: task.workId }, args = { action: 'memo_save', topic: '材料', content: 'demo 遗留内容' };
    expect(await f.rt.work(args, child)).toMatchObject({ demo: true });
    f.rt.config.mode = 'feishu';
    const results = await Promise.all(Array.from({ length: 12 }, () => f.rt.work(args, child)));
    expect(results.every(r => r.docUrl?.includes('feishu'))).toBe(true);
    expect(results.filter(r => !r.reused)).toHaveLength(1);
    expect(await f.rt.work(args, child)).toMatchObject({ reused: true }); expect(createCount(await f.calls())).toBe(1);
  });
  it('长业务键穿过真实 SDK text/card 参数后仍区分回合、代次、类型及目标；重试稳定', async () => {
    const f = await setup(), requests = [], accepted = new Map();
    const transport = new SdkFeishuTransport('app', 'unused');
    transport.client = { im: { message: { create: async request => {
      if (requests.length === 0) { requests.push(request); return { code: 1, msg: '明确拒绝' }; }
      requests.push(request); const key = request.data.uuid;
      if (!accepted.has(key)) accepted.set(key, 'om-' + accepted.size);
      return { code: 0, data: { message_id: accepted.get(key) } };
    } } } }; f.rt.transport = transport;
    const key = `workitem:${randomUUID()}:result:g1:t1`, rows = [];
    for (const [dedupKey, kind, target] of [[key, 'text', 'owner'], [key.replace('t1', 't2'), 'text', 'owner'], [key.replace('g1', 'g2'), 'text', 'owner'], [key + ':card', 'card', 'owner']]) {
      rows.push((await f.rt.repos.outbox.enqueue({ dedupKey, channel: 'feishu', target, kind, content: { text: '结果' } })).row);
    }
    await f.rt.sendOutbox(); expect(accepted.size).toBe(3);
    for (const request of requests) expect(request.data.uuid.length).toBeLessThanOrEqual(50);
    await f.rt.repos.outbox.mark(rows[0].id, { status: 'pending', retryInMs: 0 }); await f.rt.sendOutbox();
    expect(accepted.size).toBe(4); expect(requests.at(-1).data.uuid).toBe(requests[0].data.uuid);
    // Separate workspaces can reuse the same business identity; target remains part of the platform key.
    // Drive the runtime adapter through a second isolated workspace ledger.
    const b = await f.workspace('b'); await f.rt.bind(b); f.rt.transport = transport;
    transport.client = { im: { message: { create: async request => { requests.push(request); const key = request.data.uuid; if (!accepted.has(key)) accepted.set(key, 'om-' + accepted.size); return { code: 0, data: { message_id: accepted.get(key) } }; } } } };
    await f.rt.repos.outbox.enqueue({ dedupKey: key, channel: 'feishu', target: 'other-owner', kind: 'text', content: { text: '结果' } });
    await f.rt.sendOutbox(); expect(accepted.size).toBe(5); expect(requests.at(-1).data.uuid).not.toBe(requests[0].data.uuid);
  });
  it('任务来源检查核对远端终态和失败；完成或取消不进入项目 next', async () => {
    const f = await setup();
    const delegated = await f.rt.delegate({ worker: 'tasks', title: '任务', instruction: '创建待办' }, f.local), child = { id: delegated.workId };
    const created = await f.rt.work({ action: 'task_create', summary: '任务', due: '2026-11-01' }, child);
    let task = await f.rt.repos.tasks.byGuid(created.guid); const fp = taskFingerprint(task);
    expect(await f.rt.sourceVerdict('task', task.task_guid, fp)).toEqual({ valid: true });
    await f.rt.repos.projects.create({ id: 'project', name: '项目' }); await f.rt.repos.projects.link('project', task.id);
    await writeFile(f.state, JSON.stringify({ taskGetOverride: { guid: task.task_guid, summary: '[24PA] 任务', completed_at: '1790000000000', due: null } }));
    expect(await f.rt.sourceVerdict('task', task.task_guid, fp)).toMatchObject({ valid: false, reason: '任务已完成或取消' });
    let progress = await f.rt.work({ action: 'project_progress', projectId: 'project' }, child); expect(progress.next).toBeNull();
    task = await f.rt.repos.tasks.get(task.id); await f.rt.repos.tasks.save({ ...task, status: 'canceled' });
    progress = await f.rt.work({ action: 'project_progress', projectId: 'project' }, child); expect(progress.next).toBeNull();
    await writeFile(f.state, JSON.stringify({ failNext: { command: 'task.get' } }));
    expect(await f.rt.sourceVerdict('task', task.task_guid, fp)).toMatchObject({ valid: false, unknown: true });
  });
  it('CLI audio 与同一长前缀的 text 键不同，audio 重试仍仅交付一次', async () => {
    const f = await setup(), calls = [];
    const transport = new SdkFeishuTransport('app', 'unused');
    transport.client = { im: { message: { create: async request => { calls.push(request); return { code: 0, data: { message_id: 'text-message' } }; } } } }; f.rt.transport = transport;
    const key = `digest:${randomUUID()}:occurrence:2026-10-19T09:00:00Z`;
    await f.rt.repos.outbox.enqueue({ dedupKey: key + ':text', channel: 'feishu', target: 'owner', kind: 'text', content: { text: '全文' } }); await f.rt.sendOutbox();
    const options = { bin: f.bin, profile: 'test', timeoutMs: 3000 };
    const first = await sendLarkAudioMessage(options, 'owner', Buffer.from('test-ogg'), key + ':audio');
    expect(await sendLarkAudioMessage(options, 'owner', Buffer.from('test-ogg'), key + ':audio')).toEqual(first);
    const audio = (await f.calls()).filter(c => c.args.includes('--audio'));
    const keys = audio.map(c => c.args[c.args.indexOf('--idempotency-key') + 1]);
    expect(keys[0]).toBe(keys[1]); expect(keys[0]).not.toBe(calls[0].data.uuid); expect(keys[0].length).toBeLessThanOrEqual(50);
    expect((await readFile(f.state + '.sends.jsonl', 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});
