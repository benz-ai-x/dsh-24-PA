// F03 end-to-end: real Feishu-task lifecycle through the stubbed CLI —
// create (idempotent), update (due vs planned vs estimate), complete, list,
// remote-refresh get, project adopt/progress, and duplicate-request reuse.
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

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const inject = event => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, text, extra = {}) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', text, ...extra });
const readTasks = async () => {
  try {
    return (await readFile(`${stubStatePath}.tasks.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
};
const waitWork = async (predicate, label, timeoutMs = 180_000) =>
  host.waitUntil(s => {
    const items = s.work ?? [];
    return predicate(items, s);
  }, { timeoutMs, label });
const waitToolResult = async (substr, label, timeoutMs = 60_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
    if (last && last.toolResults.join('').includes(substr)) return last.toolResults.join('');
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.filter(r => r.tools.includes('pa24_work') && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? last.toolResults.join('').slice(0, 500) : '无'}`);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f03-'));
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
      maxWorkers: 3, enabledWorkers: ['memo', 'tasks'], workerModels: {},
    }, null, 2)}\n\`\`\`\n`,
  );
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
  await host.waitUntil(s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace, { label: '插件就绪' });
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F03 任务与项目清单（真实 Loader + 隔离 PG + 桩飞书任务）', () => {
  it('P08：一句话创建真实任务并返回链接；重复委派不重复建任务', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '创建预算任务', instruction: '创建任务：周五前交预算' },
      leadReply: '已安排创建任务。',
      workerAction: { action: 'task_create', summary: '周五前交预算', due: '2026-10-09' },
      workerReply: '任务已创建。',
    });
    await inject(ownerEvent('evt-task-1', '帮我记一个待办：周五前交预算'));
    const snap = await waitWork((items, s) => {
      const item = items.find(w => w.role === 'tasks');
      return item && item.status === 'completed' && (s.outbox ?? []).some(o => o.dedup_key.startsWith(`workitem:${item.id}:result`) && o.status === 'sent');
    }, '任务创建完成并回传');
    const item = snap.work.find(w => w.role === 'tasks');
    const tasks = await readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].summary).toContain('周五前交预算');
    expect((await cluster.query(`select count(*) from pa24.task`)).trim()).toBe('1');
    expect((await cluster.query(`select count(*) from pa24.action_operation where action='task.create' and status='succeeded'`)).trim()).toBe('1');

    // 同一事项补充同一创建请求：操作键幂等，不重复写飞书
    const resultRow = snap.outbox.find(o => o.dedup_key.startsWith(`workitem:${item.id}:result`) && o.status === 'sent');
    await inject(ownerEvent('evt-task-1-dup', '再创建一次同样的任务', { parentMessageId: resultRow.message_id }));
    await waitWork(items => items.filter(w => w.role === 'tasks').length === 1 && items[0].status === 'completed', '重复请求处理完');
    await waitToolResult('未重复', '幂等复用回执');
    expect((await readTasks())).toHaveLength(1);
    expect((await cluster.query(`select count(*) from pa24.action_operation where action='task.create'`)).trim()).toBe('1');
  });

  it('P09：修改截止（区分计划/估时）、完成与远端刷新查询', async () => {
    const guid = (await readTasks())[0].guid;
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '调整并完成任务', instruction: '把预算任务改到下周一并标注估时，然后完成它' },
      leadReply: '已安排调整。',
      workerAction: { action: 'task_update', taskId: guid, summary: '周五前交预算（延至下周一评审）', due: '2026-10-12' },
      workerReply: '任务已修改。',
    });
    await inject(ownerEvent('evt-task-2', '预算做不完，延到下周一，估时 3 小时，然后先完成初稿部分'));
    await waitWork(items => items.filter(w => w.role === 'tasks').length === 2, '修改事项出现');
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '完成任务', instruction: '完成预算任务' },
      leadReply: '已安排完成。',
      workerAction: { action: 'task_complete', taskId: guid },
      workerReply: '任务已完成。',
    });
    await inject(ownerEvent('evt-task-3', '预算初稿这部分完成了'));
    await waitWork(items => items.filter(w => w.role === 'tasks').length === 3, '完成事项出现');
    const snap = await waitWork((items, s) => items.filter(w => w.role === 'tasks').length === 3 && items.every(w => w.status === 'completed') && (s.outbox ?? []).filter(o => o.status === 'sent').length >= 3, '全部任务事项完成');
    const remote = (await readTasks()).find(t => t.guid === guid);
    expect(remote.summary).toContain('延至下周一评审');
    expect(remote.status).toBe('completed');
    const projection = await cluster.query(`select status, due_at from pa24.task where task_guid='${guid}'`);
    expect(projection).toContain('completed');

    // task_get 触发远端刷新并回读最新状态
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '查询任务', instruction: '查询预算任务状态' },
      leadReply: '已安排查询。',
      workerAction: { action: 'task_get', taskId: guid },
      workerReply: '已查询。',
    });
    await inject(ownerEvent('evt-task-4', '查一下预算任务现在的状态'));
    await waitWork(items => items.filter(w => w.role === 'tasks').length === 4, '查询事项出现');
    await waitToolResult('已按飞书最新状态刷新', '远端刷新回执');
    expect(snap.outbox.length).toBeGreaterThan(0);
  });

  it('P17：目标拆解采纳后建立真实任务与项目关联，进展来自实际状态', async () => {
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '发布项目准备', instruction: '按本人采纳的拆解建立项目任务' },
      leadReply: '已安排项目采纳。',
      workerAction: {
        action: 'project_adopt',
        projectId: '',
        tasks: [],
      },
      workerReply: '已采纳。',
    });
    // 先建项目（第一个 worker 调用 project_create），再采纳
    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '建立发布项目', instruction: '建立项目：发布 v1' },
      leadReply: '已安排。',
      workerAction: { action: 'project_create', name: '发布 v1', goal: '两周内完成 v1 发布准备' },
      workerReply: '项目已建立。',
    });
    await inject(ownerEvent('evt-proj-1', '新建项目：发布 v1'));
    await waitWork(items => items.some(w => w.role === 'tasks' && w.title === '建立发布项目' && w.status === 'completed'), '项目建立完成');
    const projectId = (await cluster.query(`select id from pa24.project where name='发布 v1'`)).trim();
    expect(projectId).toMatch(/^prj-/);

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '采纳发布拆解', instruction: '采纳两项子任务' },
      leadReply: '已安排采纳。',
      workerAction: {
        action: 'project_adopt',
        projectId,
        tasks: [
          { summary: '整理发布说明', due: '2026-10-10', estimateMinutes: 60 },
          { summary: '回归验证清单', estimateMinutes: 90 },
        ],
      },
      workerReply: '已采纳两项。',
    });
    await inject(ownerEvent('evt-proj-2', '采纳这两项：整理发布说明、回归验证清单'));
    await waitWork(items => items.some(w => w.title === '采纳发布拆解' && w.status === 'completed'), '采纳完成');
    expect((await readTasks()).length).toBeGreaterThanOrEqual(3);
    expect((await cluster.query(`select count(*) from pa24.project_task where project_id='${projectId}'`)).trim()).toBe('2');

    await writeScript({
      mode: 'dispatch',
      delegate: { worker: 'tasks', title: '项目进展', instruction: '汇报发布 v1 进展' },
      leadReply: '已安排汇报。',
      workerAction: { action: 'project_progress', projectId },
      workerReply: '进展已汇总。',
    });
    await inject(ownerEvent('evt-proj-3', '发布 v1 还剩什么'));
    await waitWork(items => items.some(w => w.title === '项目进展' && w.status === 'completed'), '进展汇报完成');
    const payload = await waitToolResult('剩余 2 项', '项目进展汇总');
    expect(payload).toContain('回归验证清单');
    expect((await cluster.query(`select count(*) from pa24.project`)).trim()).toBe('1');
  });
});
