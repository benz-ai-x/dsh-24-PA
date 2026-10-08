// F13 end-to-end: the 24私助 preset now carries the full standard-mode tool
// base (user-confirmed 2026-10-07) beside its assistant tools. Real dsh Loader
// and Host, real native sessions, real isolated PostgreSQL, scripted model.
// Boundaries replaced per the repo convention: model, external network only.
//
// The tool catalogs below are read from what the LLM adapter actually received
// (mock-llm logs body.tools per request), so the assertions cover the composed
// preset AND the per-role restriction in one pass:
//   - local session (local-robot): standard coding tools + full pa24 set,
//     tool-schedule omitted by design, codex/claude-code tools dormant until
//     their provider bundles are installed into the profile;
//   - feishu access session (feishu-access): business whitelist plus the
//     read-only access wizard pa24_connection (guide/check/wecom_guide/
//     wecom_check); config writes stay local via pa24_workspace (ADR-0001);
//   - worker: pa24_work + read-only pa24_memory only.
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

const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text });

const localRequest = () =>
  llm.log.filter(r => r.tools.includes(process.platform === 'win32' ? 'pwsh' : 'bash') && r.tools.includes('pa24_delegate')).at(-1);
const feishuRequest = () =>
  llm.log.filter(r => r.tools.includes('pa24_delegate') && !r.tools.includes('bash') && !r.tools.includes('pa24_work')).at(-1);
const workerRequest = () => llm.log.filter(r => r.tools.includes('pa24_work')).at(-1);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f13-'));
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
  await writeFile(
    join(workspace, 'AGENTS.md'),
    `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify({
      version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
      folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
      appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
      maxWorkers: 2, enabledWorkers: ['memo'], workerModels: {},
    }, null, 2)}\n\`\`\`\n`,
  );
  await writeFile(scriptPath, JSON.stringify({
    mode: 'dispatch',
    delegate: { worker: 'memo', title: 'F13 工具面验收', instruction: '记录：预设并入标准能力验收' },
    leadReply: '已记录。',
    workerAction: { action: 'memo_save', topic: 'F13', content: '预设并入标准能力验收', source: 'F13 e2e' },
    workerReply: '已保存。',
  }, null, 2));
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
  let snap;
  try {
    snap = await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '插件就绪' },
    );
  } catch (error) {
    const logs = host.logs();
    throw new Error(`${error.message}\n--- host stderr ---\n${logs.stderr.slice(-4000)}\n--- host stdout tail ---\n${logs.stdout.slice(-2000)}`);
  }
  localSessionId = snap.workspace.localSessionId;
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F13 预设并入标准模式能力（真实 Loader + 隔离 PG）', () => {
  it('预设携带标准插件全集启动，双入口会话正常建立', async () => {
    // A broken preset row would fail session creation at startup, so a healthy
    // workspace snapshot is itself the composition smoke test.
    const snap = await host.api('snapshot');
    expect(snap.workspace.accessSessionId).toMatch(/^pa24-/);
    expect(snap.workspace.localSessionId).toMatch(/^pa24-/);
  });

  it('本地会话工具面＝标准编程工具全集＋完整 pa24 工具；schedule 与外部 CLI 委派缺席', async () => {
    await host.remote('session/prompt', {
      request: {
        requestId: 'f13-local-1',
        sessionId: localSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '帮我在本地记一条：预设能力扩展验收' }],
        clientTimeZone: 'Asia/Shanghai',
      },
    });
    let request;
    for (let i = 0; i < 60 && !request; i++) {
      request = localRequest();
      if (!request) await new Promise(r => setTimeout(r, 500));
    }
    expect(request).toBeTruthy();
    const shell = process.platform === 'win32' ? 'pwsh' : 'bash';
    expect(request.tools).toEqual(expect.arrayContaining([
      // standard coding base (platform shell asserted separately below)
      'read', 'write', 'edit', 'read_image', 'glob', 'grep',
      'job_list', 'job_output', 'job_kill',
      'skill', 'create_goal', 'get_goal', 'update_goal',
      'exit_plan_mode', 'ask_user_question', 'todo_write',
      'web_fetch', 'web_search', 'present',
      'subagent', 'subagent_fork', 'interrupt_agent', 'send_message', 'list_agents',
      'workflow', 'ralph',
      // full pa24 set incl. local-only maintenance/entry tools
      'pa24_delegate', 'pa24_jobs', 'pa24_notes', 'pa24_memory', 'pa24_maintenance',
      'pa24_workspace', 'pa24_connection',
    ]));
    expect(request.tools).toContain(shell);
    // tool-schedule is deliberately omitted from the PRESET: reminders stay on
    // the ledger. On the rc.2 variant run the host also carries the
    // experimental schedule bundle, whose session-layer tools no preset
    // restriction can hide — deployment choice, not our preset composition.
    const hostScheduleBundle = /schedule-bundle/.test(process.env.PA24_E2E_EXTRA_PLUGINS ?? '');
    if (!hostScheduleBundle) {
      for (const absent of ['schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete']) {
        expect(request.tools).not.toContain(absent);
      }
    }
    // The external-CLI delegation tools mount only once their provider bundles
    // are installed into the profile; this test profile has none, so they stay
    // dormant instead of erroring.
    expect(request.tools).not.toContain('subagent_codex');
    expect(request.tools).not.toContain('subagent_claude_code');
    // Worker-only surface never leaks into the local lead.
    expect(request.tools).not.toContain('pa24_work');
  });

  it('飞书接入会话维持业务白名单：无终端/文件/通用委派工具', async () => {
    await inject(ownerEvent('evt-f13-1', '记一下：飞书入口工具面验收'));
    let request;
    for (let i = 0; i < 60 && !request; i++) {
      request = feishuRequest();
      if (!request) await new Promise(r => setTimeout(r, 500));
    }
    expect(request).toBeTruthy();
    // Strict closed surface: the feishu lead may see NOTHING outside its
    // business whitelist plus the read-only access wizard — no shell, no file
    // tools, no generic delegation. On the rc.2 variant run the host's
    // experimental schedule bundle adds session-layer schedule_* tools that no
    // restriction can hide; those are the ONLY tolerated extras (deployment
    // choice, see above).
    const FEISHU_WHITELIST = ['pa24_delegate', 'pa24_jobs', 'pa24_notes', 'pa24_memory', 'pa24_maintenance', 'pa24_connection'];
    const received = request.tools.slice().sort();
    const hostScheduleBundle = /schedule-bundle/.test(process.env.PA24_E2E_EXTRA_PLUGINS ?? '');
    if (!hostScheduleBundle) {
      expect(received).toEqual(FEISHU_WHITELIST.slice().sort());
    } else {
      const tolerated = received.filter(t => t.startsWith('schedule_'));
      expect(tolerated.length).toBeGreaterThan(0);
      expect(received.filter(t => !t.startsWith('schedule_'))).toEqual(FEISHU_WHITELIST.slice().sort());
    }
  });

  it('Worker 子会话仍只有 pa24_work 与只读记忆', async () => {
    let request;
    for (let i = 0; i < 120 && !request; i++) {
      request = workerRequest();
      if (!request) await new Promise(r => setTimeout(r, 500));
    }
    expect(request).toBeTruthy();
    // Strict closed surface: exactly the worker whitelist, nothing else.
    expect(request.tools.slice().sort()).toEqual(['pa24_memory', 'pa24_work']);
  });
});
