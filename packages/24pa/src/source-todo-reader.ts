import type { SourceTarget } from './source-registry.js';
import type { ObservedSourceItem, SourceObservation } from './repo/source-projection.js';
import { wecomObservedWallTime } from './wecom.js';

export interface TodoPerson { id: string; name: string; state?: string }
interface TodoReaderDeps {
  timeZone(): string;
  lark(args: string[]): Promise<{ data: any }>;
  wecom(args: string[]): Promise<{ data: any }>;
}
const query = { from: null, to: null };
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const clean = (value: unknown): string => string(value).replace(/^\[24PA\] /, '');

/** Native roles are mapped by each platform's contract, never by field-name
 * similarity. WeCom followers are assignees with completion states, not the
 * Feishu follower role. Missing evidence remains visible to role queries. */
export class SourceTodoReader {
  constructor(private readonly deps: TodoReaderDeps) {}

  async read(target: SourceTarget): Promise<SourceObservation> {
    const items = new Map<string, ObservedSourceItem>(), reasons: string[] = [];
    const cursors = new Set<string>();
    let cursor = '';
    try {
      for (let page = 0; page < 1000; page++) {
        const response = target.platform === 'feishu'
          ? await this.deps.lark(target.resource.kind === 'tasklist'
            ? ['task', 'tasklists', 'tasks', '--as', 'user', '--tasklist-guid', target.resource.id, '--user-id-type', 'open_id', '--page-size', '100', ...(cursor ? ['--page-token', cursor] : [])]
            : ['task', '+get-related-tasks', '--as', 'user', '--include-complete', '--page-limit', '1', ...(cursor ? ['--page-token', cursor] : [])])
          : await this.deps.wecom(['todo', 'list', '--status-filter', '["proceed","finished"]', '--limit', '20', ...(cursor ? ['--cursor', cursor] : [])]);
        const data = response.data;
        if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean') throw new Error('待办列表缺少数组或明确分页结束标志。');
        for (const raw of data.items) {
          let item: ObservedSourceItem;
          if (target.platform === 'feishu') {
            const guid = string(raw?.guid);
            if (!guid) throw new Error('飞书待办缺少 GUID，不能当作完整列表。');
            try { item = await this.object(target, guid); }
            catch (error) {
              item = this.feishu(target, raw);
              item.roles.complete = false;
              item.roles.unknown = [...new Set([...(item.roles.unknown ?? []), 'creator', 'assigned'])];
              item.roles.reason = `详情核验失败：${(error as Error).message}`;
              reasons.push(`待办 ${guid} 的详情未完整核验`);
            }
          } else item = this.wecom(target, raw);
          items.set(item.nativeId, item);
        }
        if (!data.has_more) {
          // The fixed CLI documentation and schema disagree about the extent
          // of this identity's list. Pagination completeness is not proof of
          // all personal/third-party-created tasks being visible in a tenant.
          if (target.platform === 'wecom') reasons.push('已读取企微接口全部分页；固定版本的真人／机器人查询范围说明不一致，非助理创建及他人分派覆盖仍需真实账号核验');
          return { query, items: [...items.values()], observedAt: new Date(), state: reasons.length ? 'partial' : 'complete', ...(reasons.length ? { reason: [...new Set(reasons)].join('；') } : {}) };
        }
        const next = string(target.platform === 'feishu' ? data.page_token : data.next_cursor);
        if (!next || cursors.has(next)) throw new Error('待办续页游标缺失或重复，查询范围不完整。');
        cursors.add(next); cursor = next;
      }
      throw new Error('待办分页达到保护上限，未将部分列表报告为全量。');
    } catch (error) {
      return { query, items: [...items.values()], observedAt: new Date(), state: items.size ? 'partial' : 'failed', reason: (error as Error).message };
    }
  }

  async object(target: SourceTarget, guid: string): Promise<ObservedSourceItem> {
    if (!guid || guid.length > 512) throw new Error('待办标识无效。');
    if (target.platform === 'feishu') {
      const { data } = await this.deps.lark(['task', 'tasks', 'get', '--as', 'user', '--task-guid', guid, '--user-id-type', 'open_id']);
      if (data?.task?.guid !== guid) throw new Error('飞书单项回执与原待办标识不符。');
      if (target.resource.kind === 'tasklist' && (!Array.isArray(data.task.tasklists) || !data.task.tasklists.some((list: any) => list?.tasklist_guid === target.resource.id))) throw new Error('原待办不在已登记清单中，未跨范围操作。');
      return this.feishu(target, data.task);
    }
    const { data } = await this.deps.wecom(['todo', 'get', '--items', JSON.stringify([{ todo_id: guid }])]);
    const matches = Array.isArray(data?.items) ? data.items.filter((row: any) => row.todo_id === guid) : [];
    if (matches.length !== 1 || matches[0].success !== true) throw new Error('企微原待办详情未核验，不能把读取失败当成已删除。');
    return this.wecom(target, matches[0]);
  }

  private feishu(target: SourceTarget, raw: any): ObservedSourceItem {
    if (!string(raw?.guid) || typeof raw.summary !== 'string' || !/^\d+$/.test(String(raw.completed_at ?? ''))) throw new Error('飞书待办的标识、正文或状态不完整。');
    const members = Array.isArray(raw.members) ? raw.members : null;
    const people = (role: string): TodoPerson[] => (members ?? []).filter((row: any) => row.type === 'user' && row.role === role && string(row.id)).map((row: any) => ({ id: row.id, name: string(row.name) || row.id }));
    const assignees = people('assignee'), followers = people('follower');
    const creator = raw.creator?.type === 'user' && string(raw.creator.id) ? { id: raw.creator.id, name: string(raw.creator.name) || raw.creator.id } : null;
    const values = [...(assignees.some(row => row.id === target.identity.ownerId) ? ['responsible'] : []),
      ...(followers.some(row => row.id === target.identity.ownerId) ? ['following'] : []), ...(creator?.id === target.identity.ownerId ? ['creator'] : [])];
    const unknown = [...(!members ? ['responsible', 'following'] : []), ...(!creator ? ['creator'] : []), 'assigned'];
    const due = this.feishuDue(raw.due);
    const ownCompletion = Array.isArray(raw.assignee_related) ? raw.assignee_related.find((row: any) => row.id === target.identity.ownerId) : null;
    return { nativeId: raw.guid, locator: { guid: raw.guid, resourceId: target.resource.id, url: string(raw.url) || null }, active: true,
      body: { summary: clean(raw.summary), description: string(raw.description), status: Number(raw.completed_at) > 0 ? 'completed' : 'open', ...due,
        assignees, followers, creator, mode: raw.mode === 1 ? 'all_assignees' : raw.mode === 2 ? 'any_assignee' : 'unknown',
        ownerStatus: ownCompletion ? Number(ownCompletion.completed_at) > 0 ? 'completed' : 'open' : null,
        reminder: raw.reminders ?? null, native: { completedAt: raw.completed_at, assigneeRelated: raw.assignee_related ?? null } },
      roles: { complete: unknown.length === 0, values, unknown, reason: '交办关系需明确分派凭证；创建者身份不能单独证明交办' },
      capabilities: { update: 'platform_checked_on_write', complete: 'platform_checked_on_write', cancel: 'platform_checked_on_write', leave: 'adapter_unavailable' } };
  }

  private feishuDue(raw: any): Record<string, unknown> {
    if (raw == null) return { dueAt: null, dueDate: null, dueHasTime: false };
    if (typeof raw.is_all_day !== 'boolean' || !/^\d+$/.test(String(raw.timestamp ?? ''))) throw new Error('飞书截止时间缺少精度或有效时间戳。');
    const date = new Date(Number(raw.timestamp));
    if (!Number.isFinite(date.getTime())) throw new Error('飞书截止时间无效。');
    return raw.is_all_day ? { dueAt: null, dueDate: date.toISOString().slice(0, 10), dueHasTime: false }
      : { dueAt: date.toISOString(), dueDate: null, dueHasTime: true };
  }

  private wecom(target: SourceTarget, raw: any): ObservedSourceItem {
    if (!string(raw?.todo_id) || typeof raw.title !== 'string' || !['proceed', 'finished', 'deleted'].includes(raw.status)) throw new Error('企微待办的标识、正文或整体状态不完整。');
    const states = ['accept', 'finished', 'reject', 'removed', 'notshow'];
    const nativeFollowers = Array.isArray(raw.followers) ? raw.followers : null;
    const assignees: TodoPerson[] = (nativeFollowers ?? []).filter((row: any) => string(row.userid) && states.includes(row.user_status)).map((row: any) => ({ id: row.userid, name: string(row.user_name) || row.userid, state: row.user_status }));
    const creator = string(raw.creator?.userid) ? { id: raw.creator.userid, name: string(raw.creator.user_name) || raw.creator.userid } : null;
    const responsible = assignees.some(row => row.id === target.identity.ownerId && !['removed', 'notshow', 'reject'].includes(row.state!));
    const unknown = [...(!nativeFollowers || assignees.length !== nativeFollowers.length ? ['responsible'] : []), ...(!creator ? ['creator'] : []), 'following', 'assigned'];
    let dueAt: string | null = null, dueDate: string | null = null;
    if (raw.deadline != null) {
      if (raw.deadline.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline.value)) {
        const date = new Date(raw.deadline.value);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw.deadline.value) throw new Error('企微截止日期无效。');
        dueDate = raw.deadline.value;
      } else if (raw.deadline.type === 'datetime') {
        const date = wecomObservedWallTime(raw.deadline.value, this.deps.timeZone(), null);
        if (!date) throw new Error('企微截止时刻无法唯一核验。');
        dueAt = date.toISOString();
      } else throw new Error('企微截止时间格式无法识别。');
    }
    return { nativeId: raw.todo_id, locator: { guid: raw.todo_id, resourceId: target.resource.id, url: null }, active: raw.status !== 'deleted' && raw.user_status !== 'removed',
      body: { summary: clean(raw.title), description: string(raw.description), status: raw.status === 'finished' ? 'completed' : raw.status === 'deleted' ? 'canceled' : 'open',
        dueAt, dueDate, dueHasTime: dueAt !== null, assignees, followers: [], creator, mode: 'per_person',
        ownerStatus: states.includes(raw.user_status) ? raw.user_status : null, reminder: string(raw.extra_info) || null,
        native: { followers: nativeFollowers, creator: raw.creator ?? null, userStatus: raw.user_status ?? null } },
      roles: { complete: false, values: [...(responsible ? ['responsible'] : []), ...(creator?.id === target.identity.ownerId ? ['creator'] : [])], unknown,
        reason: '企微原生分派人以完成责任状态核验；接口无独立关注角色，交办关系需另有凭证' },
      capabilities: { update: 'platform_checked_on_write', complete: responsible ? 'self' : 'unknown', cancel: creator?.id === target.identity.ownerId ? 'whole' : creator ? 'self' : 'unknown' } };
  }
}
