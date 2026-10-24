import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { startPgCluster } from '../helpers/pg.mjs';
import { parseMemoryFile } from '../../lib/memory.js';
let root, workspace, cluster, llm, host, scriptPath, bootEnv, localId, accessId, binding, created;
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const decode = value => {
  if (typeof value === 'string') { try { return decode(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(decode).find(value => value && typeof value === 'object' && !Array.isArray(value)) ?? value;
  if (value?.type === 'text') return decode(value.text);
  return value;
};
async function tool(name, input, sessionId = localId) {
  const start = llm.log.length;
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', leadTool: { name, input }, leadReply: '已返回实际工具结果。' }));
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: '主人明确发起本地维护：' + JSON.stringify(input) }], clientTimeZone: 'Asia/Shanghai' } });
  for (let index = 0; index < 2400; index++) {
    const requests = llm.log.slice(start);
    if (requests.length >= 2) { const result = requests.at(-1).toolResults?.at(-1); if (result) return decode(result); }
    await pause();
  }
  throw Error('等待真实 Session 维护工具回执超时');
}
const maintenance = input => tool('pa24_maintenance', input);
const memory = input => tool('pa24_memory', input);
const put = (id, revision, content = '需要保护的旧正文') => ({ action: 'put', id, category: 'fact', topic: id, content, source: '本地主人', status: 'unverified', expectedRevision: revision, reason: '主人维护' });
async function prepareMaterials() {
  // A real decoded 16×16 PNG, collected and published via the normal native
  // Worker route. The isolated restore must read the resulting attachment too.
  const imageData = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGElEQVQokWMQ0QggCTGMatAYDSWR4Zo0ADOajAEFXVfqAAAAAElFTkSuQmCC';
  const ownerEvent = (eventId, extra) => ({ eventId, messageId: eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', chatType: 'p2p', ...extra });
  await host.api('action', { type: 'test.inject', event: ownerEvent('m09-page', { messageType: 'image', imageKey: 'm09-image', imageData }) });
  const acknowledged = await host.waitUntil(row => row.outbox?.some(item => item.dedup_key.startsWith('noteack:N-1:p1:') && item.status === 'sent'));
  const ack = acknowledged.outbox.find(item => item.dedup_key.startsWith('noteack:N-1:p1:'));
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch',
    delegate: { worker: 'handwriting', title: 'M09 联合资料', instruction: '整理笔记 N-1 并发布待审版本', noteId: 'N-1' }, leadReply: '已交办。',
    workerAction: { action: 'note_submit', noteId: 'N-1', transcript: '原稿一：预算初稿。', summary: '恢复核验资料', suggestions: [], unknowns: ['预算数字待核'], candidates: [], relativeDates: [],
      doubts: [{ pageNo: 1, kind: 'number', quote: '预算数字', note: '待主人复核', region: { x: 0, y: 0, w: 0.5, h: 0.5 } }] }, workerReply: '已形成待审版本。' }));
  await host.api('action', { type: 'test.inject', event: ownerEvent('m09-recognize', { text: '整理这份笔记', parentMessageId: ack.message_id }) });
  await host.waitUntil(row => row.work?.some(item => item.title === 'M09 联合资料' && item.status === 'completed'), { timeoutMs: 90_000 });
  await host.waitUntil(row => row.outbox?.some(item => item.dedup_key.startsWith('notereview:N-1:v1') && item.status === 'sent'));
  expect(llm.log.some(row => row.tools.includes('pa24_work') && row.images > 0)).toBe(true);
  expect((await readdir(join(workspace, '.24pa/crops/N-1'))).filter(name => name.endsWith('.png'))).toHaveLength(1);
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'Skill 实际运行结果。' }] }));
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'manticore-m09-loader-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  cluster = storage === 'postgres' ? await startPgCluster() : null;
  scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'Skill 实际运行结果。' }] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json') });
  await writeFile(join(workspace, 'AGENTS.md'), '# 24私助 M09 隔离工作区\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'fld_test', tasklistId: 'tasklist-test', enabledWorkers: ['memo', 'handwriting', 'skill', 'reminders', 'digest'], workerModels: { handwriting: { provider: 'deepseek-official', model: 'deepseek-flash' } } }, null, 2) + '\n```\n');
  const bin = join(root, 'bin'); await mkdir(bin);
  const stub = fileURLToPath(new URL('../helpers/stub-lark-cli.mjs', import.meta.url));
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  await writeFile(join(bin, 'lark-cli'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(stub)} "$@"\n`); await chmod(join(bin, 'lark-cli'), 0o755);
  const stubState = join(root, 'lark.json'); await writeFile(stubState, JSON.stringify({ ownerOpenId: 'ou_test_owner' }));
  bootEnv = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'test-key', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret', PA24_LARK_STUB_STATE: stubState, PATH: `${bin}:${process.env.PATH}`, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env: bootEnv });
  const snapshot = await host.waitUntil(row => Boolean(row.workspace?.localSessionId && row.workspaceBinding));
  localId = snapshot.workspace.localSessionId; accessId = snapshot.workspace.accessSessionId; binding = snapshot.workspaceBinding;
}, 600_000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

it('真实 Loader / Session：联合备份、校验、隔离恢复保护及重启档案', async () => {
  await prepareMaterials();
  const markdown = content => '---\n' + JSON.stringify({ name: 'backup-proof', description: '联合恢复验证', metadata: { track: 'agent', tools: [], pa24: { schemaVersion: 1, mode: 'local', parameters: {}, expectedResult: '说明结果', completionCriteria: '返回实际结果' } } }) + '\n---\n\n' + content;
  const change = payload => host.api('action', { type: 'skill.change', workspaceBinding: binding, requestId: randomUUID(), ...payload });
  const draft = await change({ op: 'save', displayName: '备份核验 Skill', markdown: markdown('版本一指令') });
  const id = 'managed:' + draft.entry.id;
  const published = await change({ op: 'publish', id, expectedRevision: draft.entry.revision, confirm: true });
  const runArgs = { id, versionId: draft.entry.draft_version, parameters: {}, workspaceBinding: binding };
  const preview = await host.api('skills.preview', runArgs);
  const run = await host.api('action', { type: 'skill.run', ...runArgs, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true });
  for (let index = 0; index < 600; index++) { const detail = await host.api('skills.run', { runId: run.run.id, workspaceBinding: binding }); if (detail.run.status === 'completed') break; await pause(); }
  expect((await host.api('skills.run', { runId: run.run.id, workspaceBinding: binding })).run.status).toBe('completed');
  await change({ op: 'save', id, expectedRevision: published.entry.revision, markdown: markdown('版本二指令') });
  expect(await memory(put('remove-me', 0))).toMatchObject({ revision: 1 });
  expect(await memory(put('keep-me', 1))).toMatchObject({ revision: 2 });
  // Exercise the integrated data owners through their public entry points.
  const material = await host.api('materials', { workspaceBinding: binding, kind: 'detail', noteId: 'N-1' });
  await host.api('action', { type: 'material.change', workspaceBinding: binding, noteId: 'N-1', action: 'save_draft', requestId: randomUUID(), instruction: '主人保存修订草稿', expectedRevision: material.material.revision, draft: { ...material.material.draft, summary: '新版草稿保留，待审版本不改写' } });
  await host.api('action', { type: 'material.change', workspaceBinding: binding, noteId: 'N-1', action: 'publish_draft', requestId: randomUUID(), instruction: '主人提交新版审核', expectedRevision: material.material.revision + 1 });
  await host.api('action', { type: 'health.check', workspaceBinding: binding, scopes: ['memory', 'skills', 'plans', 'backup'] });
  const plan = (await host.api('action', { type: 'plan.change', op: 'save', requestId: randomUUID(), workspaceBinding: binding, title: '恢复后的计划须先核对', skillId: 'builtin:digest-morning', timing: { type: 'once', at: new Date(Date.now() + 86400000).toISOString() }, delivery: { channel: 'none' } })).plan;
  const planPreview = await host.api('plans.preview', { id: plan.id, workspaceBinding: binding });
  await host.api('action', { type: 'plan.change', op: 'enable', id: plan.id, expectedRevision: plan.revision, workspaceBinding: binding, requestId: randomUUID(), confirm: true, fingerprint: planPreview.fingerprint });
  const templatePreview = await host.api('plans.run-preview', { id: plan.id, workspaceBinding: binding });
  const template = (await host.api('action', { type: 'plan.change', op: 'run', id: plan.id, workspaceBinding: binding, requestId: randomUUID(), confirm: true, fingerprint: templatePreview.fingerprint })).run;
  const until = async (runId, status) => { for (let index = 0; index < 600; index++) { const value = await host.api('skills.run', { runId, workspaceBinding: binding }); if (value.run.status === status) return value; await pause(); } throw Error('运行状态未到达：' + status); };
  await until(template.id, 'completed');
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { budget: { ...DEFAULT_CONFIG.budget, maxRequests: 0 } } });
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '一次预算放行的结果' }] }));
  const launch = async () => { const preview = await host.api('skills.preview', runArgs); return (await host.api('action', { type: 'skill.run', ...runArgs, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true })).run; };
  const released = await launch(); await until(released.id, 'waiting');
  await host.api('action', { type: 'budget.release', workspaceBinding: binding, requestId: randomUUID(), confirm: true, scope: 'next-model-request', runId: released.id, workId: released.work_item_id, sessionId: released.session_id });
  await until(released.id, 'completed');
  const waiting = await launch(); await until(waiting.id, 'waiting');
  await writeFile(join(workspace, '.24pa/secrets.json'), '{"appSecret":"exclude-test-secret"}');
  const command = { action: 'backup_create', requestId: 'loader-backup-one', targetDir: join(root, 'backups') };
  created = await maintenance(command);
  expect(created.record, JSON.stringify(created)).toMatchObject({ operation: 'create', status: 'succeeded' });
  expect((await maintenance(command)).record.id).toBe(created.record.id);
  expect(await readdir(join(root, 'backups'))).toHaveLength(1);
  await expect(readFile(join(created.backupDir, 'workspace/.24pa/secrets.json'))).rejects.toThrow();
  const verified = await maintenance({ action: 'backup_verify', requestId: 'loader-verify-one', backupDir: created.backupDir });
  expect(verified.complete, JSON.stringify(verified)).toBe(true);
  expect(verified.steps.find(step => step.id === 'skills').evidence).toMatchObject({ versions: 2, runs: 4 });
  expect(verified.steps.find(step => step.id === 'materials').evidence).toMatchObject({ originals: 1, versions: 2 });
  expect(verified.steps.find(step => step.id === 'sessions').evidence.checked).toBeGreaterThanOrEqual(3);
  expect(verified.steps.find(step => step.id === 'sessions').evidence.attachments).toBeGreaterThan(0);
  expect(verified.productionReady).toBe(false);
  const reconciliation = verified.steps.find(step => step.id === 'remote-reconciliation');
  expect(reconciliation.status).toBe('required');
  expect(reconciliation.evidence.plans.some(row => row.id === plan.id && row.owner_enabled)).toBe(true);
  expect(reconciliation.evidence.budget.waiting.some(row => row.run_id === waiting.id)).toBe(true);
  expect(reconciliation.evidence.budget.releases.some(row => row.run_id === released.id && row.status === 'used')).toBe(true);
  expect(reconciliation.evidence.controls.some(row => row.run_id === waiting.id && row.state.blocks.some(block => block.kind === 'budget'))).toBe(true);
  const counts = verified.steps.find(step => step.id === 'ledger').evidence.counts;
  expect(counts.note_material).toBe(1); expect(counts.worker_run).toBeGreaterThanOrEqual(2); expect(counts.health_evidence).toBeGreaterThan(0);
  expect(counts.plan_trigger).toBe(1); expect(counts.budget_request).toBeGreaterThan(0);

  const count = llm.log.length;
  expect((await host.api('backups', { workspaceBinding: binding })).total).toBe(2);
  const detail = await host.api('backups.detail', { workspaceBinding: binding, id: verified.record.id }); expect(detail.record.status).toBe('succeeded');
  expect(llm.log.length).toBe(count);
  await expect(host.api('backups', { workspaceBinding: 'stale' })).rejects.toThrow('工作区');
  expect(JSON.stringify(await tool('pa24_maintenance', { action: 'backup_verify', backupDir: created.backupDir }, accessId))).toContain('本地会话');

  // Continue the same complete backup-to-restore journey with its own backup.
  expect(created?.backupDir).toBeTruthy();
  await memory({ action: 'delete', id: 'remove-me', expectedRevision: 2, reason: '回收' });
  await memory({ action: 'purge', id: 'remove-me', expectedRevision: 3, reason: '永久删除' });
  await memory(put('keep-me', 4, '目前应保留的新正文'));
  const before = await readFile(join(workspace, '.24pa/memory.json'));
  const restorePreview = await maintenance({ action: 'backup_preview', backupDir: created.backupDir });
  expect(restorePreview).toMatchObject({ protectedIds: ['remove-me'], conflicts: ['keep-me'] });
  const restoreCommand = { action: 'backup_restore_check', requestId: 'loader-drill-one', backupDir: created.backupDir, targetDir: join(root, 'isolated'), previewToken: restorePreview.previewToken, confirm: true };
  const restored = await maintenance(restoreCommand);
  expect(restored.complete, JSON.stringify(restored)).toBe(true); expect(restored.productionReady).toBe(false);
  expect((await maintenance(restoreCommand)).record.id).toBe(restored.record.id);
  const candidate = parseMemoryFile(await readFile(join(restored.targetDir, 'workspace/.24pa/memory.json'), 'utf8'));
  expect(candidate.records).toMatchObject([{ id: 'keep-me', content: '目前应保留的新正文' }]); expect(candidate.tombstones[0].id).toBe('remove-me');
  expect(await readFile(join(workspace, '.24pa/memory.json'))).toEqual(before);
  await host.api('action', { type: 'skill.run', op: 'stop', runId: waiting.id, workspaceBinding: binding, confirm: true });
  const calls = llm.log.length;
  await expect(host.api('action', { type: 'workspace.bind', path: join(restored.targetDir, 'workspace') })).rejects.toThrow('恢复隔离');
  expect((await host.api('snapshot')).workspace.path).toBe(await realpath(workspace)); expect(llm.log.length).toBe(calls);
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ root: hostRoot, env: bootEnv });
  binding = (await host.waitUntil(row => Boolean(row.workspaceBinding))).workspaceBinding;
  const list = await host.api('backups', { workspaceBinding: binding });
  expect(list.total).toBe(3); expect(list.rows.map(row => row.operation).sort()).toEqual(['create', 'restore_check', 'verify']);
  expect(llm.log.length).toBe(calls);
}, 600_000);
