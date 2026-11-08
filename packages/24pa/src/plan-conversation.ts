import { randomUUID } from 'node:crypto';
import type { Repos, WorkItemRow } from './repo.js';
import type { TaskPlanRow } from './repo/task-plan.js';
import type { DigestService } from './digest-service.js';
import type { TaskPlanService } from './task-plan-service.js';
import type { WorkOwnerInput } from './work-owner-input.js';
import type { TaskPlanAuthorization } from './task-plan.js';
import { taskPlanFingerprint, planAuthorizationScope } from './task-plan-access.js';
import { taskPlanTimeZone } from './task-plan.js';

export class WeixinPlanRefusal extends Error {}

interface ConversationContext { binding: string; authority: string; repos: Repos }
interface Preview {
  id: string; binding: string; authority: string; parent: string; source: WorkOwnerInput; expires: number;
  input: Record<string, unknown>; value: { fingerprint: string; revision?: number; authorization?: TaskPlanAuthorization | null }; create: boolean;
  created?: TaskPlanRow; command?: Record<string, unknown>; result?: unknown;
}
function serviceKind(row: TaskPlanRow) {
  if (row.schedule_spec.at && ['morning', 'evening', 'weekly', 'once'].includes(row.kind)) return 'once';
  if (!row.task_config) return row.kind;
  return ({ 'daily-planning': 'morning', 'digest-morning': 'morning', 'daily-review': 'evening', 'digest-evening': 'evening', 'digest-weekly': 'weekly' })[row.skill];
}
const COMMON_SKILLS = ['daily-planning', 'daily-review', 'digest-morning', 'digest-evening', 'digest-weekly'];
export function weixinPlanAllowed(row: TaskPlanRow): boolean {
  return !row.recycled_at && !row.delete_when_idle && COMMON_SKILLS.includes(row.skill) &&
    ['morning', 'evening', 'weekly', 'once'].includes(String(serviceKind(row))) &&
    (!row.task_config || row.task_config.skillId === `builtin:${row.skill}`) &&
    !!(row.schedule_spec?.at || row.schedule_spec?.daily || row.schedule_spec?.weekly) && !row.schedule_spec?.cron;
}
function remotePlan(row: TaskPlanRow) { return { planId: row.id, title: row.title, status: row.status, revision: row.revision,
  serviceKind: serviceKind(row), skill: row.skill, voice: row.voice, timing: row.schedule_spec,
  timeZone: taskPlanTimeZone(row, 'Asia/Shanghai'), enabled: row.task_config ? row.owner_enabled : row.status === 'active' }; }
function presented(result: any, remote: boolean): any {
  return remote && result?.plan ? { plan: remotePlan(result.plan), repeated: result.repeated === true,
    message: '已保存到原计划；原执行会话、历史及通知目标保留。暂停不代表已停止正在运行的工作。' } : result;
}

/** Conversational admission translates to the panel's services. Preview tokens
 * are deliberately short-lived; durable effects and retries use plan receipts. */
export class PlanConversation {
  private readonly previews = new Map<string, Preview>();
  constructor(private readonly deps: {
    context(): ConversationContext | null; plans: TaskPlanService;
    ownerInput(item: WorkItemRow): Promise<WorkOwnerInput | null>;
    sourceAuthority?(source: WorkOwnerInput): Promise<string>;
    businessResult?(row: TaskPlanRow): Promise<unknown>;
    legacyControl(input: Record<string, unknown>): Promise<unknown>;
    customPreview(input: Record<string, unknown>): ReturnType<DigestService['customPlanPreview']>;
    customCreate(input: Record<string, unknown>, fingerprint: string): ReturnType<DigestService['customPlanCreate']>;
    gate<T>(key: string, work: () => Promise<T>): Promise<T>;
    now?(): number;
  }) {}
  private context() {
    const context = this.deps.context(); if (!context) throw new Error('工作区尚未就绪。'); return context;
  }
  private refusal(item: WorkItemRow | undefined, message: string): Error {
    return item?.origin === 'weixin' || item?.execution_scope?.ownerInput?.kind === 'weixin' ? new WeixinPlanRefusal(message) : new Error(message);
  }
  private async owner(item: WorkItemRow, instruction?: unknown) {
    let context = this.context(); const source = await this.deps.ownerInput(item);
    if (source && this.deps.sourceAuthority) context = { ...context, authority: await this.deps.sourceAuthority(source) };
    if (item.role !== 'reminders' || item.execution_mode === 'skill' || !source || source.authority !== context.authority) throw this.refusal(item, '需要当前工作区已采用的主人输入；后台任务或旧身份不能授权计划变更。');
    if (instruction !== undefined && !source.messages.some(message => message.text === instruction)) throw this.refusal(item, '请逐字引用本次已采用的主人完整消息，不能以模型委派文字代替。');
    return { context, source };
  }
  private async candidates(kind?: unknown, query?: unknown, remote = false) {
    const rows = await this.context().repos.digests.listPlans() as TaskPlanRow[];
    return rows.filter(row => !row.recycled_at && (!remote || weixinPlanAllowed(row)) && (!kind || serviceKind(row) === kind)
      && (!query || row.id === query || row.title.includes(String(query))));
  }
  async list(input: Record<string, unknown>, item?: WorkItemRow) {
    const context = this.context();
    if (item?.origin === 'weixin' || item?.execution_scope?.ownerInput?.kind === 'weixin') {
      const rows = await this.candidates(input.kind, input.planId ?? input.query, true), offset = Number(input.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw this.refusal(item, '计划页码无效。');
      const plans = [];
      for (const row of rows.slice(offset, offset + 20)) plans.push({ ...remotePlan(row),
        blocked: (await context.repos.taskPlans.blocks(row.id)).length > 0,
        recentResult: await this.deps.businessResult?.(row) ?? { message: '当前没有可披露的业务结果。' } });
      return { plans, total: rows.length, offset, limit: 20 };
    }
    const result = await this.deps.plans.list({ query: input.query, offset: input.offset, workspaceBinding: context.binding });
    const { rows, ...page } = result;
    return { ...page, plans: rows.map(row => ({ ...row, planId: row.id, serviceKind: serviceKind(row),
      history: { kind: row.recentRun?.kind ?? (row.task_config ? 'runs' : 'legacy'), planId: row.id, range: 'all' } })) };
  }
  private offer(input: Record<string, unknown>, value: Preview['value'], item: WorkItemRow, source: WorkOwnerInput, create: boolean) {
    const context = this.context(), now = this.deps.now?.() ?? Date.now();
    for (const [key, preview] of this.previews) if (preview.expires < now || preview.binding !== context.binding) this.previews.delete(key);
    if (this.previews.size >= 256) throw this.refusal(item, '待确认预览过多，请先处理已有预览。');
    const id = randomUUID();
    this.previews.set(id, { id, input, value, source, create, binding: context.binding, authority: source.authority!, parent: source.remoteIdentity?.sessionId ?? item.parent_session_id, expires: now + 15 * 60000 });
    const raw = value as Record<string, any>;
    const view = source.kind !== 'weixin' ? value : { ...Object.fromEntries(['planId', 'title', 'revision', 'timeZone', 'voice', 'skill', 'executionMode', 'usesModel', 'nextTimes', 'message', 'messageEn', 'legacy', 'scheduleSpec', 'settings', 'existingPlans'].filter(key => raw[key] !== undefined).map(key => [key, raw[key]])),
      skillId: raw.configuration?.skillId ?? raw.authorization?.skill?.id ?? raw.skill,
      delivery: raw.authorization?.delivery ? { channel: raw.authorization.delivery.channel, target: raw.authorization.delivery.target } : raw.legacyDelivery ?? { channel: 'none' },
      requiredActions: raw.authorization?.skill?.contract?.actions ?? [],
      sources: (raw.authorization?.targets ?? []).map((entry: any) => ({ domain: entry.target.domain, platform: entry.target.platform, sourceId: entry.target.sourceId, capability: entry.capability })) };
    return { ...view, previewId: id, confirmationText: `确认计划 ${id.slice(0, 8)}`, confirmationTextEn: `Confirm plan ${id.slice(0, 8)}`,
      expiresAt: new Date(now + 15 * 60000).toISOString(), pendingConfirmation: true,
      confirmationMessage: '请先向主人展示时间、时区、执行方式、语音、投递目标和权限。主人回复上述确认文字后，调用 digest_control {op:"confirm",previewId,instruction:主人完整原文}。预览未执行写入。' };
  }
  async enable(input: Record<string, unknown>, item: WorkItemRow) {
    const { context, source } = await this.owner(item), kind = String(input.kind ?? 'morning');
    if (!['morning', 'evening', 'weekly', 'once'].includes(kind)) throw this.refusal(item, '计划类型无效。');
    if (source.kind === 'weixin' && (input.skill && !COMMON_SKILLS.includes(String(input.skill).replace(/^builtin:/, '')) || input.channel === 'weixin')) throw this.refusal(item, '微信首版仅能选择常用内置业务计划；微信周期通知尚未开放。');
    const matches = await this.candidates(kind, undefined, source.kind === 'weixin');
    if (matches.length && input.op !== 'new') return { selectionRequired: true, candidates: matches.map(row => ({ planId: row.id, title: row.title, status: row.status, skill: row.skill })),
      message: '已有同类计划，请明确原计划编号后调整或恢复。主人确实要另建一份时，用 digest_enable {op:new} 展示新增预览，再由主人确认。' };
    const draft = await this.deps.plans.draft({ preset: kind, workspaceBinding: context.binding,
      ...(input.title ? { title: input.title } : {}), ...(input.skill ? { skill: ['digest-morning', 'digest-evening', 'digest-weekly', 'daily-planning', 'daily-review'].includes(String(input.skill)) ? `builtin:${input.skill}` : input.skill } : {}),
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
      ...(kind === 'once' ? { at: input.at ?? new Date((this.deps.now?.() ?? Date.now()) + Number(input.afterSeconds ?? 0) * 1000).toISOString() } : {}) });
    const form = { ...draft.form, timing: { ...draft.form.timing as object, ...(input.time ? { time: input.time } : {}), ...(input.weekdays ? { weekdays: input.weekdays } : {}) },
      delivery: { ...draft.configuration.delivery, ...(input.voice === undefined ? {} : { voice: input.voice }), ...(input.channel ? { channel: input.channel } : {}) } };
    const legacyInput = { kind, skill: draft.legacySkillName,
      time: String((form.timing as Record<string, unknown>).time ?? '').replace(/^(\d{2}:\d{2})$/, '$1:00'), weekdays: (form.timing as Record<string, unknown>).weekdays, at: draft.scheduleSpec.at,
      timeZone: draft.configuration.timeZone, voice: form.delivery.voice, intentKey: randomUUID() };
    const custom = await this.deps.customPreview(legacyInput);
    const value = custom ?? await this.deps.plans.creationPreview(form);
    return this.offer({ ...form, ...(custom ? { legacyInput, legacyPlanId: custom.planId } : {}), serviceKind: kind, existingPlanIds: matches.map(row => row.id).sort() },
      { ...value, ...(matches.length ? { existingPlans: matches.map(row => ({ planId: row.id, title: row.title, status: row.status })),
        message: `将额外新建一份计划，现有 ${matches.length} 份同类计划保留。${value.message}` } : {}) }, item, source, true);
  }
  async control(input: Record<string, unknown>, item: WorkItemRow): Promise<unknown> {
    if (input.op === 'confirm') return this.confirm(input, item);
    const { context, source } = await this.owner(item);
    const row = input.planId ? await context.repos.taskPlans.get(String(input.planId)) : null;
    if (source.kind === 'weixin' && (row && !weixinPlanAllowed(row) || !['pause', 'stop', 'resume', 'adjust', 'voice'].includes(String(input.op)))) throw this.refusal(item, '此计划或操作仅能在电脑端管理；微信支持常用计划的时间、启停和语音选择。');
    if (!row) return { selectionRequired: true, candidates: (await this.candidates(input.kind, input.query, source.kind === 'weixin')).map(row => ({ planId: row.id, title: row.title, status: row.status, skill: row.skill })),
      message: '请明确要操作的原计划编号；不会新建、覆盖或猜选同名计划。' };
    const base = { id: row.id, expectedRevision: row.revision, workspaceBinding: context.binding };
    if (input.op === 'pause' || input.op === 'stop') {
      await this.owner(item, input.instruction ?? '');
      const requestId = taskPlanFingerprint([context.binding, source, row.id, input.op]);
      const repeated = await context.repos.taskPlans.ownerChoiceReceipt(`${requestId}:done`);
      if (repeated) return presented({ plan: repeated, repeated: true, workspaceBinding: context.binding }, source.kind === 'weixin');
      return presented(await this.deps.plans.change({ ...base, op: input.op === 'stop' && !row.task_config ? 'stop' : 'pause',
        requestId }), source.kind === 'weixin');
    }
    if (input.op === 'skill') {
      await this.owner(item, input.instruction ?? '');
      return this.deps.legacyControl({ ...input, expectedRevision: row.revision });
    }
    if (input.op === 'resume') return this.offer({ ...base, op: 'enable' }, await this.deps.plans.preview(base), item, source, false);
    if (input.op === 'adjust' || input.op === 'voice') {
      const settings = Object.fromEntries(['time', 'timeZone', 'weekdays', 'at', 'voice'].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
      if (input.afterSeconds !== undefined) settings.at = new Date((this.deps.now?.() ?? Date.now()) + Number(input.afterSeconds) * 1000).toISOString();
      const command = { ...base, settings, op: 'settings' };
      return this.offer(command, await this.deps.plans.settingsPreview(command), item, source, false);
    }
    throw this.refusal(item, '计划操作须为 pause/resume/stop/adjust/voice/skill/confirm。');
  }
  private async confirm(input: Record<string, unknown>, item: WorkItemRow) {
    const { context, source } = await this.owner(item, input.instruction ?? '');
    const preview = this.previews.get(String(input.previewId ?? ''));
    if (!preview || preview.binding !== context.binding || preview.authority !== context.authority
      || preview.parent !== (source.remoteIdentity?.sessionId ?? item.parent_session_id) || preview.expires < (this.deps.now?.() ?? Date.now())) throw this.refusal(item, '预览已过期、重启或工作区／身份已改变，请重新预览。');
    const suffix = preview.id.slice(0, 8);
    if (![ `确认计划 ${suffix}`, `Confirm plan ${suffix}` ].includes(String(input.instruction))
      || !source.messages.some(message => message.text === input.instruction && !preview.source.messages.some(old => old.id === message.id))) throw this.refusal(item, '需要主人在预览后回复该计划的确认文字；模型 confirm 参数或原请求不算确认。');
    return this.deps.gate(`plan-conversation:${context.binding}`, async () => {
      if (preview.result) return presented(preview.result, source.kind === 'weixin');
      if (!preview.create) {
        if (source.kind === 'weixin') {
          const row = await context.repos.taskPlans.get(String(preview.input.id));
          if (!row || !weixinPlanAllowed(row)) throw this.refusal(item, '原计划已不在微信业务范围内，请到电脑端核对。');
        }
        preview.result = await this.deps.plans.change({ ...preview.input, requestId: preview.id, fingerprint: preview.value.fingerprint, confirm: true });
      } else if (preview.input.legacyInput) {
        const ids = (await this.candidates(preview.input.serviceKind, undefined, source.kind === 'weixin')).filter(row => row.id !== preview.input.legacyPlanId).map(row => row.id).sort();
        if (taskPlanFingerprint(ids) !== taskPlanFingerprint(preview.input.existingPlanIds)) throw this.refusal(item, '同类计划已改变，请重新预览，未重复创建。');
        preview.result = await this.deps.customCreate(preview.input.legacyInput as Record<string, unknown>, preview.value.fingerprint);
      } else {
        if (!preview.created) {
          if (taskPlanFingerprint((await this.candidates(preview.input.serviceKind, undefined, source.kind === 'weixin')).map(row => row.id).sort()) !== taskPlanFingerprint(preview.input.existingPlanIds)) throw this.refusal(item, '预览后同类计划已改变，请重新选择或预览，未重复创建。');
          const fresh = await this.deps.plans.creationPreview(preview.input);
          if (fresh.fingerprint !== preview.value.fingerprint) throw this.refusal(item, '预览后配置、Skill 或授权目标已改变，请重新预览。');
          preview.created = (await this.deps.plans.change({ ...preview.input, op: 'save', requestId: `${preview.id}-save` })).plan;
        }
        if (!preview.command) {
          const check = await this.deps.plans.preview({ id: preview.created.id, workspaceBinding: context.binding });
          if (check.revision !== preview.created.revision || !('authorization' in check) || !check.authorization || !preview.value.authorization
            || taskPlanFingerprint(planAuthorizationScope(check.authorization)) !== taskPlanFingerprint(planAuthorizationScope(preview.value.authorization))) {
            throw new Error(`计划 ${preview.created.id} 已保存为暂停；配置或授权目标已改变，请重新预览该计划，未启用。`);
          }
          preview.command = { id: preview.created.id, expectedRevision: check.revision, workspaceBinding: context.binding,
            op: 'enable', requestId: `${preview.id}-enable`, fingerprint: check.fingerprint, confirm: true };
        }
        try { preview.result = await this.deps.plans.change(preview.command); }
        catch (error) { throw new Error(`计划 ${preview.created.id} 已保存；启用尚未确认，请在原计划核对，勿重复创建。${(error as Error).message}`); }
      }
      return presented(preview.result, source.kind === 'weixin');
    });
  }
}
