// Official connectors end-to-end (#304, #306): a fresh instance that installs
// the official @deepseek-ai/dsh-feishu and @deepseek-ai/dsh-wecom plugins
// beside 24私助. Real Loader and Host on the 0.2.3-alpha.2 line, SQLite; the
// vendor CLIs are stubs written where the connectors' install scripts put the
// real executables, and the model is scripted. The plugin row names no CLI and
// PATH carries none, so the connectors' executables are the only ones it can
// run. The two connector packages come from the registry, so the suite runs
// this file only when PA24_E2E_OFFICIAL_CONNECTORS names their version.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startWeixinServer } from '../helpers/weixin-server.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const version = process.env.PA24_E2E_OFFICIAL_CONNECTORS;
const larkStub = resolve('tests/helpers/stub-lark-cli.mjs'), wecomStub = resolve('tests/helpers/stub-wecom-cli.mjs');
// Every string a recorded request carries, whatever block shape the Host used.
const strings = value => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const said = request => strings(request.inputs).join('\n');

let root, host, llm, wx, workspace, scriptPath, binding, larkState, larkPath, wecomPath, localSessionId;
const journal = async path => (await readFile(path, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
const sources = { version: 1, entries: [
  { id: 'personal-calendar', domain: 'calendar', platform: 'feishu', name: '个人日历', purpose: 'personal', ownerId: 'ou_connectors_owner', resourceKind: 'calendar', resourceId: 'personal-cal', filter: 'all', access: 'readwrite', enabled: true },
  { id: 'personal-todo', domain: 'todo', platform: 'feishu', name: '个人待办', purpose: 'personal', ownerId: 'ou_connectors_owner', resourceKind: 'tasklist', resourceId: 'personal-list', filter: 'all', access: 'readwrite', enabled: true },
], defaults: { calendar: 'personal-calendar', todo: 'personal-todo' }, mappings: [], meetingDurationMinutes: 30 };

async function until(check, label) {
  for (let index = 0; index < 160; index++) {
    const found = check();
    if (found) return found;
    await delay(250);
  }
  throw new Error(`等待${label}超时\n${JSON.stringify(host.logs()).slice(-3000)}`);
}

// One owner request from the Feishu entry, delegated to a worker by the
// scripted model; the work item's final status says whether the tool ran.
async function perform(worker, workerAction, title) {
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker, title, instruction: '按主人本次原文办理' }, leadReply: '已接纳，等待结果。', workerAction, workerReply: '本次业务已处理。' }));
  await host.api('action', { type: 'test.inject', event: { eventId: `connectors-write-${randomUUID()}`, senderOpenId: 'ou_connectors_owner', appId: 'cli_connectors_app', text: title } });
  await host.waitUntil(snapshot => snapshot.work.some(row => row.title === title && ['completed', 'needs_reconciliation'].includes(row.status)), { timeoutMs: 30000, label: title });
  return (await host.api('snapshot')).work.find(row => row.title === title);
}

// One local prompt whose reply must come back through the `skill` tool. Requests
// are matched by the prompt's own marker anywhere in the recorded input (the
// Host appends context blocks after the prompt): a turn can still be settling
// when the next one starts, and its later requests carry earlier tool results.
async function loadSkill(skill, index) {
  await writeFile(scriptPath, JSON.stringify({ steps: [{ tool: { name: 'skill', input: { name: skill } } }, { text: `已加载 ${skill} 技能。` }] }));
  const marker = `加载 ${skill} 技能 ${randomUUID()}`, before = llm.log.length;
  await host.remote('session/prompt', { request: { requestId: `connectors-local-${index}-${randomUUID()}`, sessionId: localSessionId, mode: 'queue',
    content: [{ type: 'text', text: marker }], clientTimeZone: 'Asia/Shanghai' } });
  const turn = () => llm.log.slice(before);
  const call = await until(() => turn().find(row => said(row).includes(marker)), `${skill} 技能请求`);
  const answer = await until(() => turn().slice(turn().indexOf(call) + 1).find(row => row.toolResults.length > 0), `${skill} 技能加载`);
  return { call, result: answer.toolResults.join('') };
}

describe.skipIf(!version)('官方连接器共载（真实 Loader，0.2.3-alpha 线）', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-connectors-')); workspace = join(root, 'workspace'); await mkdir(workspace);
    await writeFile(join(workspace, 'AGENTS.md'), '# 官方连接器共载验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu',
      ownerOpenId: 'ou_connectors_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list', enabledWorkers: ['tasks', 'calendar'], sources }) + '\n```\n');
    const wecomState = join(root, 'wecom.json'); larkState = join(root, 'lark.json'); scriptPath = join(root, 'script.json');
    await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_connectors_owner', appId: 'cli_connectors_app' })); await writeFile(wecomState, '{}');
    await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
    llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json'), recordInputs: true }); wx = await startWeixinServer();
    // The executables the connectors' rows check for come from install scripts
    // the fixture ignores (lark-cli) or ship ready to run (the wecom platform
    // package): stand-ins replace both, so no vendor CLI can reach a real
    // account. A rename replaces the hard-linked file rather than editing the
    // store's copy.
    const standIn = async (file, target) => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.stand-in`, '#!/usr/bin/env node\nawait import(' + JSON.stringify(target) + ');\n', { mode: 0o755 });
      await rename(`${file}.stand-in`, file);
    };
    host = await bootHost({
      env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_connectors_app', PA24_FEISHU_APP_SECRET: 'connectors-secret',
        PA24_LARK_STUB_STATE: larkState, PA24_WECOM_STUB_STATE: wecomState,
        DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, npm_config_registry: 'https://registry.npmjs.org',
        PA24_TEST_WEIXIN_URL: wx.url, NODE_OPTIONS: `--import=${resolve('tests/helpers/weixin-fetch-boundary.mjs')}` },
      extraPlugins: [`@deepseek-ai/dsh-feishu@${version}`, `@deepseek-ai/dsh-wecom@${version}`],
      async beforeBoot({ root: testRoot, profile }) {
        larkPath = join(profile, 'node_modules/@larksuite/cli/bin/lark-cli');
        wecomPath = join(profile, `node_modules/@wecom/cli-${process.platform}-${process.arch}/bin/wecom-cli`);
        await standIn(larkPath, larkStub); await standIn(wecomPath, wecomStub);
        // The wecom row downloads its guides from GitHub when it loads; a local
        // directory keeps the run offline.
        const guides = join(testRoot, 'wecom-guides'); await mkdir(guides, { recursive: true });
        await writeFile(join(profile, 'cordis.patch.yml'), `- id: wecom\n  config:\n    skillsDir: ${JSON.stringify(guides)}\n`);
      },
    });
    [larkPath, wecomPath] = await Promise.all([realpath(larkPath), realpath(wecomPath)]);
    binding = (await host.waitUntil(row => !!row.workspaceBinding && !!row.workspace?.localSessionId && row.transport?.connected === true, { label: '工作区就绪' })).workspaceBinding;
    localSessionId = (await host.api('snapshot')).workspace.localSessionId;
  }, 600000);

  afterAll(async () => { await host?.stop(); await wx?.close(); await llm?.close(); if (root) await rm(root, { recursive: true, force: true }); });

  it('连接器的两行与24私助一同激活，宿主不报未激活条目；托管 CLI 的位置上是替身', async () => {
    const { stdout, stderr } = host.logs();
    expect(stdout + stderr).not.toMatch(/did not activate/);
    expect(stdout + stderr).not.toMatch(/@deepseek-ai\/dsh-(feishu|wecom)/);
    for (const [file, stub] of [[larkPath, larkStub], [wecomPath, wecomStub]]) {
      expect(await readFile(file, 'utf8')).toContain(JSON.stringify(stub));
    }
  });

  it('本地会话拿到官方 CLI 的绝对路径，并能加载官方 feishu 与 wecom 技能', async () => {
    const feishu = await loadSkill('feishu', 1);
    expect(feishu.call.tools).toEqual(expect.arrayContaining(['bash', 'skill', 'pa24_delegate']));
    expect(said(feishu.call)).toContain(`Feishu CLI: run \`lark-cli\` by its absolute path "${larkPath}"`);
    expect(said(feishu.call)).toContain(`WeCom CLI: run \`wecom-cli\` by its absolute path "${wecomPath}"`);
    // The mock records a tool result as JSON, so its quotes arrive escaped.
    const unescaped = result => result.replace(/\\"/g, '"');
    expect(unescaped(feishu.result)).toContain('<skill_content name="feishu">');
    const wecom = await loadSkill('wecom', 2);
    expect(unescaped(wecom.result)).toContain('<skill_content name="wecom">');
  });

  it('#306 CLI 取自官方连接器：接入检查与两项写入都经由连接器包内的 CLI', async () => {
    const item = (await host.api('snapshot')).readiness.items.find(row => row.id === 'vendor-cli');
    expect(item.state).toBe('ok');
    expect(item.message).toContain(`lark-cli：官方连接器提供（${larkPath}）`);
    expect(item.message).toContain(`wecom-cli：官方连接器提供（${wecomPath}）`);
    const access = await host.api('action', { type: 'connection.check' });
    expect(access.cli).toMatchObject({ state: 'ok', source: 'official', path: larkPath });
    expect((await host.api('action', { type: 'connection.wecom-check' })).cli.state).toBe('ok');
    // A task and a calendar event, each through the ledger-backed worker tools.
    const task = '官方连接器路径写入的待办', event = '官方连接器路径写入的日程', start = new Date(Date.now() + 26 * 3600_000);
    const wrote = await perform('tasks', { action: 'task_create', summary: task }, task);
    expect(wrote.status).toBe('completed');
    const scheduled = await perform('calendar', { action: 'calendar_create', summary: event, start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString() }, event);
    expect(scheduled.status).toBe('completed');
    // The stand-in journals every object it is asked to create.
    expect((await journal(larkState + '.tasks.jsonl')).some(row => String(row.summary).includes(task))).toBe(true);
    expect((await journal(larkState + '.events.jsonl')).some(row => String(row.summary).includes(event))).toBe(true);
  });

  it('没装官方连接器的实例：飞书模式拒绝激活并给出安装命令，插件行给出 larkCliBin 后恢复', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'pa24-connectors-none-'));
    const workspace = join(bare, 'workspace'); await mkdir(workspace);
    await writeFile(join(workspace, 'AGENTS.md'), '# 没有官方连接器\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu', ownerOpenId: 'ou_connectors_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list' }) + '\n```\n');
    const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_connectors_app', PA24_FEISHU_APP_SECRET: 'connectors-secret',
      DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url };
    try {
      // No connector, nothing in the plugin row, no stand-in anywhere: the channel is refused and the readiness says what to install.
      const refused = await bootHost({ env });
      try {
        const snapshot = await refused.waitUntil(row => !!row.workspace?.localSessionId, { label: '工作区就绪' }).catch(error => { throw new Error(`${error.message}\n${JSON.stringify(refused.logs()).slice(-2500)}`); });
        expect(snapshot.transport.connected).toBe(false);
        expect(snapshot.transport.message).toContain('需要官方飞书插件提供的 lark-cli');
        expect(snapshot.transport.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-feishu');
        expect(snapshot.readiness.items.find(row => row.id === 'feishu').state).toBe('error');
        expect(snapshot.readiness.items.find(row => row.id === 'vendor-cli').state).toBe('error');
      } finally { await refused.stop(); }
      // A stand-in reachable through PATH is named in the plugin row by the fixture, and the channel starts.
      const bin = join(bare, 'bin'); await mkdir(bin);
      await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(larkStub) + ');\n'); await chmod(join(bin, 'lark-cli'), 0o755);
      const supplied = await bootHost({ env: { ...env, PA24_LARK_STUB_STATE: larkState, PATH: `${bin}${delimiter}${process.env.PATH}` } });
      try {
        const snapshot = await supplied.waitUntil(row => row.transport?.connected === true, { label: '显式给出 lark-cli 后的飞书接入' });
        expect(snapshot.readiness.items.find(row => row.id === 'vendor-cli')).toMatchObject({ state: 'ok' });
        expect(snapshot.readiness.items.find(row => row.id === 'vendor-cli').message).toContain(`lark-cli：插件行显式配置（`);
      } finally { await supplied.stop(); }
    } finally { await rm(bare, { recursive: true, force: true }); }
  });

  it('飞书接入会话仍只有业务白名单：无 Shell、无技能工具', async () => {
    await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
    const marker = `记一下：官方连接器共载验收 ${randomUUID()}`, before = llm.log.length;
    await host.api('action', { type: 'test.inject', event: { eventId: `connectors-feishu-${randomUUID()}`, senderOpenId: 'ou_connectors_owner', appId: 'cli_connectors_app', text: marker } });
    const request = await until(() => llm.log.slice(before).find(row => row.tools.includes('pa24_delegate') && said(row).includes(marker)), '飞书接入会话的模型请求');
    expect(request.tools).toContain('pa24_connection');
    for (const absent of ['bash', 'pwsh', 'skill', 'read', 'write', 'pa24_work']) expect(request.tools).not.toContain(absent);
  });

  it('微信接入会话仍只有业务白名单：无 Shell、无技能工具', async () => {
    const state = extra => host.api('weixin', { workspaceBinding: binding, ...extra });
    const change = (action, extra = {}) => host.api('action', { type: 'weixin.change', action, workspaceBinding: binding, ...extra });
    const settled = async check => {
      for (let index = 0; index < 160; index++) {
        const current = await state();
        if (check(current)) return current;
        await delay(250);
      }
      throw new Error(`微信状态超时: ${JSON.stringify(await state())}`);
    };
    await change('login'); await settled(current => !!current.candidate);
    const preview = await change('preview', { op: 'activate' });
    await change('apply', { previewId: preview.previewId, confirm: true });
    await settled(current => current.phase === 'polling');
    await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到本人文字。' }] }));
    const marker = `你好 ${randomUUID()}`, before = llm.log.length;
    wx.input(marker);
    const request = await until(() => llm.log.slice(before).find(row => row.tools.includes('pa24_delegate') && said(row).includes(marker)), '微信接入会话的模型请求');
    expect(request.tools).not.toContain('pa24_connection');
    for (const absent of ['bash', 'pwsh', 'skill', 'read', 'write', 'pa24_work']) expect(request.tools).not.toContain(absent);
  });
});
