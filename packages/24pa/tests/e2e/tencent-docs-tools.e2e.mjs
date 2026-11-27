// Tencent Docs tools in the local session (#308), with a stand-in for the
// official plugin's on-demand MCP server. The official plugin registers its
// server with the host's MCP manager; the stand-in is one entry of the
// manager's own row — a local stdio server under the same server name, so its
// loader and its loaded tool behave as the hosted server's do once it is
// authorized (which the stand-in does not ask for). Real Loader and Host,
// SQLite; the model and Feishu are stand-ins too.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const LOADER = 'mcp__tencent-docs__load_tools', ECHO = 'mcp__tencent-docs__echo', WILDCARD = 'mcp__tencent-docs__*';
const stubs = [['lark', 'PA24_LARK_STUB_STATE'], ['wecom', 'PA24_WECOM_STUB_STATE']];
// Every string a recorded request carries, whatever block shape the Host used.
const strings = value => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const said = request => strings(request.inputs).join('\n');
const find = (value, predicate) => {
  if (!value || typeof value !== 'object') return undefined;
  if (predicate(value)) return value;
  for (const inner of Object.values(value)) { const hit = find(inner, predicate); if (hit) return hit; }
  return undefined;
};

let llm, scriptPath;
const hosts = [], roots = [];
beforeAll(async () => {
  scriptPath = join(await mkdtemp(join(tmpdir(), 'pa24-tencent-docs-')), 'script.json'); roots.push(dirname(scriptPath));
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
  llm = await startMockLlm({ scriptPath, logPath: scriptPath.replace('script.json', 'model.json'), recordInputs: true });
});
afterAll(async () => { for (const host of hosts.reverse()) await host.stop(); await llm?.close(); for (const root of roots) await rm(root, { recursive: true, force: true }); });

/** A fresh profile with Feishu stand-ins; `mcpServer` adds the stand-in MCP server named tencent-docs to the MCP manager's row. */
async function instance({ mcpServer }) {
  const root = await mkdtemp(join(tmpdir(), 'pa24-tencent-docs-host-')); roots.push(root);
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# 腾讯文档工具放行\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu', ownerOpenId: 'ou_docs_owner',
    folderToken: 'fixture-folder', tasklistId: 'fixture-list', enabledWorkers: ['memo'], extraLocalTools: [WILDCARD] }) + '\n```\n');
  const bin = join(root, 'bin'); await mkdir(bin);
  const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_docs_app', PA24_FEISHU_APP_SECRET: 'docs-secret',
    DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, PATH: `${bin}${delimiter}${process.env.PATH}` };
  for (const [name, variable] of stubs) {
    const state = join(root, `${name}.json`);
    await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_docs_owner', appId: 'cli_docs_app' })); env[variable] = state;
    await writeFile(join(bin, `${name}-cli`), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve(`tests/helpers/stub-${name}-cli.mjs`)) + ');\n', { mode: 0o755 });
    await chmod(join(bin, `${name}-cli`), 0o755);
  }
  // The host's MCP manager owns the server entries of its row; the row has none by default.
  const beforeBoot = mcpServer ? ({ addPatch }) => addPatch([
    '- id: mcp-manager', '  config:', '    servers:', '      tencent-docs:', '        transport: stdio',
    `        command: ${JSON.stringify(process.execPath)}`, `        args: [${JSON.stringify(resolve('tests/helpers/mcp-stand-in.mjs'))}]`,
    '        toolLoading: on-demand',
  ].join('\n')) : undefined;
  const host = await bootHost({ env, beforeBoot });
  hosts.push(host);
  const binding = (await host.waitUntil(row => !!row.workspaceBinding && row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '工作区就绪' })).workspaceBinding;
  return { host, binding, localSessionId: (await host.api('snapshot')).workspace.localSessionId };
}

async function until(check, label, host) {
  for (let index = 0; index < 160; index++) {
    const found = check();
    if (found) return found;
    await delay(250);
  }
  throw new Error(`等待${label}超时\n${JSON.stringify(host.logs()).slice(-3000)}`);
}

async function script(steps) { await writeFile(scriptPath, JSON.stringify({ steps })); }

async function promptLocal(host, sessionId, text) {
  const marker = `${text} ${randomUUID()}`, before = llm.log.length;
  await host.remote('session/prompt', { request: { requestId: `docs-${randomUUID()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: marker }], clientTimeZone: 'Asia/Shanghai' } });
  return { marker, turn: () => llm.log.slice(before) };
}

describe('腾讯文档官方工具在24私助里的放行（真实 Loader）', () => {
  describe('宿主挂着腾讯文档服务器时', () => {
    let current;
    beforeAll(async () => { current = await instance({ mcpServer: true }); }, 600000);

    it('本地会话先只拿到加载器；加载后的工具可见并可执行', async () => {
      await script([
        { tool: { name: LOADER, input: { tools: ['echo'] } } },
        { tool: { name: ECHO, input: { text: '来自24私助的调用' } } },
        { text: '完成。' },
      ]);
      const { marker, turn } = await promptLocal(current.host, current.localSessionId, '读取腾讯文档替身');
      const first = await until(() => turn().find(row => said(row).includes(marker)), '本地会话的模型请求', current.host);
      expect(first.tools).toContain(LOADER);
      expect(first.tools.filter(name => name.startsWith('mcp__tencent-docs__'))).toEqual([LOADER]);
      const answered = await until(() => turn().find(row => row.toolResults.join('').includes('来自24私助的调用')), '替身工具的回执', current.host);
      expect(answered.tools).toContain(ECHO);
    });

    it('飞书接入会话与 Worker 的工具面都没有加载器', async () => {
      const title = `腾讯文档门禁验收 ${randomUUID()}`, before = llm.log.length;
      await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'memo', title, instruction: '记录：门禁验收' }, leadReply: '已记录。',
        workerAction: { action: 'memo_save', topic: '门禁验收', content: '备忘正文', source: 'e2e' }, workerReply: '已保存。' }));
      await current.host.api('action', { type: 'test.inject', event: { eventId: `docs-${randomUUID()}`, senderOpenId: 'ou_docs_owner', appId: 'cli_docs_app', text: title } });
      await current.host.waitUntil(snapshot => snapshot.work.some(row => row.title === title && ['completed', 'needs_reconciliation'].includes(row.status)), { timeoutMs: 30000, label: title });
      const turn = llm.log.slice(before);
      const entry = turn.find(row => row.tools.includes('pa24_delegate') && said(row).includes(title));
      const worker = turn.find(row => row.tools.includes('pa24_work'));
      expect(entry).toBeTruthy(); expect(worker).toBeTruthy();
      for (const request of [entry, worker]) expect(request.tools).not.toContain(LOADER);
      expect((await current.host.api('snapshot')).work.find(row => row.title === title)?.status).toBe('completed');
    });

    it('全应用健康记录最近一次解析：加载器已放行，没有被过滤的条目', async () => {
      const report = await current.host.api('health')
      const capability = find(report, value => value?.id === 'extra-local-tools');
      expect(capability?.state).toBe('ok');
      expect(capability?.message).toContain('放行 1 项');
    });
  });

  describe('宿主没有挂腾讯文档服务器时', () => {
    let current;
    beforeAll(async () => { current = await instance({ mcpServer: false }); }, 600000);

    it('通配条目被过滤，本地会话照常建立，全应用健康提示未挂载', async () => {
      await script([{ text: '已收到。' }]);
      const { marker, turn } = await promptLocal(current.host, current.localSessionId, '问候');
      const request = await until(() => turn().find(row => said(row).includes(marker)), '本地会话的模型请求', current.host);
      expect(request.tools).toContain('bash');
      expect(request.tools.some(name => name.startsWith('mcp__tencent-docs__'))).toBe(false);
      const report = await current.host.api('health')
      const capability = find(report, value => value?.id === 'extra-local-tools');
      expect(capability?.state).toBe('warn');
      expect(capability?.message).toContain(`未挂载被过滤：${WILDCARD}`);
    });
  });
});
