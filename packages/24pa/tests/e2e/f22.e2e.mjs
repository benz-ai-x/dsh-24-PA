// F22 end-to-end: wiki-node note landing with the same boundaries as f01
// (real Loader/Host/sessions, isolated PostgreSQL, stubbed Feishu side,
// scripted model). Pins the F22 contract only: docs +create receives the
// wiki node token as --parent-token when wikiNodeToken is set, falls back to
// folderToken when it is not, and connection.check gains the wiki resource
// row. Handwriting shares the same parent-token selection and is covered by
// the on-device acceptance (T16), not re-run here.
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
    storage: process.env.PA24_E2E_STORAGE === 'sqlite' ? 'sqlite' : 'postgres',
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

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));

const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text });

const memoScript = (keyword, topic) => ({
  mode: 'dispatch',
  delegate: { worker: 'memo', title: `记录${topic}`, instruction: `记录：${keyword}` },
  leadReply: '已安排备忘整理，完成后回报。',
  workerAction: { action: 'memo_save', topic, content: keyword, source: '主人飞书委托' },
  workerReply: '备忘已保存为飞书文档并回读确认。',
});

const runMemo = async (eventId, keyword, topic) => {
  await inject(ownerEvent(eventId, `记一下：${keyword}`));
  return host.waitUntil(
    s => {
      const item = (s.work ?? []).find(w => w.role === 'memo' && w.title === `记录${topic}`);
      return item && item.status === 'completed';
    },
    { timeoutMs: 180_000, label: `备忘完成（${topic}）` },
  );
};

const stubDocs = async () =>
  (await readFile(`${stubStatePath}.docs.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f22-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeConfig({ wikiNodeToken: 'wikinode_test' });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await writeFile(stubStatePath, JSON.stringify({ docs: [], calls: [], ownerOpenId: 'ou_test_owner', appId: 'cli_test_app' }));
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  await writeScript(memoScript('知识库落库的第一条备忘', '知识库备忘'));
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

describe('F22 飞书知识库笔记落库（wiki 优先、folder 回退）', () => {
  it('插件就绪且工作区以 wikiNodeToken 生效', async () => {
    const snap = await host.waitUntil(
      s => !!s.workspace && s.transport?.connected === true,
      { label: '插件就绪' },
    );
    expect(snap.workspace.config.wikiNodeToken).toBe('wikinode_test');
  });

  it('配置 wikiNodeToken 后备忘文档以知识库节点为父级创建', async () => {
    await runMemo('evt-f22-memo-1', '知识库落库的第一条备忘', '知识库备忘');
    const docs = await stubDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).toContain('知识库落库的第一条备忘');
    // 核心：docs +create 的 --parent-token 是知识库节点 token，不是 folderToken。
    expect(docs[0].parentToken).toBe('wikinode_test');
  });

  it('connection.check 新增「知识库」资源行：已配置走 node-get 只读探测', async () => {
    const check = await host.api('action', { type: 'connection.check' });
    const byId = Object.fromEntries(check.resources.map(r => [r.id, r]));
    expect(byId.folder.state).toBe('ok');
    expect(byId.wiki).toBeTruthy();
    expect(byId.wiki.state).toBe('ok');
    // 探测确实落在 wiki 域（stub 调用记录可证）。
    const calls = (await readFile(`${stubStatePath}.calls.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(calls.some(c => c.args.includes('wiki') && c.args.includes('+node-get') && c.args.includes('wikinode_test'))).toBe(true);
  });

  it('移除 wikiNodeToken 重载后回退 folderToken，行为与存量一致', async () => {
    await writeConfig({});
    await host.api('action', { type: 'workspace.reload' });
    const snap = await host.api('snapshot');
    expect(snap.workspace.config.wikiNodeToken).toBe('');

    await writeScript(memoScript('回退到目录的第二条备忘', '回退备忘'));
    await runMemo('evt-f22-memo-2', '回退到目录的第二条备忘', '回退备忘');
    const docs = await stubDocs();
    expect(docs).toHaveLength(2);
    expect(docs[1].parentToken).toBe('fld_test');

    // 未配置的知识库行是 missing（可选回退），不显示为通过。
    const check = await host.api('action', { type: 'connection.check' });
    const wiki = check.resources.find(r => r.id === 'wiki');
    expect(wiki.state).toBe('missing');
    expect(wiki.message).toContain('可选');
    expect(check.nextSteps.join('')).not.toContain('wikiNodeToken');
  });
});
