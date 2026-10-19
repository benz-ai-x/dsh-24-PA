// F33 end-to-end: 参数配置表单保存链路——workspace.config-update 经真实
// Loader 与面板 API：合法补丁落盘重载生效且规则区逐字节不变、非法值被
// 字段级拒绝且文件不动、storage/密钥引用名等白名单外字段拒绝走表单。
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootHost } from '../helpers/host.mjs';

let host, root, workspace, agentsMd, workspaceBinding;

const readAgents = () => readFile(join(workspace, 'AGENTS.md'), 'utf8');
const proseOf = source => source.replace(/^```json\s*\n[\s\S]*?^```\s*$/gm, '<CFG>');
const rawConfig = source => JSON.parse(source.split('```json')[1].split('```')[0]);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f33-'));
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  // storage 未声明 → F25 默认 SQLite（本用例不触任何业务表，也验证 sqlite 路径启动）。
  agentsMd = `# 24私助工作区\n\n规则区测试锚点（F33）：本行必须逐字节保留。\n\n\`\`\`json\n${JSON.stringify({
    version: 1, mode: 'demo', storage: 'sqlite', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
    folderToken: '', tasklistId: '', calendarId: 'primary',
    calendarChannel: 'feishu', todoChannel: 'feishu', notifyChannel: 'feishu',
    timeZone: 'Asia/Shanghai',
    appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
    maxWorkers: 2, enabledWorkers: ['memo'], workerModels: {},
  }, null, 2)}\n\`\`\`\n\n## 工作规则\n\n- 规则区第二锚点。\n`;
  await writeFile(join(workspace, 'AGENTS.md'), agentsMd);
  host = await bootHost({
    env: {
      PA24_WORKSPACE: workspace,
      DEEPSEEK_BASE_URL: 'http://127.0.0.1:9', // 占位：本用例不发起模型调用
      DEEPSEEK_API_KEY: 'test-key',
      PA24_FEISHU_APP_ID: 'env-app-id-wins', // F36：验证同名 env 优先于密钥库
    },
  });
  await host.waitUntil(s => s.workspace?.config, { label: '配置加载' });
  workspaceBinding = (await host.api('snapshot', {})).workspaceBinding;
}, 180_000);

afterAll(async () => {
  await host?.stop?.();
  await rm(root, { recursive: true, force: true });
});

describe('F33 参数配置表单（真实 Loader + 面板 API）', () => {
  it('合法补丁：落盘、规则区逐字节不变、重载生效', async () => {
    const before = await readAgents();
    const snap = await host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { todoChannel: 'wecom', maxWorkers: 4 } });
    expect(snap.workspace.config.todoChannel).toBe('wecom');
    expect(snap.workspace.config.maxWorkers).toBe(4);
    const after = await readAgents();
    expect(rawConfig(after).todoChannel).toBe('wecom');
    expect(rawConfig(after).maxWorkers).toBe(4);
    expect(proseOf(after)).toBe(proseOf(before));
  });

  it('非法值：字段级拒绝且 AGENTS.md 未被修改', async () => {
    const before = await readAgents();
    await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { maxWorkers: 9 } })).rejects.toThrow(/maxWorkers/);
    await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { timeZone: 'Not/AZone' } })).rejects.toThrow(/timeZone/);
    await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { tts: { engine: 'volcengine', voice: '', volcKeyEnv: '', meloDir: '' } } })).rejects.toThrow(/volcKeyEnv|voice/);
    await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { todoChannel: 'dingtalk' } })).rejects.toThrow(/todoChannel/);
    expect(await readAgents()).toBe(before);
  });

  it('白名单：storage/version 拒绝走表单；F36 起密钥引用名开放编辑', async () => {
    const before = await readAgents();
    await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { storage: 'postgres' } })).rejects.toThrow(/不接受从表单更新/);
    await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { version: 2 } })).rejects.toThrow(/不接受从表单更新/);
    expect(await readAgents()).toBe(before);
    // 引用名现在可经表单改（env 为可选覆盖）；改回原值保持后续用例稳定。
    const snap = await host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { appIdEnv: 'PA24_FEISHU_APP_ID', pgDsnEnv: 'PA24_PG_DSN' } });
    expect(snap.workspace.config.appIdEnv).toBe('PA24_FEISHU_APP_ID');
    expect(proseOf(await readAgents())).toBe(proseOf(before));
    // 快照仍反映上一用例保存的合法值。
    const check = await host.api('snapshot', {});
    expect(check.workspace.config.maxWorkers).toBe(4);
  });

  it('F36 密钥库：secret-update 只写密钥库、AGENTS.md 逐字节不变、快照状态无值、env 优先', async () => {
    const before = await readAgents();
    // 四位全设（feishuAppId 的 env 值在 bootHost 注入——验证同名 env 优先于库）。
    const snap = await host.api('action', { type: 'workspace.secret-update', workspaceBinding, values: {
      volcTtsKey: 'k-e2e-secret', feishuAppId: 'store-app-id-should-lose', feishuAppSecret: 's-e2e', pgDsn: 'dsn-e2e',
    } });
    expect(snap.secrets.feishuAppId).toEqual({ set: true, source: 'env' });
    expect(snap.secrets.feishuAppSecret).toEqual({ set: true, source: 'store' });
    expect(snap.secrets.pgDsn).toEqual({ set: true, source: 'store' });
    expect(snap.secrets.volcTtsKey).toEqual({ set: true, source: 'store' });
    expect(JSON.stringify(snap)).not.toContain('k-e2e-secret');
    expect(JSON.stringify(snap)).not.toContain('dsn-e2e');
    // AGENTS.md 完全不动（密钥与配置块解耦）。
    expect(await readAgents()).toBe(before);
    const { readFile: rf, stat } = await import('node:fs/promises');
    const storeFile = join(workspace, '.24pa', 'secrets.json');
    const st = await stat(storeFile);
    expect(st.mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await rf(storeFile, 'utf8'));
    expect(stored.volcTtsKey).toBe('k-e2e-secret');
    // 逐位清除：空串＝清该位（feishuAppId 清库后 env 仍在→仍 set:env；pgDsn→未设置）。
    const cleared = await host.api('action', { type: 'workspace.secret-update', workspaceBinding, values: { feishuAppId: '', pgDsn: '' } });
    expect(cleared.secrets.feishuAppId).toEqual({ set: true, source: 'env' });
    expect(cleared.secrets.pgDsn).toEqual({ set: false, source: null });
    const after = JSON.parse(await rf(storeFile, 'utf8'));
    expect(after.feishuAppId).toBeUndefined();
    expect(after.pgDsn).toBeUndefined();
    expect(after.feishuAppSecret).toBe('s-e2e');
    // 未知密钥位拒绝。
    await expect(host.api('action', { type: 'workspace.secret-update', workspaceBinding, values: { nope: 'x' } })).rejects.toThrow(/未知密钥字段/);
  });
});


it('缺失或失效绑定身份不能写入；同路径重新绑定也使旧草稿失效', async () => {
  const before = await readAgents();
  await expect(host.api('action', { type: 'workspace.config-update', config: { maxWorkers: 2 } })).rejects.toThrow(/绑定标识/);
  const rebound = await host.api('action', { type: 'workspace.bind', path: workspace });
  expect(rebound.workspaceBinding).not.toBe(workspaceBinding);
  await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding, config: { maxWorkers: 2 } })).rejects.toThrow(/工作区已切换/);
  await expect(host.api('action', { type: 'workspace.secret-update', workspaceBinding, values: { feishuAppSecret: 'stale' } })).rejects.toThrow(/工作区已切换/);
  expect(await readAgents()).toBe(before);
});
