// F15 end-to-end: the feishu access wizard is reachable through the real
// Loader — the local session calls pa24_connection action=guide and receives
// the bundled markdown, then action=check returns nextSteps navigation.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, localSessionId;

const waitToolResult = async (substr, label, timeoutMs = 60_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.filter(r => r.toolResults.length > 0).at(-1);
    if (last && last.toolResults.join('').includes(substr)) return last.toolResults.join('');
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时`);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f15-'));
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
  // demo 模式且 folderToken/tasklistId 留空：check 的 nextSteps 应指向补齐它们。
  await writeFile(
    join(workspace, 'AGENTS.md'),
    `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify({
      version: 1, mode: 'demo', larkProfile: '24PA', ownerOpenId: 'ou_test_owner',
      folderToken: '', tasklistId: '', calendarId: 'primary', timeZone: 'Asia/Shanghai',
      appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
      maxWorkers: 2, enabledWorkers: ['memo'], workerModels: {},
    }, null, 2)}\n\`\`\`\n`,
  );
  await writeFile(scriptPath, JSON.stringify({
    mode: 'dispatch',
    leadTool: { name: 'pa24_connection', input: { action: 'guide' } },
    leadReply: '已读取接入指南。',
  }, null, 2));
  bootEnv = {
    PA24_WORKSPACE: workspace,
    PA24_PG_DSN: cluster.dsn,
    PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url,
    DEEPSEEK_API_KEY: 'test-key',
    PA24_LARK_STUB_STATE: stubStatePath,
    PATH: `${binDir}:${process.env.PATH}`,
  };
  host = await bootHost({ env: bootEnv });
  const snap = await host.waitUntil(
    s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace,
    { label: '插件就绪' },
  );
  localSessionId = snap.workspace.localSessionId;
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F15 飞书接入配置向导（真实 Loader + 隔离 PG）', () => {
  it('guide 返回随包分发的指南全文与版本', async () => {
    await host.remote('session/prompt', {
      request: {
        requestId: 'f15-guide-1',
        sessionId: localSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '帮我把飞书接入配置好' }],
        clientTimeZone: 'Asia/Shanghai',
      },
    });
    const result = await waitToolResult('feishu-setup.md', 'guide 返回');
    expect(result).toContain('飞书接入配置指南');
    expect(result).toContain('--device-code');
    expect(result).toContain('自动验收（一次汇总');
    expect(result).toContain('version');
  });

  it('check 返回 nextSteps：资源缺失时给出补齐指引', async () => {
    await writeFile(scriptPath, JSON.stringify({
      mode: 'dispatch',
      leadTool: { name: 'pa24_connection', input: { action: 'check' } },
      leadReply: '已检查，接下来补齐资源标识。',
    }, null, 2));
    await host.remote('session/prompt', {
      request: {
        requestId: 'f15-check-1',
        sessionId: localSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '现在检查接入状态' }],
        clientTimeZone: 'Asia/Shanghai',
      },
    });
    const result = await waitToolResult('nextSteps', 'check 返回');
    expect(result).toContain('folderToken');
    expect(result).toContain('tasklistId');
  });
});
