import type { PaConfig } from './config.js';
import type { SourceRegistry, SourceTarget, SourceIdentity } from './source-registry.js';
import { effectiveSources } from './source-config.js';
import type { HealthRepo } from './repo/health.js';
import { hash } from './util.js';
import { wecomWallTime } from './wecom.js';
import { redactDiagnostic } from './diagnostic-redaction.js';

interface TestDeps {
  config(): PaConfig; version(): string; repo(): HealthRepo; registry: SourceRegistry;
  assertBinding(value: unknown): void; gate<T>(key: string, work: () => Promise<T>): Promise<T>;
  wecomIdentity(): Promise<SourceIdentity>; feishuIdentity(): Promise<void>;
  send(platform: 'feishu' | 'wecom', target: string, body: string, key: string): Promise<{ messageId: string }>;
  lark(args: string[]): Promise<{ data: any }>; wecom(args: string[]): Promise<{ data: any }>;
  sanitize?<T>(value: T): T;
}
const unknown = (message: string) => Object.assign(new Error(message), { outcome: 'unknown' });
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = (value: unknown) => hash(JSON.stringify(canonical(value)));

/** Deliberate diagnostic writes have their own durable intent and fixed targets.
 * They never run during inspection, never retry an unknown result, and never
 * turn a successful probe into general business authority. */
export class ConnectionTests {
  constructor(private readonly deps: TestDeps) {}
  private safe<T>(value: T): T { return this.deps.sanitize?.(value) ?? redactDiagnostic(value); }
  async preview(input: Record<string, unknown>) {
    this.deps.assertBinding(input.workspaceBinding);
    if (this.deps.config().mode !== 'feishu') throw new Error('体验模式不执行真实平台测试。');
    const action = String(input.action ?? '');
    if (!['feishu.send', 'wecom.push', 'source.create'].includes(action)) throw new Error('未知接入测试动作。');
    let target: string | SourceTarget, platform: 'feishu' | 'wecom', domain: string, identity: SourceIdentity | undefined;
    if (action === 'source.create') {
      const source = effectiveSources(this.deps.config()).entries.find(row => row.id === input.sourceId);
      if (!source || !source.enabled || source.access !== 'readwrite') throw new Error('请选择已启用、本人允许写入的登记来源。');
      target = await this.deps.registry.bind(source.domain, { sourceId: source.id }, 'read');
      platform = source.platform; domain = source.domain;
    } else if (action === 'wecom.push') {
      if (this.deps.config().notifyChannel !== 'wecom') throw new Error('企微推送尚未启用。');
      identity = await this.deps.wecomIdentity(); target = identity.ownerId; platform = 'wecom'; domain = 'push';
    } else {
      await this.deps.feishuIdentity();
      target = this.deps.config().ownerOpenId; platform = 'feishu'; domain = 'send';
      if (!target) throw new Error('尚未核验主人目标。');
    }
    const plan = { action, platform, domain, target, ...(identity ? { identity } : {}), configVersion: this.deps.version(),
      description: action === 'source.create' ? domain === 'calendar' ? '创建一条带唯一测试标识的五分钟个人日程，不邀请他人、不设置提醒；不改变已有日程。' : '创建一项带唯一测试标识的本人测试待办，无截止提醒；不修改已有待办。' : '只向已核验主人发送一条明确标为测试的文字消息。',
      cost: '不调用模型；平台或网络可能按账号套餐收费，本地不掌握账单。',
      residue: action === 'source.create' ? '平台会留下测试对象；创建成功后可单独确认清理，未知结果先到原平台核对。' : '聊天中保留测试消息；本版本不提供撤回，请在原平台手工处理。' };
    return { plan, fingerprint: fingerprint(plan) };
  }
  async execute(input: Record<string, unknown>) {
    this.deps.assertBinding(input.workspaceBinding);
    if (input.confirm !== true || !/^[A-Za-z0-9_-]{16,100}$/.test(String(input.requestId ?? ''))) throw new Error('需明确确认测试并携带稳定请求标识。');
    const id = String(input.requestId), plan = input.plan as Record<string, any>;
    if (!plan || input.fingerprint !== fingerprint(plan)) throw new Error('测试内容已变化，请重新预览。');
    return this.deps.gate(`connection-test:${id}`, async () => {
      this.deps.assertBinding(input.workspaceBinding);
      const existing = await this.deps.repo().test(id);
      if (existing) {
        if (existing.request_hash !== input.fingerprint) throw new Error('测试标识已用于不同内容。');
        return { ...existing, replayed: true, message: '返回原测试记录；未重复执行。运行中或未知结果请先核对原目标。' };
      }
      if (plan.configVersion !== this.deps.version()) throw new Error('配置或身份已变更，请重新预览测试目标。');
      await this.validateTarget(plan);
      const start = new Date(Date.now() + 24 * 3600_000), end = new Date(start.getTime() + 5 * 60_000);
      const { row } = await this.deps.repo().prepareTest(id, String(input.fingerprint), this.deps.version(), { ...plan,
        parameters: { title: `[24私助接入测试 ${id}]`, start: start.toISOString(), end: end.toISOString(), timeZone: this.deps.config().timeZone } });
      // The intent survives a lost response or a process restart. A running
      // record is an unresolved attempt, never a reason to invoke it again.
      await this.deps.repo().updateTest(id, 'running', { message: '已记录意图，正在提交平台；中断后先核对，不自动重试。' });
      try {
        const result = await this.invoke(id, row.plan);
        const saved = await this.deps.repo().updateTest(id, 'succeeded', { ...result, platformAccepted: true, acceptedAt: new Date().toISOString(), residue: plan.residue });
        try { await this.deps.repo().save({ scope: `${plan.platform}.${plan.domain}.write-test`, state: 'verified', configVersion: row.config_version,
          checkedAt: new Date().toISOString(), coverage: `单次明确测试，仅覆盖此目标：${typeof plan.target === 'string' ? plan.target : plan.target.sourceId}`,
          message: '平台已接纳测试；不代表主人已读、设备提醒送达或其他资源可写。', impact: '不扩大业务授权，不解除计划的其他阻断。', nextSteps: ['核对测试结果及残留；资源测试完成后可清理。'], detail: { testId: id, ...result } });
        } catch (error) {
          // A secondary health projection failure must never erase the known
          // platform receipt or tempt the owner into repeating the write.
          return { ...saved, evidenceError: this.safe(String((error as Error).message).slice(0, 500)) };
        }
        return saved;
      } catch (error) {
        const state = (error as { outcome?: string }).outcome === 'failed' ? 'failed' : 'unknown';
        return this.deps.repo().updateTest(id, state, { message: this.safe(String((error as Error).message)).slice(0, 500), residue: state === 'unknown' ? '原平台可能已有对象或消息；请按测试标识核对，不能盲目重试。' : '平台明确拒绝；未确认产生对象。' });
      }
    });
  }
  async cleanup(input: Record<string, unknown>) {
    this.deps.assertBinding(input.workspaceBinding);
    if (input.confirm !== true) throw new Error('请明确确认清理这个测试对象。');
    const id = String(input.testId ?? '');
    return this.deps.gate(`connection-test:${id}`, async () => {
      const row = await this.deps.repo().test(id);
      if (!row || row.plan.action !== 'source.create' || row.status !== 'succeeded' || !row.result?.nativeId) throw new Error('没有可安全清理的已知测试对象；未知结果需先在原平台核对。');
      if (row.cleanup) return { ...row, message: '保留原清理记录，未重做；未知状态请在原平台核对。' };
      await this.validateTarget(row.plan, false);
      const target = row.plan.target as SourceTarget, nativeId = row.result.nativeId;
      await this.deps.repo().cleanupTest(id, { state: 'running', target, nativeId, startedAt: new Date().toISOString() });
      try {
        if (target.platform === 'feishu') await this.deps.lark(target.domain === 'calendar'
          ? ['calendar', 'events', 'delete', '--as', 'user', '--calendar-id', target.resource.id, '--event-id', nativeId]
          : ['task', 'tasks', 'delete', '--as', 'user', '--task-guid', nativeId]);
        else if (target.domain === 'calendar') await this.deps.wecom(['calendar', 'schedules', 'cancel', '--json', JSON.stringify({ schedule_id: nativeId })]);
        else {
          const { data } = await this.deps.wecom(['todo', 'delete', '--items', JSON.stringify([{ todo_id: nativeId }])]);
          if (data?.items?.length !== 1 || data.items[0]?.todo_id !== nativeId || data.items[0]?.success !== true) throw unknown('清理回执无法对应原测试待办，请在原平台核对。');
        }
        return this.deps.repo().cleanupTest(id, { state: 'accepted', nativeId, at: new Date().toISOString(), message: '平台已接纳清理；原测试回执保留。请在原平台核对对象状态。' });
      } catch (error) { return this.deps.repo().cleanupTest(id, { state: (error as { outcome?: string }).outcome === 'failed' ? 'failed' : 'unknown', nativeId, at: new Date().toISOString(), message: this.safe((error as Error).message).slice(0, 500) }); }
    });
  }
  private async validateTarget(plan: Record<string, any>, creating = true): Promise<void> {
    if (plan.action === 'source.create') {
      const source = effectiveSources(this.deps.config()).entries.find(row => row.id === plan.target?.sourceId);
      if (source?.access !== 'readwrite') throw new Error('原来源已停止允许写入。');
      if (plan.target.domain !== source.domain || plan.target.platform !== source.platform || plan.domain !== source.domain || plan.platform !== source.platform) throw new Error('测试域或平台与已登记目标不符。');
      const proof = await this.deps.registry.verify(plan.target, 'read');
      if (creating && ['denied', 'adapter_unavailable'].includes(proof.capabilities.create)) throw new Error('已知该来源不允许创建或适配器尚未提供创建能力，不能执行写入测试。');
    } else if (plan.action === 'wecom.push') {
      if (plan.platform !== 'wecom' || plan.domain !== 'push' || this.deps.config().notifyChannel !== 'wecom') throw new Error('企微推送测试范围无效。');
      const identity = await this.deps.wecomIdentity();
      if (identity.ownerId !== plan.target || !plan.identity || fingerprint(identity) !== fingerprint(plan.identity)) throw new Error('企微当前真人或机器人与原测试目标不符，请重新预览。');
    } else if (plan.action === 'feishu.send') {
      if (plan.platform !== 'feishu' || plan.domain !== 'send') throw new Error('飞书发送测试范围无效。');
      await this.deps.feishuIdentity();
      if (this.deps.config().ownerOpenId !== plan.target) throw new Error('飞书主人目标已改变。');
    } else throw new Error('未知测试动作。');
  }
  private async invoke(id: string, plan: Record<string, any>): Promise<Record<string, unknown>> {
    const title = plan.parameters.title;
    if (plan.action !== 'source.create') {
      const receipt = await this.deps.send(plan.platform, plan.target, `${title}\n这是一条由你明确触发的接入测试消息，无需回复。`, `health-test:${id}`);
      if (!receipt.messageId) throw unknown('未返回消息接纳回执。');
      return { target: plan.target, deliveryId: receipt.messageId, nativeMessageId: plan.platform === 'feishu' ? receipt.messageId : null,
        message: plan.platform === 'feishu' ? '飞书已接纳消息，主人已读状态未知。' : '企微平台已接纳消息；CLI 未返回原生消息 ID，本地投递标识单独列示。' };
    }
    const target = plan.target as SourceTarget, start = new Date(plan.parameters.start), end = new Date(plan.parameters.end), timeZone = plan.parameters.timeZone;
    let nativeId: string | undefined, raw: any;
    if (target.domain === 'calendar') {
      if (target.platform === 'feishu') {
        const time = (value: Date) => ({ timestamp: String(Math.floor(value.getTime() / 1000)), timezone: timeZone });
        const key = hash(id), uuid = `${key.slice(0, 8)}-${key.slice(8, 12)}-5${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`;
        raw = (await this.deps.lark(['calendar', 'events', 'create', '--as', 'user', '--calendar-id', target.resource.id, '--idempotency-key', uuid,
          '--data', JSON.stringify({ summary: title, start_time: time(start), end_time: time(end), reminders: [] })])).data;
        nativeId = raw?.event?.event_id ?? raw?.event_id;
      } else {
        raw = (await this.deps.wecom(['calendar', 'schedules', 'create', '--subject', title, '--begin-time', wecomWallTime(start, timeZone), '--end-time', wecomWallTime(end, timeZone),
          '--timezone', JSON.stringify({ timezone_id: timeZone }), '--reminders', JSON.stringify({ is_remind: false, reminder_time: [] })])).data;
        nativeId = raw?.schedule_id;
      }
    } else if (target.platform === 'feishu') {
      raw = (await this.deps.lark(['task', 'tasks', 'create', '--as', 'user', '--user-id-type', 'open_id', '--data', JSON.stringify({ summary: title, client_token: hash(id),
        members: [{ id: target.identity.ownerId, type: 'user', role: 'assignee' }], ...(target.resource.kind === 'tasklist' ? { tasklists: [{ tasklist_guid: target.resource.id }] } : {}) })])).data;
      nativeId = raw?.task?.guid;
    } else {
      raw = (await this.deps.wecom(['todo', 'create', '--items', JSON.stringify([{ title, follower_ids: [target.identity.ownerId] }])])).data;
      if (raw?.items?.length !== 1 || raw.items[0]?.success !== true) throw unknown('企微测试待办未返回唯一成功对象，请先核对。');
      nativeId = raw.items[0]?.todo_id;
    }
    if (typeof nativeId !== 'string' || !nativeId) throw unknown('平台回执没有真实测试对象标识；请按唯一测试标题核对。');
    return { sourceId: target.sourceId, identity: target.identity, resource: target.resource, nativeId, title,
      ...(target.domain === 'calendar' ? { start: start.toISOString(), end: end.toISOString(), timeZone } : {}),
      url: raw?.event?.app_link ?? raw?.task?.url ?? null, message: '平台已接纳测试对象；可到原平台核对，不将接纳冒充完整业务验收。' };
  }
}
