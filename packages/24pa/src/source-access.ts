import type { PaConfig } from './config.js';
import type { SourceRegistration } from './source-config.js';
import { unknownCapabilities, type SourceEvidence, type SourceIdentity } from './source-registry.js';
import { wecomWallTime } from './wecom.js';

interface SourceAccessDeps {
  config(): PaConfig;
  lark(args: string[]): Promise<{ data: any }>;
  wecom(args: string[]): Promise<{ data: any; raw: unknown }>;
}

/** Read-only, versioned adapter evidence. Resource roles never replace object-level checks. */
export class SourceAccess {
  constructor(private readonly deps: SourceAccessDeps) {}
  async check(source: SourceRegistration): Promise<SourceEvidence> {
    const result: SourceEvidence = { checkedAt: new Date().toISOString(), state: 'pending', identity: null, resource: null, capabilities: unknownCapabilities(), message: '尚未核验' };
    if (!source.resourceId) return { ...result, message: '请先补齐资源标识。' };
    return source.platform === 'feishu' ? this.feishu(source, result) : this.wecom(source, result);
  }

  private async feishu(source: SourceRegistration, result: SourceEvidence): Promise<SourceEvidence> {
    const { data: auth } = await this.deps.lark(['auth', 'status', '--verify']);
    const user = auth?.identities?.user;
    if (auth?.verified !== true || user?.tokenStatus !== 'valid' || !user?.openId || user.openId !== this.deps.config().ownerOpenId
      || (source.ownerId && source.ownerId !== user.openId) || typeof auth?.appId !== 'string' || !auth.appId) throw new Error('固定飞书 profile 的应用、有效用户令牌与主人身份尚未核验一致。');
    const identity: SourceIdentity = { platform: 'feishu', ownerId: user.openId, authority: `app:${auth.appId}` };
    if (source.resourceKind === 'calendar') {
      let resourceId = source.resourceId;
      if (resourceId === 'primary') {
        const { data } = await this.deps.lark(['calendar', 'calendars', 'primary', '--as', 'user', '--user-id-type', 'open_id']);
        const matches = Array.isArray(data?.calendars) ? data.calendars.filter((row: any) => row.user_id === identity.ownerId && typeof row.calendar?.calendar_id === 'string' && row.calendar.calendar_id) : [];
        if (matches.length !== 1) throw new Error('主日历未解析为唯一的本人日历，请核对实际日历 ID。');
        resourceId = matches[0].calendar.calendar_id;
      }
      const { data } = await this.deps.lark(['calendar', 'calendars', 'get', '--as', 'user', '--calendar-id', resourceId]);
      if (data?.calendar_id !== resourceId || data?.is_deleted === true) throw new Error('日历标识不符或该身份已删除此日历。');
      const role = String(data?.role ?? 'unknown');
      const readable = ['reader', 'writer', 'owner'].includes(role), writable = ['writer', 'owner'].includes(role) && data.is_third_party !== true;
      return { ...result, state: 'verified', identity, resource: { kind: 'calendar', id: resourceId }, role,
        capabilities: { ...result.capabilities, read: readable ? 'allowed' : 'denied', create: writable ? 'allowed' : 'denied',
          update: writable ? 'allowed' : 'denied', cancel: writable ? 'allowed' : 'denied', reminders: writable ? 'allowed' : 'unknown', series: writable ? 'allowed' : 'unknown' },
        message: `${readable ? '日历详情可读' : role === 'free_busy_reader' ? '仅可查看忙闲，不能读取完整日程' : '日历访问权限待确认'}；${writable ? '当前资源角色允许写入，具体日程仍须核验影响范围及实际回执' : '未取得日历写入权限'}。` };
    }
    if (source.resourceKind === 'tasklist') {
      const { data } = await this.deps.lark(['task', 'tasklists', 'get', '--as', 'user', '--tasklist-guid', source.resourceId, '--user-id-type', 'open_id']);
      const list = data?.tasklist;
      if (list?.guid !== source.resourceId) throw new Error('任务清单回执缺少匹配的真实 GUID。');
      const owner = list.owner?.type === 'user' && list.owner.id === identity.ownerId;
      const member = Array.isArray(list.members) ? list.members.find((row: any) => row.type === 'user' && row.id === identity.ownerId) : undefined;
      const writable = !Number(list.archive_msec ?? 0) && (owner || member?.role === 'editor');
      return { ...result, state: 'verified', identity, resource: { kind: 'tasklist', id: list.guid }, role: owner ? 'owner' : member?.role ?? 'unknown',
        capabilities: { ...result.capabilities, read: 'allowed', create: writable ? 'allowed' : 'unknown' },
        message: '清单详情可读；清单协作权限与每项待办的负责人、完成和删除权限分别核验。' };
    }
    if (source.domain === 'todo' && source.resourceKind === 'authorized_scope' && source.resourceId === 'authorized') {
      await this.deps.lark(['task', '+get-related-tasks', '--as', 'user', '--include-complete', '--page-limit', '1']);
      return { ...result, state: 'verified', identity, resource: { kind: 'authorized_scope', id: 'authorized' }, role: 'related_tasks',
        capabilities: { ...result.capabilities, read: 'allowed', create: 'attemptable' },
        message: '本人相关待办接口可读；创建权限尚未核验，仅可按明确授权尝试，平台拒绝须如实报告；以实际返回的创建、负责和关注关系为准，不等同于企业全部待办。' };
    }
    return { ...result, identity, capabilities: { ...result.capabilities, read: 'adapter_unavailable' }, message: '当前飞书适配器尚未接通该授权范围类型，请登记具体日历或清单。' };
  }

  private async wecom(source: SourceRegistration, result: SourceEvidence): Promise<SourceEvidence> {
    if (source.resourceKind !== 'authorized_scope' || source.resourceId !== 'authorized') return { ...result,
      capabilities: Object.fromEntries(Object.keys(result.capabilities).map(key => [key, 'adapter_unavailable'])) as SourceEvidence['capabilities'],
      message: '当前固定版本企微 CLI 未暴露指定日历／清单容器的参数；需核验对应接口和授权，不能将此容器伪装为授权范围。' };
    const response = await this.deps.wecom(['identity', 'whoami']);
    const raw = response.raw as { extra_identity_context?: unknown };
    const context = String(raw?.extra_identity_context ?? response.data?.extra_identity_context ?? '').replace(/\s+/g, ' ');
    const bot = /机器人身份：\s*名字：.+?\s*ID：([A-Za-z0-9_-]+)/.exec(context);
    const person = /授权真人用户身份：\s*名字：.+?\s*ID：([A-Za-z0-9_-]+)/.exec(context);
    if (!bot || !person || (source.ownerId && source.ownerId !== person[1])) throw new Error('企微机器人和授权真人身份未核验一致，请重新检查接入。');
    const identity: SourceIdentity = { platform: 'wecom', ownerId: person[1]!, authority: `bot:${bot[1]}` };
    const now = new Date(), end = new Date(now.getTime() + 60_000), zone = this.deps.config().timeZone;
    await this.deps.wecom(source.domain === 'calendar'
      ? ['calendar', 'schedules', 'list', '--begin-time', wecomWallTime(now, zone), '--end-time', wecomWallTime(end, zone)]
      : ['todo', 'list', '--status-filter', '["proceed"]', '--limit', '1']);
    return { ...result, state: 'verified', identity, resource: { kind: 'authorized_scope', id: 'authorized' }, role: 'authorized_scope',
      capabilities: { ...result.capabilities, read: 'allowed', create: 'attemptable' },
      message: '当前真人授权范围可读；创建权限尚未核验，仅可按明确授权尝试，平台拒绝须如实报告，实际写入以回执为准。此范围不是可指定的公司／项目日历容器，既有对象覆盖和逐项角色须另行核验。' };
  }
}
