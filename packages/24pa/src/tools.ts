import { workToolProperties } from './work-tool-schema.js';
import z from '@deepseek-ai/schemastery';
import type { DshContext, ToolRunContext } from './host.js';
import type { PaRuntime } from './runtime.js';
import { LEAD_SECTIONS } from './prompts.js';
import { LocalToolAccess, hostGlobalToolNames } from './local-tool-access.js';
export { resolveExtraLocalTools, qwennoteChannelState, hostGlobalToolNames } from './local-tool-access.js';

// Agent-half plugin mounted inside the 24私助 preset. Tools are registered
// once, then restricted per role at agent creation: the same preset never
// implies the same permissions (ADR-0001).

export const name = 'pa24-agent';
export const inject = ['tools', 'systemPrompt', 'pa24'];

export const Config = z.object({});

export function apply(ctx: DshContext) {
  const runtime = ctx.get('pa24') as PaRuntime;
  const access = new LocalToolAccess({
    globalToolNames: () => hostGlobalToolNames(ctx),
    providerAvailable: name => runtime.providerAvailable(name),
    record: resolution => runtime.noteExtraToolResolution(resolution),
  });
  ctx.effect(() => () => access.dispose());
  ctx.on('agent/created', async ({ agent }) => {
    const delegated = await runtime.skillRuns.codingTools(agent);
    if (delegated) {
      await agent.ctx!.plugin({ name: 'pa24-skill-delegate-tools', inject: ['tools'], apply(child: DshContext) {
        child.tools.restrict({ allow: delegated });
      } }).await();
      return;
    }
    const role = runtime.roleForToolMount(agent);
    await access.attach(role, runtime.configFor(agent)?.extraLocalTools ?? [], async (allow, signal) => {
      await agent.ctx!.plugin({
        name: 'pa24-role-tools', inject: ['tools'],
        apply(child: DshContext) {
          if (!signal.aborted) child.tools.restrict({ allow: runtime.roleForToolMount(agent) === role ? allow : [] });
        },
      } as any).await();
    });
  });

  // Lead guidance is registered as ordered sections from the single prompt
  // source (src/prompts.ts): identity/capability → coordination → business
  // domains → safety & reporting, with the workspace's own prose rules last.
  // Sections carry their own headings; the dsh registry joins them as-is.
  for (const section of LEAD_SECTIONS) {
    ctx.effect(() => ctx.systemPrompt.section({ name: section.name, order: section.order, text: section.text }));
  }
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: '24pa-workspace-rules',
      order: 910,
      // Dynamic text: empty until a workspace is bound, fresh after each
      // AGENTS.md reload; empty sections are dropped at render.
      text: () => runtime.workspaceRulesSection(),
    }),
  );

  const register = (
    toolName: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    execute: (args: any, exec: ToolRunContext) => Promise<unknown>,
  ) =>
    ctx.effect(() =>
      ctx.tools.register({
        name: toolName,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute,
      }),
    );

  const string = { type: 'string' };

  register(
    'pa24_delegate',
    '将明确的本人委托交给专业 Worker（memo=备忘、tasks=待办、calendar=日程、reminders=提醒、handwriting=手写整理、skill=任务 skill；可用性以运行时校验为准，不可用会明确报错）。一段输入含多件事时分别委派。handwriting 必须携带 noteId（笔记编号 N-x）；skill 必须携带 skill 名且该名已在 extraBusinessSkills 放行。返回接纳编号；接纳不代表完成。',
    { worker: string, title: string, instruction: string, noteId: string, skill: string },
    ['worker', 'title', 'instruction'],
    (args, exec) => runtime.delegate(args, exec.agent!),
  );

  register(
    'pa24_jobs',
    '查询并行事项、读取进度、继续或停止指定事项。',
    { action: { type: 'string', enum: ['list', 'inspect', 'continue', 'stop'] }, workId: string, instruction: string },
    ['action'],
    (args, exec) => runtime.control(args, exec.agent!),
  );

  register(
    'pa24_notes',
    '查阅与核验手写笔记：list 列出笔记，queue 集中查看待审/需重审/已退回队列，inspect 查看页/版本/审核凭证，verify 有界核验文档当前内容与发布指纹是否一致（matches/changed/unknown，改动会标记需重新审核），republish 以当前文档刷新候选并发新审核卡，finish 结束收集批次，remind 为当前待审版本设置审核提醒（inSeconds/at，kind once|daily，绑定版本：审核完成自动取消），remind_control 稍后/暂停/恢复/取消提醒（只动提醒不动审核）。审核裁决本身只能由本人在飞书审核卡上完成。',
    {
      action: { type: 'string', enum: ['list', 'queue', 'inspect', 'verify', 'republish', 'finish', 'remind', 'remind_control'] },
      noteId: string,
      status: string,
      inSeconds: { type: 'integer', minimum: 1 },
      at: string,
      kind: { type: 'string', enum: ['once', 'daily'] },
      reminderId: string,
      op: { type: 'string', enum: ['snooze', 'pause', 'resume', 'cancel'] },
      reason: string,
    },
    ['action'],
    (args, exec) => runtime.notesTool(args, exec.agent!),
  );

  register(
    'pa24_work',
    'Worker 按本人明确委托执行业务动作（按角色可用：memo_save/memo_find、task_*、calendar_*、meeting_schedule、reminder_*、note_submit）。动作是否可用由运行时按角色绑定校验，未绑定会被拒绝。',
    workToolProperties,
    ['action'],
    (args, exec) => runtime.work(args, exec.agent!),
  );

  register(
    'pa24_memory',
    '检索/维护本工作区 JSON 长期记忆。search/inspect/changesets 只读；put/delete/apply/undo 仅限 dsh 的24私助本地会话，必须携带查询得到的 revision 和本人的指令依据。',
    {
      action: { type: 'string', enum: ['search', 'put', 'delete', 'inspect', 'apply', 'undo', 'changesets'] },
      query: string,
      category: { type: 'string', enum: ['preference', 'fact', 'project', 'decision'] },
      topic: string,
      status: { type: 'string', enum: ['confirmed', 'unverified'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 },
      id: string,
      content: string,
      source: string,
      sourceVersion: string,
      validUntil: string,
      reason: string,
      expectedRevision: { type: 'integer', minimum: 0 },
      changesetId: string,
      changes: { type: 'array', items: { type: 'object' } },
    },
    ['action'],
    (args, exec) => runtime.memoryTool(args, exec.agent!),
  );

  register(
    'pa24_maintenance',
    '运行维护（本地24私助会话）：archive_check 盘点运行事项/原生计划/外部提醒/未确认发送（归档前的安全检查，只读）；archive_execute 需 confirmStop 明确停止并处置原生计划（外部 PG 提醒默认保留、stopRules 才停止，部分失败逐项说明，取消不产生副作用）；backup_create/backup_verify 联合备份与校验（PG＋工作区＋dsh 状态，清单带摘要水位，凭据只存引用名）；health 汇总能力健康、同步新鲜度、预算统计与数据流披露（任何入口可读）。',
    {
      action: { type: 'string', enum: ['archive_check', 'archive_execute', 'backup_create', 'backup_verify', 'health'] },
      confirmStop: { type: 'boolean' },
      stopRules: { type: 'boolean' },
      targetDir: string,
      backupDir: string,
    },
    ['action'],
    (args, exec) => runtime.maintenanceTool(args, exec.agent!),
  );

  register(
    'pa24_workspace',
    '读取工作区配置，或在编辑 AGENTS.md 后重载（进行中的事项未完成时拒绝身份变更）。',
    { action: { type: 'string', enum: ['read', 'reload'] } },
    ['action'],
    async (args, exec) => {
      const role = runtime.roleFor(exec.agent!);
      if (role !== 'local-robot') throw new Error('请在 dsh 的24私助会话中操作。');
      if (args.action === 'reload') await runtime.reloadWorkspace();
      const snapshot = runtime.snapshot() as any;
      return {
        path: snapshot.workspace?.path ?? null,
        config: snapshot.workspace?.config ?? null,
        loadedAt: snapshot.workspace?.loadedAt ?? null,
        configError: snapshot.workspace?.configError ?? null,
        memoryNote: '长期记忆与整理功能在后续功能组交付；当前版本先完成配置维护。',
      };
    },
  );

  register(
    'pa24_connection',
    '接入向导与诊断：guide 返回飞书接入配置指南（配置前必读）；wecom_guide 返回企业微信日程/待办渠道的接入指南（wecom-setup.md）；check 发起飞书只读接入检查（CLI、身份、资源可读性），wecom_check 发起企微渠道只读检查（CLI、机器人绑定、按启用域探测服务级授权），返回的 nextSteps 指出当前卡点的下一步；read 查看配置与最近检查结果。不发消息、不写平台对象。',
    { action: { type: 'string', enum: ['guide', 'check', 'read', 'wecom_guide', 'wecom_check'] } },
    ['action'],
    async (args, exec) => {
      // Every action here is read-only (bundled guides, probes, snapshot), so
      // the feishu entry may run all of them; config writes are a different,
      // local-only tool (pa24_workspace, ADR-0001).
      const role = runtime.roleFor(exec.agent!);
      if (role !== 'local-robot' && role !== 'feishu-access') throw new Error('请在 dsh 的24私助会话中操作接入配置。');
      if (args.action === 'guide') return readSetupGuide();
      if (args.action === 'wecom_guide') return readWecomSetupGuide();
      if (args.action === 'check') return runtime.checkAccess();
      if (args.action === 'wecom_check') return runtime.wecomCheck();
      const snapshot = runtime.snapshot() as any;
      // F24: the vision-route verdict rides along on read so the chat the
      // owner already uses surfaces a text-only-model misroute immediately.
      return { transport: snapshot.transport, diagnostics: snapshot.diagnostics, wecom: runtime.wecomDiagnosticsSnapshot(), visionRoute: runtime.visionRouteStatus() };
    },
  );
}

/** The bundled feishu-setup.md is the single authority for access setup (F15). */
async function readSetupGuide(): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  const guideUrl = new URL('../feishu-setup.md', import.meta.url);
  const pkgUrl = new URL('../package.json', import.meta.url);
  const content = await readFile(guideUrl, 'utf8');
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version?: string };
  return {
    guide: 'feishu-setup.md',
    version: pkg.version ?? null,
    content,
    usage: '配置飞书接入前先通读；一次交付本人操作全量清单，本人回报后自动循环 pa24_connection action=check 收敛并按 nextSteps 一次汇总。',
  };
}

/** The bundled wecom-setup.md is the single authority for the wecom channel (F16). */
async function readWecomSetupGuide(): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  const guideUrl = new URL('../wecom-setup.md', import.meta.url);
  const pkgUrl = new URL('../package.json', import.meta.url);
  const content = await readFile(guideUrl, 'utf8');
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version?: string };
  return {
    guide: 'wecom-setup.md',
    version: pkg.version ?? null,
    content,
    usage: '接入企微日程/待办渠道前先通读；一次交付本人操作全量清单，本人回报后自动循环 wecom_check 收敛并按 nextSteps 一次汇总。',
  };
}
