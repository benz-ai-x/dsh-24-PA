import type { PaConfig } from './config.js';
import { effectiveSources } from './source-config.js';
import type { AccessDiagnostics } from './feishu.js';
import type { WecomDiagnostics } from './wecom-channels.js';
import type { SourceRegistry } from './source-registry.js';
import type { HealthRepo, HealthEvidence, HealthState } from './repo/health.js';
import type { NewOutbox, OutboxRepo } from './repo/outbox.js';
import { hash } from './util.js';
import { wecomWallTime } from './wecom.js';
import { redactDiagnostic } from './diagnostic-redaction.js';

export const HEALTH_SCOPES = ['workspace', 'feishu', 'wecom', 'sources', 'materials', 'memory', 'skills', 'plans', 'models', 'voice', 'backup'] as const;
export type HealthScope = typeof HEALTH_SCOPES[number];
interface HealthDeps {
  repo(): HealthRepo; outbox(): OutboxRepo; config(): PaConfig; version(): string; registry: SourceRegistry;
  feishu(): Promise<AccessDiagnostics>; wecom(): Promise<WecomDiagnostics>;
  local(scope: HealthScope): Promise<{ state: HealthState; coverage: string; message: string; impact: string; nextSteps: string[]; detail?: unknown }>;
  notify(key: string, body: string): Promise<NewOutbox | null>; silentUntil(): Promise<Date | null>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>; now?(): Date;
  sanitize?<T>(value: T): T;
}

/** Checks have bounded, declared coverage. Reading this module never probes a platform. */
export class ConnectionHealth {
  constructor(private readonly deps: HealthDeps) {}
  private now(): Date { return this.deps.now?.() ?? new Date(); }
  private safe<T>(value: T): T { return this.deps.sanitize?.(value) ?? redactDiagnostic(value); }
  async snapshot() {
    const version = this.deps.version(), records = await this.deps.repo().latest(), identity = await this.deps.repo().identity('wecom');
    const identities = { wecom: identity, feishu: await this.deps.repo().identity('feishu') };
    const current = (row: HealthEvidence) => {
      const platform = row.scope.split('.')[0] as keyof typeof identities, owner = identities[platform];
      return row.configVersion === version && (!owner || row.state === 'fault' || row.state === 'no_activity' || row.state === 'unchecked' ||
        (!owner.changed && Date.parse(row.checkedAt) >= Math.max(new Date(owner.accepted_at).getTime(), new Date(owner.observed_at).getTime())));
    };
    for (const scope of ['feishu.receive', 'feishu.send', 'feishu.review-callback']) if (!records.some(row => row.scope === scope)) records.push({ scope, state: 'no_activity', configVersion: version,
      checkedAt: '', coverage: '当前工作区自证据功能启用后未留下合格事件', message: '尚无合格活动证据；无活动不等于故障。', impact: '尚不能证明此端到端链路可用。', nextSteps: [scope.endsWith('receive') ? '本人在飞书私聊发送 /24pa。' : scope.endsWith('callback') ? '在真实待审版本的飞书审核卡上完成一次批准或退回。' : '明确触发发送测试，或查看正常业务投递回执。'] });
    for (const scope of HEALTH_SCOPES) if (!records.some(row => row.scope === scope)) records.push({ scope, state: 'unchecked', configVersion: version, checkedAt: '',
      coverage: '尚未主动检查此范围', message: '未检查，不代表可用或故障。', impact: '尚无本范围的检查证据。', nextSteps: ['选择此范围执行只读检查。'] });
    const monitor = await this.deps.repo().monitor('wecom');
    return this.safe({ configVersion: version, readAt: this.now().toISOString(), scopes: HEALTH_SCOPES,
      evidence: records.map(row => current(row) ? row : { ...row, previousState: row.state, state: 'stale',
        message: `旧配置证据已过期：${row.message}`, nextSteps: ['对当前生效配置重新核验。'] }),
      traffic: { ...(await this.deps.repo().traffic()), coverage: '当前工作区完整持久账本，按渠道与状态分组；历史集合不证明当前配置可用，拒绝入站另列。' },
      monitor: monitor ? { ...monitor, delivery: monitor.notificationKey ? await this.deps.repo().monitorDelivery(monitor.notificationKey) : null } : null, identity,
      tests: await this.deps.repo().tests(), testCoverage: '最近 100 次明确触发的测试；不代表全部业务历史。' });
  }
  async check(scopes: string[] = [...HEALTH_SCOPES], observed: { feishu?: AccessDiagnostics; wecom?: WecomDiagnostics } = {}) {
    if (!scopes.length || scopes.some(scope => !(HEALTH_SCOPES as readonly string[]).includes(scope))) throw new Error('未知健康检查范围。');
    return this.deps.gate('health-check', async () => {
      const configVersion = this.deps.version(), records: HealthEvidence[] = [];
      const save = async (scope: string, value: Omit<HealthEvidence, 'scope' | 'checkedAt' | 'configVersion'>) => {
        if (configVersion !== this.deps.version()) throw new Error('检查期间配置已改变，本次结果未用于新配置。');
        const row = this.safe({ scope, configVersion, checkedAt: this.now().toISOString(), ...value });
        await this.deps.repo().save(row); records.push(row);
      };
      for (const scope of [...new Set(scopes)] as HealthScope[]) {
        try {
          if (scope === 'feishu') {
            if (this.deps.config().mode !== 'feishu') {
              await save(scope, { state: 'disabled', coverage: '接入模式', message: '体验模式未启用真实飞书接入', impact: '不核验真实收发和资源。', nextSteps: ['需要真实能力时，在参数配置中配置飞书接入并重验。'] }); continue;
            }
            const result = observed.feishu ?? await this.deps.feishu();
            for (const [id, value] of [['cli', result.cli], ['identity', result.auth], ['config', result.source], ...(result.resources ?? []).map(row => [`resource:${row.id}`, row])] as Array<[string, any]>) {
              const state: HealthState = value?.state === 'ok' ? 'verified' : ['error', 'mismatch'].includes(value?.state) ? 'fault' : value?.state === 'missing' && id === 'resource:wiki' ? 'disabled' : 'unverified';
              await save(`feishu.${id}`, { state, coverage: id.startsWith('resource:') ? '指定资源只读接口；写入须独立实际测试或业务回执' : `固定 profile 的 ${id} 核验`, message: value?.message ?? '未取得证据', impact: state === 'fault' ? '仅依赖本项的飞书能力受阻。' : '不替代消息发送、入站或审核回调证据。', nextSteps: result.nextSteps, detail: value });
            }
            await save('feishu.application', { state: result.auth.applicationMatched === true ? 'verified' : result.auth.applicationMatched === false && result.auth.appId ? 'fault' : 'unverified',
              coverage: '固定 profile 实际应用标识与当前接入应用比较', message: result.auth.appId ? `实际应用：${result.auth.appId}` : '授权返回未包含实际应用标识',
              impact: '应用不一致时不能把 CLI 与机器人收发归为同一接入。', nextSteps: result.nextSteps });
            // The user token's tenant is independent from the app and owner.
            // An inbound event can later provide separate transport evidence.
            await save('feishu.enterprise', { state: result.auth.state === 'ok' && result.auth.tenantKey ? 'verified' : 'unverified',
              coverage: '当前用户授权返回的实际企业标识；不推断平台未返回的字段', message: result.auth.tenantKey ? `实际企业：${result.auth.tenantKey}` : 'CLI 授权未返回企业标识，仍需通过真实入站企业证据核对。',
              impact: '企业归属未验证时，连接已启动不等于全部身份边界通过。', nextSteps: ['核对接入应用所属企业，并由主人发送一条真实私聊取得入站企业证据。'] });
            await save(scope, { state: result.auth.state === 'ok' ? records.some(row => row.scope.startsWith('feishu.') && ['fault', 'unverified'].includes(row.state)) ? 'partial' : 'verified' : ['error', 'mismatch'].includes(String(result.auth.state)) ? 'fault' : 'unverified', coverage: 'CLI、主人/应用身份、用户授权与已配置资源的只读接口', message: '飞书只读检查完成；不包含真实消息、审核回调或资源写入。', impact: '逐项状态决定对应能力；连接启动不等于端到端通过。', nextSteps: result.nextSteps });
          } else if (scope === 'wecom') {
            const enabled = this.deps.config().mode === 'feishu' && (effectiveSources(this.deps.config()).entries.some(row => row.platform === 'wecom' && row.enabled) || this.deps.config().notifyChannel === 'wecom');
            if (!enabled) { await save(scope, { state: 'disabled', coverage: '已启用企微能力', message: '尚未启用企微来源或推送', impact: '企微不接收聊天消息。', nextSteps: [] }); continue; }
            const result = observed.wecom ?? await this.deps.wecom();
            for (const service of result.services) await save(`wecom.${service.id}`, { state: service.state === 'ok' ? 'verified' : service.state === 'skipped' ? 'disabled' : service.state === 'unverified' ? 'unverified' : 'fault', coverage: service.id === 'push' ? '当前真人和机器人绑定；不包含实际发送' : `${service.id === 'calendar' ? '日程' : '待办'}服务授权只读接口`, message: service.message, impact: `仅 ${service.id} 域受此结果影响；不解除其他等待或暂停。`, nextSteps: service.helpMessage ? [service.helpMessage] : result.nextSteps });
            await save('wecom.identity', { state: result.identity.state === 'ok' ? 'verified' : 'fault', coverage: '授权真人与机器人实际标识', message: result.identity.message, impact: '身份不一致时阻断按旧身份的操作与投递。', nextSteps: result.nextSteps, detail: result.identity });
            const faults = result.services.filter(row => !['ok', 'skipped', 'unverified'].includes(row.state));
            await save(scope, { state: result.cli.state !== 'ok' || result.identity.state !== 'ok' ? 'fault' : faults.length || result.services.some(row => row.state === 'unverified') ? 'partial' : 'verified', coverage: 'CLI、绑定身份、已启用域的只读授权核验', message: '企微只读检查完成；推送与写入尚需各自回执。', impact: '各域独立；通知失败不切换渠道。', nextSteps: result.nextSteps });
          } else if (scope === 'sources') {
            const sources = effectiveSources(this.deps.config()).entries;
            for (const source of sources) {
              const proof = source.enabled ? await this.deps.registry.check(source.id) : null;
              await save(`source:${source.id}`, { state: !source.enabled ? 'disabled' : proof?.state === 'verified' ? 'verified' : proof?.state === 'failed' ? 'fault' : 'unverified', coverage: `${source.domain} · ${source.platform} · ${source.name}；读/写授权逐项证据，不创建对象`, message: proof?.message ?? '来源已停用', impact: '仅此登记来源受影响，其他已核验来源可用。', nextSteps: source.enabled ? ['在参数配置核对这份来源，修复后单独核验。'] : [], detail: proof });
            }
            await save(scope, { state: sources.length ? records.some(row => row.scope.startsWith('source:') && ['fault', 'unverified'].includes(row.state)) ? 'partial' : 'verified' : 'disabled', coverage: '全部登记来源（包括停用项）；结论见逐来源行', message: `已覆盖 ${sources.length} 份来源`, impact: '默认来源变更不修改旧计划或对象绑定。', nextSteps: [] });
          } else await save(scope, await this.deps.local(scope));
        } catch (error) {
          await save(scope, { state: 'fault', coverage: `${scope} 本次检查未完整完成`, message: String((error as Error).message).slice(0, 500), impact: '读取失败不等于零条数据；未覆盖能力不宣称通过。', nextSteps: ['保留当前配置，修复该项后重试。'] });
        }
      }
      return { checkedAt: this.now().toISOString(), configVersion, requestedScopes: scopes, evidence: records,
        excluded: ['真实消息发送', '资源创建/修改', '模型试用', '听记资料读取', '远端完整备份与设备提醒验收'] };
    });
  }
  async monitorWecom(): Promise<void> {
    return this.deps.gate('health-monitor:wecom', async () => {
      const config = this.deps.config(), now = this.now(), version = this.deps.version(), repo = this.deps.repo();
      if (config.mode !== 'feishu' || !effectiveSources(config).entries.some(row => row.enabled && row.platform === 'wecom') && config.notifyChannel !== 'wecom') return;
      const previous = await repo.monitor('wecom');
      let state = previous;
      if (!state || state.configVersion !== version || now.getTime() - Date.parse(state.checkedAt) >= 6 * 3600_000) {
        const report = await this.check(['wecom']);
        const faults = report.evidence.filter(row => row.state === 'fault');
        state = { ...previous, checkedAt: now.toISOString(), configVersion: version, problem: faults.length ? hash(JSON.stringify(faults.map(row => [row.scope, row.state, row.message]))) : null,
          faults, notificationError: null, silentUntil: null };
        await repo.saveMonitor('wecom', state);
      }
      if (!state.problem) return;
      const day = wecomWallTime(now, config.timeZone).slice(0, 10);
      if (state.notifiedDay === day) return;
      const silentUntil = await this.deps.silentUntil();
      if (silentUntil && silentUntil > now) { await repo.saveMonitor('wecom', { ...state, silentUntil: silentUntil.toISOString() }); return; }
      try {
        const key = `health-wecom:${day}`;
        const notice = await this.deps.notify(key, `企业微信接入需要处理：\n${state.faults.map((row: HealthEvidence) => `${row.scope}：${row.message}\n${row.nextSteps.join('\n')}`).join('\n')}\n请在接入卡核验。原交办、待发及计划继续保留原归属。`);
        if (!notice) throw new Error('当前通知渠道没有可用主人目标；请在面板处理告警。');
        await this.deps.outbox().enqueue(notice);
        await repo.saveMonitor('wecom', { ...state, notifiedDay: day, notifiedProblem: state.problem, notificationKey: key, notificationChannel: notice.channel, notificationError: null, silentUntil: null });
      } catch (error) { await repo.saveMonitor('wecom', { ...state, notificationError: this.safe(String((error as Error).message)).slice(0, 500) }); }
    });
  }
}
