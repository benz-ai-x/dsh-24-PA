// F02 end-to-end: parallel work items, reply routing, restart recovery, JSON
// memory maintenance with changesets, and role registration. Same boundaries
// as F01: real Loader/Host/sessions, isolated PostgreSQL, stubbed Feishu side,
// scripted model.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, hostRoot;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const writeConfig = async (patch = {}) => {
  await writeFile(
    join(workspace, 'AGENTS.md'),
    `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify({
      version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
      folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
      appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
      maxWorkers: 5, enabledWorkers: ['memo'], workerModels: {}, ...patch,
    }, null, 2)}\n\`\`\`\n`,
  );
};
const readDocs = async () => {
  try {
    const lines = (await readFile(`${stubStatePath}.docs.jsonl`, 'utf8')).split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l));
  } catch {
    return [];
  }
};
const waitMemoryRevision = async (expected, label) => {
  for (let i = 0; i < 60; i++) {
    const memory = await host.api('memory', {});
    if (memory.revision === expected) return memory;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待记忆 revision=${expected} 超时（${label}）；当前：${JSON.stringify(await host.api('memory', {})).slice(0, 400)}`);
};
const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text, extra = {}) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text, ...extra });
const waitDb = async (sql, expected, label) => {
  for (let i = 0; i < 120; i++) {
    if ((await cluster.query(sql)).trim() === expected) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待数据库状态超时（${label}）：${sql}`);
};
const promptLocal = (requestId, text) =>
  host.remote('session/prompt', {
    request: {
      requestId,
      sessionId: localSessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: 'Asia/Shanghai',
    },
  });
let localSessionId;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f02-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await writeFile(stubStatePath, JSON.stringify({ docs: [], calls: [], ownerOpenId: 'ou_test_owner' }));
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  bootEnv = {
    PA24_WORKSPACE: workspace,
    PA24_PG_DSN: cluster.dsn,
    PA24_FEISHU_APP_ID: 'cli_test_app',
    PA24_FEISHU_APP_SECRET: 'test_secret',
    PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url,
    DEEPSEEK_API_KEY: 'test-key',
    PA24_LARK_STUB_STATE: stubStatePath,
    PATH: `${binDir}:${process.env.PATH}`,
  };
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F02 并行事项与记忆维护（真实 Loader + 隔离 PG）', () => {
  it('P04：一段话拆五项备忘，五路 Worker 并行完成并分别回传', async () => {
    await writeConfig();
    await writeScript({
      mode: 'dispatch',
      delegate: [1, 2, 3, 4, 5].map(n => ({ worker: 'memo', title: `备忘${n}`, instruction: `记录：并行事项 ${n} 的内容` })),
      leadReply: '已接纳五件备忘，正在并行处理，完成后逐项回报。',
      workerAction: { action: 'memo_save', topic: '并行事项', content: '并行事项的内容与来源', source: '主人飞书委托' },
      workerReply: '备忘已保存并回读确认。',
    });
    host = await bootHost({ env: bootEnv });
    hostRoot = host.root;
    const snap0 = await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '插件就绪' },
    );
    localSessionId = snap0.workspace.localSessionId;

    await inject(ownerEvent('evt-parallel-1', '帮我记五件事：并行事项 1 到 5'));
    const snap = await host.waitUntil(
      s => {
        const items = (s.work ?? []).filter(w => w.title.startsWith('备忘'));
        const sent = (s.outbox ?? []).filter(o => o.dedup_key.includes(':result:t') && o.status === 'sent');
        return items.length === 5 && items.every(w => w.status === 'completed') && sent.length >= 5;
      },
      { timeoutMs: 180_000, label: '五项并行完成并回传' },
    );
    expect(snap.work.filter(w => w.origin === 'feishu')).toHaveLength(5);
    const docs = await readDocs();
    expect(docs).toHaveLength(5);
    expect((await cluster.query(`select count(*) from pa24.memo`)).trim()).toBe('5');
    const results = snap.outbox.filter(o => o.dedup_key.includes(':result:t') && o.status === 'sent');
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.every(r => r.message_id?.startsWith('fake-'))).toBe(true);
  });

  it('P05：回复旧结果消息固定路由到原事项续办；未知引用明确拒绝', async () => {
    const snap = await host.api('snapshot');
    const item = snap.work.find(w => w.title === '备忘1');
    const resultRow = snap.outbox.find(o => o.dedup_key.startsWith(`workitem:${item.id}:result`) && o.status === 'sent');
    expect(resultRow.message_id).toMatch(/^fake-/);
    const before = (await host.api('snapshot')).work.length;

    await inject(ownerEvent('evt-followup-1', '补充：这条备忘再加上日期标注', { parentMessageId: resultRow.message_id }));
    await host.waitUntil(
      s => {
        const it = (s.work ?? []).find(w => w.id === item.id);
        return it && it.status === 'completed' && (s.outbox ?? []).some(o => o.dedup_key.startsWith(`workitem:${item.id}:result:t`) && o.id !== resultRow.id && o.status === 'sent');
      },
      { timeoutMs: 180_000, label: '引用续办完成并再次回传' },
    );
    // 其他事项不被中断
    const after = await host.api('snapshot');
    expect(after.work.length).toBe(before);
    expect(after.work.filter(w => w.title.startsWith('备忘') && w.status === 'completed')).toHaveLength(5);

    await inject(ownerEvent('evt-unknownref-1', '继续这件事', { parentMessageId: 'om_nonexistent' }));
    await host.waitUntil(s => (s.outbox ?? []).some(o => o.dedup_key === 'route-unknown:evt-unknownref-1' && o.status === 'sent'), { label: '未知引用回复' });
    expect((await host.api('snapshot')).work.length).toBe(before);
  });

  it('P42/P36/P43：本地会话维护 JSON 记忆，冲突拒绝、变更集应用与撤销、越权写入被拒', async () => {
    // 新增两条（第二条与第一条重复，供整理去重演示）
    await writeScript({
      mode: 'dispatch',
      leadReply: '已按你的指示记住/整理。',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'm-meeting', category: 'preference', topic: '会议', content: '会议之间留 15 分钟缓冲', source: '本人指示', status: 'confirmed', reason: '本人明确偏好', expectedRevision: 0 } },
    });
    await promptLocal('f02-mem-1', '记住：会议之间留 15 分钟缓冲');
    let memory = await waitMemoryRevision(1, '首次写入');
    memory = await host.api('memory', { query: '15 分钟' });
    expect(memory.revision).toBe(1);
    expect(memory.matched).toBe(1);
    expect(memory.records[0].id).toBe('m-meeting');

    // 过时 revision 拒绝
    await writeScript({
      mode: 'dispatch',
      leadReply: '已记住。',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'm-meeting', category: 'preference', topic: '会议', content: '会议之间留 20 分钟缓冲', source: '本人指示', status: 'confirmed', reason: '更正', expectedRevision: 0 } },
    });
    await promptLocal('f02-mem-2', '更正：留 20 分钟');
    for (let i = 0; i < 40; i++) {
      const last = llm.log.filter(r => r.tools.includes('pa24_memory') && r.toolResults.length > 0).at(-1);
      if (last && last.toolResults.join('').includes('重新查询')) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const conflict = llm.log.filter(r => r.tools.includes('pa24_memory') && r.toolResults.length > 0).at(-1);
    expect(conflict.toolResults.join('')).toContain('重新查询');
    memory = await host.api('memory', {});
    expect(memory.records[0].content).toContain('15 分钟');

    // 制造重复 → 整理变更集去重 → 撤销
    await writeScript({
      mode: 'dispatch',
      leadReply: '已记住重复条目，准备整理。',
      leadTool: { name: 'pa24_memory', input: { action: 'put', id: 'm-meeting-dup', category: 'preference', topic: '会议', content: '会议之间留 15 分钟缓冲', source: '本人指示', status: 'confirmed', reason: '重复记录', expectedRevision: 1 } },
    });
    await promptLocal('f02-mem-3', '再记一遍同一条');
    await waitMemoryRevision(2, '写入重复条目');
    await writeScript({
      mode: 'dispatch',
      leadReply: '整理完成。',
      leadTool: { name: 'pa24_memory', input: { action: 'apply', expectedRevision: 2, reason: '去重会议偏好', changes: [{ op: 'delete', id: 'm-meeting-dup', reason: '与 m-meeting 重复' }] } },
    });
    await promptLocal('f02-mem-4', '整理会议主题的记忆，删除重复项');
    await waitMemoryRevision(3, '应用变更集');
    memory = await host.api('memory', {});
    expect(memory.revision).toBe(3);
    expect(memory.matched).toBe(1);
    await writeScript({
      mode: 'dispatch',
      leadReply: '已撤销。',
      leadTool: { name: 'pa24_memory', input: { action: 'undo', changesetId: 'CS-3', expectedRevision: 3, reason: '整理有误，恢复原状' } },
    });
    await promptLocal('f02-mem-5', '撤销刚才的整理');
    await waitMemoryRevision(4, '撤销变更集');
    memory = await host.api('memory', {});
    expect(memory.revision).toBe(4);
    expect(memory.matched).toBe(2);

    // Worker 只有只读检索；写入在执行入口被拒
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'memo', title: '检索会议偏好', instruction: '检索会议偏好记忆' },
      leadReply: '已安排检索。',
      workerTool: { name: 'pa24_memory', input: { action: 'put', id: 'm-evil', category: 'fact', topic: '越权', content: 'worker 不该写', source: 'worker', status: 'confirmed', reason: '越权尝试', expectedRevision: 4 } },
      workerReply: '写入被拒绝。',
    });
    await inject(ownerEvent('evt-memsearch-1', '查一下会议偏好的记忆'));
    for (let i = 0; i < 60; i++) {
      const attempt = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
      if (attempt && attempt.toolResults.join('').includes('仅限')) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const denied = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
    expect(denied.toolResults.join('')).toContain('仅限');
    expect((await host.api('memory', { query: '越权' })).matched).toBe(0);
  });

  it('P07：重启后恢复未完成事项（恢复代次）、processing 收件重派、停止事项不复活', async () => {
    // 通过真实流程建一个进行中事项：让 worker 第一轮只回复文字（不完成业务），事项即 completed —— 不合用。
    // 直接在账本种入运行中/已停止事项与 processing 收件行，模拟崩溃现场。
    await cluster.query(`insert into pa24.work_item (id, title, role, instruction, origin, parent_session_id, child_session_id, delivery, status, recovery_gen)
      values ('wip-crash-1', '崩溃前运行中', 'memo', '...', 'feishu', '${(await host.api('snapshot')).workspace.accessSessionId}', 'wip-crash-1', 'feishu:ou_test_owner', 'running', 0)`);
    await cluster.query(`insert into pa24.work_item (id, title, role, instruction, origin, parent_session_id, delivery, status)
      values ('wip-stopped-1', '本人已停止', 'memo', '...', 'feishu', 'x', 'feishu:ou_test_owner', 'stopped')`);
    await cluster.query(`insert into pa24.inbox (event_id, source, kind, payload, status) values ('evt-crash-1', 'feishu', 'message', '{}', 'processing')`);

    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true, { label: '重启就绪' });

    await waitDb(`select recovery_gen from pa24.work_item where id='wip-crash-1'`, '1', '恢复代次递增');
    const progress = await cluster.query(`select progress from pa24.work_item where id='wip-crash-1'`);
    expect(progress).toContain('重启恢复');
    // 重派后可能已被派发器处理（该种子行无正文 → rejected 空消息）；断言它不再卡在 processing
    for (let i = 0; i < 120; i++) {
      const status = (await cluster.query(`select status from pa24.inbox where event_id='evt-crash-1'`)).trim();
      if (status !== 'processing') break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect((await cluster.query(`select status from pa24.inbox where event_id='evt-crash-1'`)).trim()).not.toBe('processing');
    const stopped = await cluster.query(`select status from pa24.work_item where id='wip-stopped-1'`);
    expect(stopped.trim()).toBe('stopped');
    await cluster.query(`delete from pa24.work_item where id in ('wip-crash-1','wip-stopped-1')`);
    await cluster.query(`delete from pa24.inbox where event_id='evt-crash-1'`);
  });

  it('P44：注册「资料摘要」职责并沿用统一委派边界', async () => {
    const registered = await host.api('action', {
      type: 'role.register',
      definition: {
        id: 'digest',
        name: '资料摘要',
        persona: '你是 24私助的资料摘要 Worker，把收到的资料整理为带来源的摘要并入库，不执行其他业务。',
        brief: '汇总资料并保存摘要。',
        available: true,
        actionNames: ['digest_summarize'],
      },
    });
    expect(registered.roles.find(r => r.id === 'digest')?.available).toBe(true);
    await writeConfig({ enabledWorkers: ['memo', 'digest'] });
    await host.api('action', { type: 'workspace.reload' });

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'digest', title: '摘要季度资料', instruction: '把这份季度资料整理为摘要' },
      leadReply: '已安排资料摘要。',
      workerAction: { action: 'digest_summarize', topic: '季度资料', content: '第一季度完成三项交付，客户满意度上升。', source: '主人提供的资料' },
      workerReply: '摘要已保存。',
    });
    await inject(ownerEvent('evt-digest-1', '帮我摘要这份季度资料'));
    const snap = await host.waitUntil(
      s => {
        const item = (s.work ?? []).find(w => w.role === 'digest');
        return (
          item &&
          item.status === 'completed' &&
          (s.outbox ?? []).some(o => o.dedup_key.startsWith(`workitem:${item.id}:result`) && o.status === 'sent')
        );
      },
      { timeoutMs: 180_000, label: '摘要事项完成并回传' },
    );
    const item = snap.work.find(w => w.role === 'digest');
    expect(item.origin).toBe('feishu');
    expect((await cluster.query(`select count(*) from pa24.memo where topic='季度资料'`)).trim()).toBe('1');

    // 无效注册被拒绝；重复注册被拒绝且保留既有注册
    await expect(
      host.api('action', { type: 'role.register', definition: { id: 'BAD ID', name: 'x', persona: '短', brief: 'x', available: true } }),
    ).rejects.toThrow();
    await expect(
      host.api('action', { type: 'role.register', definition: { id: 'digest', name: '重复', persona: '这是重复注册应当被拒绝的定义内容', brief: 'x', available: true } }),
    ).rejects.toThrow(/已注册/);
    let roles = await host.api('roles');
    expect(roles.roles.find(r => r.id === 'digest')?.name).toBe('资料摘要');

    // 注册持久化：重启后角色与动作仍在，可继续委派（P44 重启可续办）
    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(s2 => (s2.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s2.workspace && s2.transport?.connected === true, { label: '重启就绪' });
    roles = await host.api('roles');
    expect(roles.roles.find(r => r.id === 'digest')?.available).toBe(true);
  });
});
