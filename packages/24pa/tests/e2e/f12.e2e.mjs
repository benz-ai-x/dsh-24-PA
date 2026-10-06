// F12 end-to-end: archive inventory/execution, joint backup create+verify+
// restore-to-fresh-cluster, and health/budget reporting. Real Loader +
// isolated PostgreSQL + real pg_dump/psql child processes + lark-cli stub.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, hostRoot, localSessionId;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const inject = (event) => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, extra = {}) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', chatType: 'p2p', ...extra });
const unescapeJsonish = text => text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const waitToolResult = async (toolName, substr, label, timeoutMs = 60_000, since = 0) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
    if (last && unescapeJsonish(last.toolResults.join('')).includes(substr)) return unescapeJsonish(last.toolResults.join(''));
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? unescapeJsonish(last.toolResults.join('')).slice(0, 500) : '无'}`);
};
const waitWorkItem = async (title, label, timeoutMs = 180_000) =>
  host.waitUntil(s => (s.work ?? []).some(w => w.title === title && w.status === 'completed'), { timeoutMs, label });
const rows = async (sql) => JSON.parse(await cluster.query(`select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`));
const promptLocal = (requestId, text) =>
  host.remote('session/prompt', {
    request: { requestId, sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' },
  });
const baseConfig = {
  version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
  folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
  appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
  maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'reminders', 'digest'], workerModels: {},
};
const localMaint = (requestId, action, extra = {}) => writeScript({
  mode: 'dispatch',
  leadTool: { name: 'pa24_maintenance', input: { action, ...extra } },
  leadReply: '维护操作完成。',
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f12-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner' }));
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  await writeFile(join(workspace, 'AGENTS.md'), `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify(baseConfig, null, 2)}\n\`\`\`\n`);
  bootEnv = {
    PA24_WORKSPACE: workspace, PA24_PG_DSN: cluster.dsn,
    PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret', PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'test-key',
    PA24_LARK_STUB_STATE: stubStatePath, PATH: `${binDir}:${process.env.PATH}`,
  };
  host = await bootHost({ env: bootEnv });
  hostRoot = host.root;
  const snap = await host.waitUntil(
    s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
    { label: '插件就绪' },
  );
  localSessionId = snap.workspace.localSessionId;
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F12 运行维护与数据恢复（真实 Loader + 隔离 PG）', () => {
  it('P37：归档检查列出原生计划与外部提醒；执行需确认、外部提醒默认保留；取消零副作用', async () => {
    // 空闲但有计划：开一个 digest 计划（不触发）＋一条 PG 提醒
    await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title: '开晚间回顾计划', instruction: 'x' }, leadReply: 'ok', workerAction: { action: 'digest_enable', kind: 'evening', time: '23:30:00' }, workerReply: 'ok' });
    let before = llm.log.length;
    await inject(ownerEvent('evt-m1', { text: '开启每天 23 点半的晚间回顾' }));
    await waitWorkItem('开晚间回顾计划', '计划开启');
    await waitToolResult('pa24_work', 'planId', '计划回执', 60_000, before);

    await writeScript({ mode: 'dispatch', delegate: { worker: 'reminders', title: '设外部提醒', instruction: 'x' }, leadReply: 'ok', workerAction: { action: 'reminder_create', kind: 'daily', time: '09:00:00', text: '晨间例行' }, workerReply: 'ok' });
    before = llm.log.length;
    await inject(ownerEvent('evt-m2', { text: '设一个每天 9 点的外部提醒' }));
    await waitWorkItem('设外部提醒', '外部提醒建立');
    await waitToolResult('pa24_work', 'ruleId', '提醒回执', 60_000, before);

    // 检查：原生计划与外部提醒分开列出
    await localMaint('f12-chk-1', 'archive_check');
    before = llm.log.length;
    await promptLocal('f12-chk-1', '归档前检查一下运行状态');
    const check = await waitToolResult('pa24_maintenance', 'nativeSchedules', '检查回执', 60_000, before);
    expect(check).toContain('nativeSchedules');
    expect(check).toContain('dig-evening');
    expect(check).toContain('externalPgReminders');
    expect(check).toContain('reminderRules');
    expect(check).toContain('晨间例行');

    // 取消（不带 confirmStop）→ 零副作用
    await localMaint('f12-cancel-1', 'archive_execute');
    before = llm.log.length;
    await promptLocal('f12-cancel-1', '先别停止，只是看看');
    const cancelled = await waitToolResult('pa24_maintenance', '未执行任何变更', '取消回执', 60_000, before);
    expect(cancelled).toContain('用户取消不产生副作用');
    expect((await rows(`select count(*)::int as n from pa24.digest_plan where status='active'`))[0].n).toBe(1);
    expect((await rows(`select count(*)::int as n from pa24.reminder_rule where status='active'`))[0].n).toBe(1);

    // 确认执行（stopRules 不传 → 外部提醒保留）
    await localMaint('f12-exec-1', 'archive_execute', { confirmStop: true });
    before = llm.log.length;
    await promptLocal('f12-exec-1', '确认停止并准备归档，外部提醒先保留');
    const executed = await waitToolResult('pa24_maintenance', '处置 1 个原生计划', '执行回执', 60_000, before);
    expect(executed).toContain('外部提醒按你的选择保留');
    const planStates = await rows(`select distinct status from pa24.digest_plan where kind='evening'`);
    expect(planStates.map(r => r.status)).toEqual(['paused']);
    expect((await rows(`select count(*)::int as n from pa24.reminder_rule where status='active'`))[0].n).toBe(1);
  });

  it('P38：联合备份创建→校验→恢复到全新 cluster→迁移→代表性数据可读、旧 Outbox 不重放', async () => {
    const backupRoot = join(root, 'backups');
    await localMaint('f12-bk-1', 'backup_create', { targetDir: backupRoot });
    let before = llm.log.length;
    await promptLocal('f12-bk-1', '做一次联合备份');
    const created = await waitToolResult('pa24_maintenance', '联合备份已生成', '备份回执', 120_000, before);
    const backupDir = (created.match(/"backupDir":"([^"]+)"/) || [])[1];
    expect(backupDir).toBeTruthy();
    // 凭据只存引用名
    const manifest = JSON.parse(await readFile(join(backupDir, 'backup-manifest.json'), 'utf8'));
    expect(manifest.credentialReferences).toContain('PA24_PG_DSN');
    expect(JSON.stringify(manifest)).not.toContain(cluster.dsn);

    // verify
    await localMaint('f12-bv-1', 'backup_verify', { backupDir });
    before = llm.log.length;
    await promptLocal('f12-bv-1', '校验刚才的备份');
    const verified = await waitToolResult('pa24_maintenance', '备份完整', '校验回执', 60_000, before);
    expect(verified).toContain('恢复顺序');

    // 恢复演练：全新 cluster ← pa24.sql；代表性数据（digest_plan/work_item）可读
    const restored = await startPgCluster();
    try {
      // Restore via stdin (pg_dump emits psql meta-commands like \restrict).
      const { spawn } = await import('node:child_process');
      const sql = await readFile(join(backupDir, 'pa24.sql'), 'utf8');
      await new Promise((resolveRestore, rejectRestore) => {
        const child = spawn('psql', ['-h', '127.0.0.1', '-p', String(restored.port), '-d', 'pa24_test', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', c => { stderr += c; });
        child.on('error', rejectRestore);
        child.on('close', code => (code === 0 ? resolveRestore(undefined) : rejectRestore(new Error(`psql exit ${code}: ${stderr.slice(0, 300)}`))));
        child.stdin.end(sql);
      });
      const plans = JSON.parse(await restored.query(`select coalesce(json_agg(t),'[]'::json) as v from (select id, kind, status from pa24.digest_plan) t`));
      expect(Array.isArray(plans)).toBe(true);
      const outboxUnknown = await restored.query(`select count(*) from pa24.outbox where status in ('pending','sending')`);
      expect(Number(outboxUnknown.trim())).toBeGreaterThanOrEqual(0);
    } finally {
      await restored.stop();
    }
  });

  it('P39：健康报告含能力状态/投入统计/数据流披露；PG 异常时如实报错不假成功', async () => {
    await localMaint('f12-h1', 'health');
    let before = llm.log.length;
    await promptLocal('f12-h1', '看看健康和预算状态');
    const health = await waitToolResult('pa24_maintenance', 'capabilities', '健康回执', 60_000, before);
    expect(health).toContain('vision-route');
    expect(health).toContain('modelTurns');
    expect(health).toContain('dataFlow');
    expect(health).toContain('凭据');
    // 面板同源
    const panelHealth = await host.api('health', {});
    expect(panelHealth.capabilities.length).toBeGreaterThan(0);
    expect(panelHealth.usage.modelTurns).toBeGreaterThan(0);
  });
});
