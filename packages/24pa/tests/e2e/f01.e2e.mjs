// F01 end-to-end: real dsh Loader and Host, real native sessions and child
// agents, real isolated PostgreSQL, real lark-cli subprocess (stubbed Feishu
// side), scripted model. Boundaries replaced per the tickets: model, external
// network, and nothing else.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv;

const writeConfig = async (patch = {}) => {
  const config = {
    version: 1,
    mode: 'feishu',
    larkProfile: 'default',
    ownerOpenId: 'ou_test_owner',
    folderToken: 'fld_test',
    tasklistId: 'tl_test',
    calendarId: 'primary',
    timeZone: 'Asia/Shanghai',
    appIdEnv: 'PA24_FEISHU_APP_ID',
    appSecretEnv: 'PA24_FEISHU_APP_SECRET',
    pgDsnEnv: 'PA24_PG_DSN',
    maxWorkers: 2,
    enabledWorkers: ['memo'],
    workerModels: {},
    ...patch,
  };
  await writeFile(
    join(workspace, 'AGENTS.md'),
    `# 24私助工作区\n\n固定接入会话接收委托，memo Worker 保存备忘。\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n`,
  );
};

const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text });
const waitDb = async (sql, expected, label) => {
  for (let i = 0; i < 120; i++) {
    if ((await cluster.query(sql)).trim() === expected) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待数据库状态超时（${label}）：${sql}`);
};

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-e2e-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeConfig();
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await writeFile(stubStatePath, JSON.stringify({ docs: [], calls: [], ownerOpenId: 'ou_test_owner' }));
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  await writeScript({
    mode: 'dispatch',
    delegate: { worker: 'memo', title: '记录合作方向', instruction: '记录：下周讨论新的合作方向' },
    leadReply: '已安排备忘整理，完成后回报。',
    workerAction: { action: 'memo_save', topic: '合作方向', content: '下周讨论新的合作方向', source: '主人飞书委托' },
    workerReply: '备忘已保存为飞书文档并回读确认。',
  });
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
  host = await bootHost({ env: bootEnv });
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F01 工作区助理与随手记（真实 Loader + 隔离 PG）', () => {
  it('P01：宿主启动，面板就绪状态区分配置/账本/接入', async () => {
    const snap = await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '插件就绪' },
    );
    const byId = Object.fromEntries(snap.readiness.items.map(i => [i.id, i]));
    expect(byId.host.state).toBe('ok');
    expect(byId.config.state).toBe('ok');
    expect(byId.workspace.state).toBe('ok');
    expect(snap.transport.connected).toBe(true);
    expect(snap.workspace.config.mode).toBe('feishu');
    expect(snap.workspace.accessSessionId).toMatch(/^pa24-/);
    expect(snap.workspace.localSessionId).toMatch(/^pa24-/);
  });

  it('P02：/24pa 状态回复经持久 Outbox 回执；重复事件、他人与错应用不处理', async () => {
    await inject(ownerEvent('evt-status-1', '/24pa'));
    await host.waitUntil(s => (s.outbox ?? []).some(o => o.dedup_key === 'status:evt-status-1' && o.status === 'sent'), { label: '状态回复发送' });
    const before = await host.api('snapshot');
    expect(before.outbox.find(o => o.dedup_key === 'status:evt-status-1').message_id).toMatch(/^fake-/);

    await inject(ownerEvent('evt-status-1', '/24pa'));
    await new Promise(r => setTimeout(r, 2000));
    const after = await host.api('snapshot');
    expect(after.outbox.filter(o => o.dedup_key === 'status:evt-status-1')).toHaveLength(1);

    await inject({ ...ownerEvent('evt-foreign-1', '/24pa'), senderOpenId: 'ou_someone_else' });
    await inject({ ...ownerEvent('evt-wrongapp-1', '/24pa'), appId: 'cli_other_app' });
    // 错租户：已按 (app, owner) 绑定租户后，其他租户的同主人事件被拒绝
    await inject({ ...ownerEvent('evt-wrongtenant-1', '/24pa'), tenantKey: 'tenant_intruder' });
    await waitDb(
      `select count(*) from pa24.inbox where event_id in ('evt-foreign-1','evt-wrongapp-1','evt-wrongtenant-1') and status='rejected'`,
      '3',
      '未绑定主体/错租户被拒绝',
    );
    const sentToOwner = (await host.api('snapshot')).outbox.filter(o => o.status === 'sent');
    expect(sentToOwner.some(o => o.dedup_key.startsWith('status:evt-foreign-1'))).toBe(false);
  });

  it('P03+P14：飞书委托经 Lead 委派 memo Worker，保存真实文档并回传出处', async () => {
    await inject(ownerEvent('evt-memo-1', '记一下：下周讨论新的合作方向'));
    const snap = await host.waitUntil(
      s => {
        const item = (s.work ?? []).find(w => w.role === 'memo');
        return (
          item &&
          item.status === 'completed' &&
          (s.outbox ?? []).some(o => o.dedup_key.startsWith(`workitem:${item.id}:result`) && o.status === 'sent')
        );
      },
      { timeoutMs: 180_000, label: '备忘事项完成并回传' },
    );
    const item = snap.work.find(w => w.role === 'memo');
    expect(item.origin).toBe('feishu');
    expect(item.parent_session_id).toBe(snap.workspace.accessSessionId);
    expect(item.result).toContain('备忘已保存');

    const docLines = (await readFile(`${stubStatePath}.docs.jsonl`, 'utf8')).split('\n').filter(Boolean);
    expect(docLines).toHaveLength(1);
    expect(JSON.parse(docLines[0]).content).toContain('下周讨论新的合作方向');

    expect((await cluster.query(`select count(*) from pa24.memo where topic='合作方向'`)).trim()).toBe('1');
    expect((await cluster.query(`select count(*) from pa24.action_operation where status='succeeded'`)).trim()).toBe('1');
    expect(snap.outbox.some(o => o.dedup_key.startsWith('reply:evt-memo-1'))).toBe(true);
    const resultRow = snap.outbox.find(o => o.dedup_key.startsWith(`workitem:${item.id}:result`));
    expect(JSON.stringify(resultRow.content)).toContain('docstub-1');
  });

  it('P03：本地24私助会话发起同一备忘流程，结果回到本地会话且不进飞书', async () => {
    const snapBefore = await host.api('snapshot');
    const feishuSentBefore = snapBefore.outbox.filter(o => o.status === 'sent').length;
    await host.remote('session/prompt', {
      request: {
        requestId: 'local-test-memo-1',
        sessionId: snapBefore.workspace.localSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '记一下：本地会话发起的备忘（e2e）' }],
        clientTimeZone: 'Asia/Shanghai',
      },
    });
    const snap = await host.waitUntil(
      s => {
        const items = (s.work ?? []).filter(w => w.role === 'memo' && w.origin === 'local');
        const latest = items[0];
        return latest && latest.status === 'completed';
      },
      { timeoutMs: 180_000, label: '本地备忘事项完成' },
    );
    const localItem = snap.work.find(w => w.origin === 'local' && w.role === 'memo');
    expect(localItem.delivery).toBe(`local:${snap.workspace.localSessionId}`);
    // 本地结果不进飞书 Outbox
    expect(snap.outbox.some(o => o.dedup_key === `workitem:${localItem.id}:result`)).toBe(false);
    expect(snap.outbox.filter(o => o.status === 'sent').length).toBe(feishuSentBefore);
    // 事项回传进入本地父会话（模型收到带 [事项回传] 的消息并答复）
    const delivered = llm.log.filter(r => r.lastUserText.includes('[事项回传]')).length;
    expect(delivered).toBeGreaterThan(0);
  });

  it('P14：memo_find 经真实工具执行，找回带出处的备忘', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'memo', title: '找回合作方向备忘', instruction: '找回合作方向相关备忘并给出出处' },
      leadReply: '已安排查找。',
      workerAction: { action: 'memo_find', query: '合作' },
      workerReply: '已找到 1 条合作方向备忘。',
    });
    await inject(ownerEvent('evt-find-1', '查一下合作方向的备忘'));
    const snap = await host.waitUntil(
      s => {
        const items = (s.work ?? []).filter(w => w.role === 'memo' && w.title === '找回合作方向备忘');
        return items[0] && items[0].status === 'completed';
      },
      { timeoutMs: 180_000, label: '查找事项完成' },
    );
    const workerWithResult = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
    expect(workerWithResult).toBeTruthy();
    expect(workerWithResult.toolResults.join('')).toContain('docstub-1');
  });

  it('P41：接入检查只读返回身份与资源；坏配置保留最近有效值，修复后重载生效', async () => {
    const check = await host.api('action', { type: 'connection.check' });
    expect(check.cli.state).toBe('ok');
    expect(check.auth.state).toBe('ok');
    expect(check.auth.matched).toBe(true);
    expect(check.resources.every(r => ['ok', 'missing'].includes(r.state))).toBe(true);

    await writeFile(join(workspace, 'AGENTS.md'), '# broken\n\n```json\n{"version":1,"unknown":2}\n```\n');
    await expect(host.api('action', { type: 'workspace.reload' })).rejects.toThrow();
    const kept = await host.api('snapshot');
    expect(kept.workspace.config.ownerOpenId).toBe('ou_test_owner');
    expect(kept.workspace.configError).toBeTruthy();

    await writeConfig({ timeZone: 'Asia/Tokyo' });
    await host.api('action', { type: 'workspace.reload' });
    const reloaded = await host.api('snapshot');
    expect(reloaded.workspace.config.timeZone).toBe('Asia/Tokyo');
    expect(reloaded.workspace.configError).toBeNull();
  });

  it('P02：提交后重启，工作区/会话/账本从持久状态恢复，重复事件不重投', async () => {
    const before = await host.api('snapshot');
    const hostRoot = host.root;
    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '重启后插件就绪' },
    );
    const after = await host.api('snapshot');
    expect(after.workspace.path).toBe(before.workspace.path);
    expect(after.workspace.accessSessionId).toBe(before.workspace.accessSessionId);
    expect(after.workspace.localSessionId).toBe(before.workspace.localSessionId);

    // 平台重投已入库事件：仅按 event_id 去重，不重复处理或发送。
    await inject(ownerEvent('evt-status-1', '/24pa'));
    await new Promise(r => setTimeout(r, 2500));
    const snap = await host.api('snapshot');
    expect(snap.outbox.filter(o => o.dedup_key === 'status:evt-status-1')).toHaveLength(1);
    // 历史事项与备忘仍从账本可见。
    expect((snap.work ?? []).length).toBeGreaterThan(0);
    const memos = await host.api('memo', { query: '合作' });
    expect(memos.memos.length).toBeGreaterThan(0);
  });
});
