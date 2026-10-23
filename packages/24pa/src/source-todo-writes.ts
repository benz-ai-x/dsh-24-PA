import { Temporal } from '@js-temporal/polyfill';
import type { PaConfig } from './config.js';
import { effectiveSources, selectSource, sourceScopeFingerprint } from './source-config.js';
import { sourceIdentityKey, type SourceRegistry, type SourceTarget } from './source-registry.js';
import type { SourceTodo } from './source-todo.js';
import type { SourceTodoReader, TodoPerson } from './source-todo-reader.js';
import type { Repos, WorkItemRow, ActionOperationRow } from './repo.js';
import { sourceObjectId, type ObservedSourceItem } from './repo/source-projection.js';
import { ExternalOperations, isCandidateOperation } from './external-operations.js';
import { isDeepStrictEqual } from 'node:util';
import { hash, text } from './util.js';
import { wecomWallTime } from './wecom.js';
import { taskFingerprint } from './task-lifecycle.js';

export type TodoMutation = 'create' | 'update' | 'complete' | 'cancel' | 'assign';
interface TodoWritesDeps {
  config(): PaConfig;
  registry: SourceRegistry;
  todos: SourceTodo;
  reader: SourceTodoReader;
  repos(): Repos;
  external: ExternalOperations;
  lark(args: string[]): Promise<{ data: any }>;
  wecom(args: string[]): Promise<{ data: any }>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
  notify(guid: string, fingerprint: string | null): Promise<void>;
}
const unknown = (message: string): Error => Object.assign(new Error(message), { outcome: 'unknown' });
const query = { from: null, to: null };
const fields = ['sourceId', 'company', 'project', 'channel', 'taskId', 'guid', 'objectId', 'tasklistId', '_tasklistId', 'summary', 'description', 'due',
  'assigneeIds', 'effect', 'instruction', '_instruction', 'reason', 'plannedAt', 'estimateMinutes', 'projectId', 'opSuffix', '_authorization', '_sourceTarget'];
function canonical(value: any): any {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
function due(value: unknown, zone: string) {
  if (value === null || value === '' || value === undefined) return { dueAt: null, dueDate: null, dueHasTime: false };
  const input = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return { dueAt: null, dueDate: Temporal.PlainDate.from(input, { overflow: 'reject' }).toString(), dueHasTime: false };
  const instant = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input) ? Temporal.Instant.from(input)
    : Temporal.PlainDateTime.from(input, { overflow: 'reject' }).toZonedDateTime(zone, { disambiguation: 'reject' }).toInstant();
  return { dueAt: new Date(instant.epochMilliseconds).toISOString(), dueDate: null, dueHasTime: true };
}

/** Every mutation retains its first source, request and acceptance. A new
 * default, a restarted run or a failed readback cannot authorize recreation. */
export class SourceTodoWrites {
  constructor(private readonly deps: TodoWritesDeps) {}

  async target(args: Record<string, unknown>, capability: 'read' | 'create' = 'create'): Promise<SourceTarget> {
    if (args._sourceTarget) {
      const target = args._sourceTarget as SourceTarget;
      if (target.domain !== 'todo') throw new Error('冻结来源不是待办来源。');
      await this.deps.registry.verify(target, capability);
      const explicit = effectiveSources(this.deps.config()).entries.find(source => source.id === args.sourceId || source.name === args.sourceId);
      if (args.sourceId !== undefined && explicit?.id !== target.sourceId) throw new Error('本次来源与获准的固定待办目标不符。');
      if ((args.channel && args.channel !== target.platform) || ((args.tasklistId ?? args._tasklistId) !== undefined && (args.tasklistId ?? args._tasklistId) !== target.resource.id)) throw new Error('指定平台或清单与获准固定来源不符。');
      if (args.company !== undefined || args.project !== undefined) {
        const mapped = selectSource(effectiveSources(this.deps.config()), 'todo', { ...(args.company !== undefined ? { company: String(args.company) } : {}), ...(args.project !== undefined ? { project: String(args.project) } : {}) }, false);
        if (mapped.source.id !== target.sourceId) throw new Error('公司或项目与获准固定来源不符。');
      }
      return target;
    }
    let sourceId = args.sourceId === undefined ? undefined : String(args.sourceId);
    const tasklistId = args.tasklistId ?? args._tasklistId;
    if (sourceId === undefined && tasklistId !== undefined) {
      const matches = effectiveSources(this.deps.config()).entries.filter(source => source.domain === 'todo' && source.resourceId === tasklistId && (!args.channel || source.platform === args.channel));
      if (matches.length !== 1) throw new Error('任务清单未对应唯一登记来源，请明确 sourceId。');
      sourceId = matches[0]!.id;
    }
    const target = await this.deps.registry.bind('todo', { ...(sourceId !== undefined ? { sourceId } : {}),
      ...(args.company !== undefined ? { company: String(args.company) } : {}), ...(args.project !== undefined ? { project: String(args.project) } : {}) }, capability);
    if ((args.channel && args.channel !== target.platform) || (tasklistId !== undefined && tasklistId !== target.resource.id)) throw new Error('指定平台或清单与来源不符，不改投其他目标。');
    return target;
  }

  /** Used by plans before executing each business call. Actual object reads
   * and the write still enforce the same frozen resource below. */
  async checkAction(target: SourceTarget, action: string, args: Record<string, unknown>): Promise<void> {
    if (!['task_create', 'task_update', 'task_complete', 'task_cancel', 'task_assign', 'task_get', 'task_list'].includes(action)) throw new Error('此待办操作不在固定来源授权范围。');
    await this.target({ ...args, _sourceTarget: target }, action === 'task_create' ? 'create' : 'read');
    if (!['task_get', 'task_list'].includes(action) && effectiveSources(this.deps.config()).entries.find(source => source.id === target.sourceId)?.access !== 'readwrite') throw new Error('获准来源仅登记为读取，不能变更待办。');
    if (!['task_create', 'task_get', 'task_list'].includes(action)) {
      const resolved = await this.deps.todos.resolve({ ...args, sourceId: target.sourceId });
      if (resolved.target.identityKey !== target.identityKey || resolved.target.resource.id !== target.resource.id) throw new Error('原待办不属于获准的固定来源。');
    }
  }

  async write(item: WorkItemRow, kind: TodoMutation, args: Record<string, unknown>): Promise<unknown> {
    const request = Object.fromEntries(fields.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    const requestHash = hash(JSON.stringify(canonical(request)));
    const override = args._operationId ? String(args._operationId) : null;
    let id = override ?? `source-todo:${kind}:${item.id}:${requestHash}`;
    return this.deps.gate(`source-todo-intent:${override ?? item.id}`, async () => {
      let previous = await this.deps.repos().operations.get(id);
      if (!previous && !override) {
        const matches = (await this.deps.repos().operations.todoWritesForWork(item.id)).filter(row => row.params.kind === kind && this.sameIntent(args, row.params));
        if (matches.length > 1) throw unknown('已有多条等价待办操作，请核对原回执，不再创建新操作。');
        if (matches[0]) { previous = matches[0]; id = previous.id; }
      }
      if (previous && (previous.params.sourceContract !== 1 || !previous.params.sourceTarget || previous.params.kind !== kind)) throw unknown('原待办操作使用不同恢复契约，不能按当前默认重建。');
      if (previous) this.validateRecovery(previous, args);
      if (previous && previous.params.requestHash !== requestHash && !this.sameIntent(args, previous.params)) throw unknown('原待办操作参数或授权已变化，请沿原对象明确修改，不能覆盖原创建。');
      const params = previous?.params ?? { ...await this.prepare(kind, args), sourceContract: 1, requestHash, request,
        ...(args._authorization as Record<string, unknown> ?? {}) };
      const target = params.sourceTarget as SourceTarget;
      return this.deps.gate(`source-todo-object:${JSON.stringify([target.platform, target.identityKey, params.guid ?? target.resource.id])}`,
        () => this.writeFrozen(item, kind, id, params, previous));
    });
  }

  private validateRecovery(row: ActionOperationRow, args: Record<string, unknown>): void {
    const p = row.params, target = p.sourceTarget as SourceTarget;
    const present = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
    if (target.domain !== 'todo' || !['feishu', 'wecom'].includes(target.platform)
      || !present(target.sourceId) || !present(target.identity?.ownerId) || !present(target.identity?.authority)
      || target.identity.platform !== target.platform || target.identityKey !== sourceIdentityKey(target.identity)
      || !present(target.resource?.id) || !['tasklist', 'authorized_scope'].includes(target.resource.kind)
      || p.channel !== target.platform || p.tasklistId !== target.resource.id
      || !p.values || !p.request || !present(p.requestHash)
      || (p.receiptFormat !== undefined && p.receiptFormat !== `${target.platform}-task-v1`)) {
      throw unknown('原待办操作的来源、目标或恢复格式不足，需核对原回执，不能重建。');
    }
    if (isCandidateOperation(row.id)) {
      const authorization = args._authorization as Record<string, unknown> | undefined;
      const scope = row.id.startsWith('note.action:') ? ['noteId', 'versionId', 'index'] : ['minutesId', 'index'];
      if (p.kind !== 'create' || !row.work_item_id || !present(p.instruction)
        || scope.some(key => p[key] === undefined || !isDeepStrictEqual(p[key], authorization?.[key])
          || !isDeepStrictEqual(p[key], p.request._authorization?.[key]))) {
        throw unknown('候选原操作的资料来源或授权身份不符，请先核对，不能沿当前交办重建。');
      }
    }
    if (row.status === 'succeeded' && !present(row.receipt?.guid)) throw unknown('原待办操作缺少可信对象回执，请先核对。');
  }

  private sameIntent(args: Record<string, unknown>, saved: Record<string, any>): boolean {
    if (saved.sourceContract !== 1 || !saved.sourceTarget || !saved.request) return false;
    const target = saved.sourceTarget as SourceTarget;
    if (args.channel && args.channel !== target.platform) return false;
    if (args._sourceTarget && JSON.stringify(canonical(args._sourceTarget)) !== JSON.stringify(canonical(target))) return false;
    if (args.sourceId !== undefined && args.sourceId !== target.sourceId && args.sourceId !== saved.sourceName) return false;
    if (['company', 'project', 'opSuffix', 'projectId'].some(key => args[key] !== saved.request[key])) return false;
    if (args._authorization !== undefined || saved.request._authorization !== undefined) {
      if (JSON.stringify(canonical(args._authorization)) !== JSON.stringify(canonical(saved.request._authorization))) return false;
    }
    if ((args.tasklistId ?? args._tasklistId) !== undefined && (args.tasklistId ?? args._tasklistId) !== target.resource.id) return false;
    if (saved.kind !== 'create' && String(args.guid ?? args.taskId ?? args.objectId ?? '') !== String(saved.request.guid ?? saved.request.taskId ?? saved.request.objectId ?? '')) return false;
    try {
      const normalized = this.values(saved.kind, args, target);
      const original = { ...saved.values };
      // Added wording is not a new business operation or permission to replay
      // an uncertain write. Explicit candidate authorization is checked above.
      delete normalized.instruction; delete original.instruction;
      return JSON.stringify(canonical(normalized)) === JSON.stringify(canonical(original));
    } catch { return false; }
  }

  private values(kind: TodoMutation, args: Record<string, unknown>, target: SourceTarget): Record<string, any> {
    const result: Record<string, any> = {};
    if (kind === 'create' || args.summary !== undefined) result.summary = text(args.summary, 500);
    if (args.description !== undefined) result.description = String(args.description).slice(0, 3000);
    if (kind === 'create' || args.due !== undefined) result.due = due(args.due, this.deps.config().timeZone);
    if (kind === 'create' || kind === 'assign') {
      const ids = args.assigneeIds === undefined && kind === 'create' ? [target.identity.ownerId] : args.assigneeIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id.trim() || !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error('负责人需提供 1–50 个已确定的用户 ID，不以关注人代替。');
      result.assigneeIds = [...new Set(ids)].sort();
      const instruction = String(args.instruction ?? args._instruction ?? '').trim();
      if (ids.some(id => id !== target.identity.ownerId) && !instruction) throw new Error('分派给他人需要本人的明确指令，请补充 instruction。');
      if (instruction) result.instruction = instruction;
    }
    if (args.plannedAt !== undefined) result.plannedAt = args.plannedAt === null ? null : Temporal.Instant.from(String(args.plannedAt)).toString();
    if (args.estimateMinutes !== undefined) {
      if (args.estimateMinutes !== null && (!Number.isFinite(Number(args.estimateMinutes)) || Number(args.estimateMinutes) < 0)) throw new Error('投入估时须为非负分钟数。');
      result.estimateMinutes = args.estimateMinutes === null ? null : Math.round(Number(args.estimateMinutes));
    }
    if (kind === 'complete' || kind === 'cancel') {
      if (args.effect !== undefined && !['self', 'whole'].includes(String(args.effect))) throw new Error('影响范围须明确为 self（本人）或 whole（整项）。');
      result.effect = args.effect ?? null;
      if (kind === 'cancel') { result.reason = text(args.reason ?? args.instruction ?? '', 500); }
    }
    return result;
  }

  private async prepare(kind: TodoMutation, args: Record<string, unknown>): Promise<Record<string, any>> {
    const resolved = kind === 'create' ? null : await this.deps.todos.resolve(args._sourceTarget ? { ...args, sourceId: (args._sourceTarget as SourceTarget).sourceId } : args);
    const target = resolved?.target ?? await this.target(args);
    if (args._sourceTarget) {
      const frozen = await this.target(args, kind === 'create' ? 'create' : 'read');
      if (target.identityKey !== frozen.identityKey || target.resource.id !== frozen.resource.id || target.registrationRevision !== frozen.registrationRevision || target.scopeHash !== frozen.scopeHash) throw new Error('原待办与获准固定来源不符。');
    }
    const source = effectiveSources(this.deps.config()).entries.find(row => row.id === target.sourceId)!;
    if (source.access !== 'readwrite') throw new Error('原来源仅登记为读取，不能变更待办。');
    const values = this.values(kind, args, target);
    if (kind === 'update' && !Object.keys(values).length) throw new Error('请明确要修改的内容、截止时间或投入计划。');
    const params = { kind, sourceTarget: target, sourceName: source.name, channel: target.platform,
      tasklistId: target.resource.id, guid: resolved?.guid ?? null, before: resolved?.item ?? null,
      values, ...values, timeZone: this.deps.config().timeZone, instruction: String(args.instruction ?? args._instruction ?? ''),
      projectId: args.projectId ?? null };
    if (resolved) this.checkEffect(kind, target, params, resolved.item);
    return params;
  }

  private checkEffect(kind: TodoMutation, target: SourceTarget, params: Record<string, any>, before: ObservedSourceItem): void {
    const assignees = before.body.assignees as TodoPerson[] ?? [];
    if (kind === 'complete') {
      if (target.platform === 'wecom') {
        params.effect = params.effect ?? 'self';
        if (params.effect === 'whole' && (before.body.creator as TodoPerson | null)?.id !== target.identity.ownerId) throw new Error('尚未核实本人为企微创建者，不能提升为整项完成；可以明确完成本人份额。');
        if (params.effect === 'self' && !before.roles.values.includes('responsible')) throw new Error('尚未核实本人承担该待办份额，请核对分派与参与状态。');
      } else {
        if (assignees.length > 1 && !params.effect) throw new Error('该待办有多个负责人，请明确完成本人份额还是整项待办。');
        params.effect = params.effect ?? 'whole';
        if (params.effect === 'self' && !assignees.some(person => person.id === target.identity.ownerId)) throw new Error('尚未核实本人是该待办负责人，不能确认完成本人份额。');
        if (params.effect === 'self' && assignees.length > 1) throw new Error('当前飞书适配器未接通单个会签份额的可靠完成接口，请在原平台完成本人份额；不会改为整项完成。');
      }
    }
    if (kind === 'cancel') {
      if (target.platform === 'feishu') {
        if (params.effect === 'self') throw new Error('本人退出与整项删除不同，当前接口未接通退出，不会删除整项待办。');
        params.effect = 'whole';
      } else {
        const creator = (before.body.creator as TodoPerson | null)?.id;
        if (!creator) throw new Error('企微创建者身份未核实，不能确定删除或退出的影响。');
        const effect = creator === target.identity.ownerId ? 'whole' : 'self';
        if (!params.effect) throw new Error(`企微此操作会${effect === 'whole' ? '删除整项待办' : '退出本人的参与'}，请明确 effect。`);
        if (params.effect !== effect) throw new Error('本次指定影响与原平台身份不符，未执行删除或退出。');
      }
    }
    if (target.platform === 'wecom' && kind === 'update' && params.values.due && !params.values.due.dueAt && !params.values.due.dueDate) throw new Error('当前企微修改契约未提供可靠清空截止的字段；请在原平台清空，不以重建代替。');
  }

  private async writeFrozen(item: WorkItemRow, kind: TodoMutation, id: string, params: Record<string, any>, previous: ActionOperationRow | null): Promise<unknown> {
    const target = params.sourceTarget as SourceTarget;
    const action = `${target.platform === 'feishu' ? 'task' : 'wecom_todo'}.${kind === 'cancel' ? 'delete' : target.platform === 'wecom' && kind === 'complete' ? 'finish' : kind}`;
    if (previous && previous.action !== action) throw unknown('原待办操作渠道或动作与冻结目标不符。');
    const acknowledged = previous?.receipt && (previous.status === 'succeeded' || Object.hasOwn(previous.receipt, '_externalResult'));
    let executionParams = params;
    if (!acknowledged) {
      if (previous && ['running', 'unknown'].includes(previous.status)) throw unknown('原待办操作结果未知，请先核对原对象；不会重复写入。');
      await this.deps.registry.verify(target, kind === 'create' ? 'create' : 'read');
      const source = effectiveSources(this.deps.config()).entries.find(row => row.id === target.sourceId);
      if (!source || source.access !== 'readwrite' || sourceScopeFingerprint(source) !== target.scopeHash) throw new Error('原待办来源已变更或不可写。');
      if (kind !== 'create') {
        const current = await this.deps.reader.object(target, params.guid);
        this.checkEffect(kind, target, params, current);
        // An assignment adds people to the current set; stale creation-time
        // participants must never replace later additions in WeCom.
        executionParams = { ...params, before: current };
      }
    }
    const staged = await this.deps.external.stageWithId(id, item, action, params);
    let receipt: Record<string, any>;
    try {
      if (!staged.created) receipt = staged.row.receipt!;
      else {
        const response = await this.deps.external.perform(id, () => this.invoke(id, kind, target, executionParams));
        if (typeof response?.guid !== 'string' || !response.guid.trim()) throw unknown('平台接受后缺少原待办标识，请核对原回执。');
        receipt = { guid: response.guid, objectId: sourceObjectId(target, response.guid), sourceTarget: target, sourceId: target.sourceId,
          sourceName: params.sourceName, permissionEvidence: target.permission ?? null, channel: target.platform, kind, effect: params.effect ?? null, platformAccepted: true,
          url: response.raw?.task?.url ?? params.before?.locator.url ?? null,
          acceptedAt: (await this.deps.repos().operations.get(id))?.receipt?._externalAcceptedAt ?? null };
        const before = params.before as ObservedSourceItem | null;
        const observed: ObservedSourceItem = { nativeId: response.guid, locator: { guid: response.guid, resourceId: target.resource.id, url: receipt.url },
          body: { ...before?.body, summary: params.summary ?? before?.body.summary ?? '', status: kind === 'cancel' && target.platform === 'feishu' ? 'canceled' : before?.body.status ?? 'unknown',
            ...(params.due ?? {}), assignees: before?.body.assignees ?? [], verification: 'pending' },
          roles: before?.roles ?? { complete: false, values: [], unknown: ['responsible', 'following', 'creator', 'assigned'], reason: '创建已接收，负责人需原平台读回核验' },
          capabilities: before?.capabilities ?? {}, active: !(kind === 'cancel' && target.platform === 'feishu') };
        await this.deps.repos().sourceProjection.recordReceipt(id, target, observed);
        await this.deps.repos().operations.update(id, { status: 'succeeded', receipt });
      }
    } catch (error) { await this.deps.external.fail(id, error); throw error; }
    let verification: Record<string, unknown>, actual: Record<string, unknown> = {};
    if (kind === 'cancel' && target.platform === 'feishu') {
      verification = { state: 'verified', message: '飞书删除接口已确认整项删除；不是完成或退出' };
      actual.status = 'canceled';
      const local = await this.deps.repos().tasks.byGuid(receipt.guid);
      if (local && await this.deps.todos.localObjectId(local) === sourceObjectId(target, receipt.guid)) { await this.deps.notify(receipt.guid, null); await this.deps.repos().tasks.save({ ...local, status: 'canceled', last_synced_at: new Date() }); }
    } else try {
      await this.deps.registry.verify(target, 'read');
      const observed = await this.deps.reader.object(target, receipt.guid);
      await this.deps.repos().sourceProjection.observe(target, { query, items: [observed], observedAt: new Date(), state: 'partial', reason: '仅核验本次待办变更，完整来源范围待查询' });
      await this.mirror(staged.row.work_item_id, id, target, observed, params);
      actual = observed.body;
      const differences: string[] = [];
      if (params.summary !== undefined && params.summary !== observed.body.summary) differences.push('标题与请求不符');
      if (params.description !== undefined && params.description !== observed.body.description) differences.push('描述与请求不符');
      if (params.due && JSON.stringify(canonical(params.due)) !== JSON.stringify(canonical({ dueAt: observed.body.dueAt, dueDate: observed.body.dueDate, dueHasTime: observed.body.dueHasTime }))) differences.push('截止时间或精度与请求不符');
      if (params.assigneeIds?.some((expected: string) => !(observed.body.assignees as TodoPerson[] ?? []).some(person => person.id === expected && !['removed', 'reject', 'notshow'].includes(person.state ?? '')))) differences.push('请求的负责人未在原对象中落实，请沿该对象补齐分派');
      if (kind === 'complete' && (params.effect === 'whole' ? observed.body.status !== 'completed' : !['finished', 'completed'].includes(String(observed.body.ownerStatus)))) differences.push('所选完成范围尚未在原平台读回确认');
      if (kind === 'cancel' && (params.effect === 'whole' ? observed.body.status !== 'canceled' : observed.body.ownerStatus !== 'removed')) differences.push('删除或退出影响尚未在原平台读回确认');
      verification = { state: differences.length ? 'mismatch' : 'verified', differences, message: differences.length ? differences.join('；') : '已读回原待办并核验负责人、截止和业务状态' };
    } catch (error) { verification = { state: 'pending', message: `平台已接收，原对象核验尚未完成：${(error as Error).message}` }; }
    const platform = target.platform === 'feishu' ? '飞书' : '企微';
    const outcome = kind === 'create' ? '已创建' : kind === 'complete' && actual.status === 'completed' ? '整项已完成'
      : kind === 'complete' && ['finished', 'completed'].includes(String(actual.ownerStatus)) ? '本人份额已完成，整项仍未完成'
      : kind === 'cancel' && actual.status === 'canceled' ? '整项已删除' : kind === 'cancel' && actual.ownerStatus === 'removed' ? '本人已退出，其他人的工作保留'
      : `${{ update: '修改', complete: '完成', cancel: '取消', assign: '分派' }[kind]}已被平台接收`;
    return { operationId: id, reused: !!previous, ...receipt, ...actual, verification,
      message: `${previous ? '沿用原回执，未重复写入。' : ''}${platform}待办${outcome}；${String(verification.message)}。${target.platform === 'wecom' && (params.due?.dueAt || params.due?.dueDate) ? '企微截止时间可能触发平台默认提醒，24私助未另建日程或提醒。' : ''}${kind === 'create' ? '记录待办不代表业务已经完成。' : ''}` };
  }

  private async invoke(id: string, kind: TodoMutation, target: SourceTarget, params: Record<string, any>): Promise<{ guid: string; raw: any }> {
    if (target.platform === 'feishu') {
      const value = params.values, body: Record<string, any> = {};
      if (value.summary !== undefined) body.summary = value.summary;
      if (value.description !== undefined) body.description = value.description;
      if (value.due?.dueAt || value.due?.dueDate) body.due = { timestamp: String(new Date(value.due.dueAt ?? value.due.dueDate).getTime()), is_all_day: !value.due.dueHasTime };
      let args: string[];
      if (kind === 'create') args = ['task', 'tasks', 'create', '--as', 'user', '--user-id-type', 'open_id', '--data', JSON.stringify({ ...body,
        client_token: hash(id), members: value.assigneeIds.map((person: string) => ({ id: person, type: 'user', role: 'assignee' })),
        ...(target.resource.kind === 'tasklist' ? { tasklists: [{ tasklist_guid: target.resource.id }] } : {}) })];
      else if (kind === 'cancel') args = ['task', 'tasks', 'delete', '--as', 'user', '--task-guid', params.guid];
      else if (kind === 'assign') args = ['task', 'members', 'add', '--as', 'user', '--task-guid', params.guid, '--user-id-type', 'open_id', '--data', JSON.stringify({ client_token: hash(id), members: value.assigneeIds.map((person: string) => ({ id: person, type: 'user', role: 'assignee' })) })];
      else {
        if (kind === 'complete') body.completed_at = String(Date.now());
        const updateFields = Object.keys(body);
        if (Object.hasOwn(value, 'due') && !updateFields.includes('due')) updateFields.push('due');
        if (!updateFields.length) return { guid: params.guid, raw: { localPlanningOnly: true } };
        args = ['task', 'tasks', 'patch', '--as', 'user', '--task-guid', params.guid, '--user-id-type', 'open_id', '--data', JSON.stringify({ task: body, update_fields: updateFields })];
      }
      const { data } = await this.deps.lark(args);
      const guid = kind === 'create' ? data?.task?.guid : params.guid;
      if (typeof guid !== 'string' || !guid) throw unknown('飞书回执缺少真实待办 GUID。');
      return { guid, raw: data };
    }
    const value = params.values, body: Record<string, any> = kind === 'create' ? {} : { todo_id: params.guid };
    if (value.summary !== undefined) body.title = value.summary;
    if (value.description !== undefined) body.description = value.description;
    if (value.due?.dueAt || value.due?.dueDate) body.deadline = { type: value.due.dueHasTime ? 'datetime' : 'date', value: value.due.dueHasTime ? wecomWallTime(new Date(value.due.dueAt), params.timeZone) : value.due.dueDate };
    if (kind === 'create') body.follower_ids = value.assigneeIds;
    if (kind === 'assign') body.followers = [...new Set([...(params.before.body.native?.followers ?? []).map((person: any) => person.userid), ...value.assigneeIds])].map(userid => ({ userid }));
    if (kind === 'complete') body.finished_all = params.effect === 'whole';
    if (kind === 'update' && Object.keys(body).length === 1) return { guid: params.guid, raw: { localPlanningOnly: true } };
    const command = kind === 'cancel' ? 'delete' : kind === 'complete' ? 'finish' : kind === 'assign' ? 'update' : kind;
    const { data } = await this.deps.wecom(['todo', command, '--items', JSON.stringify([body])]);
    const result = Array.isArray(data?.items) && data.items.length === 1 ? data.items[0] : null;
    if (result?.success === false) throw Object.assign(new Error(result.errmsg || '企微明确拒绝待办操作。'), { outcome: 'failed' });
    if (result?.success !== true || typeof result.todo_id !== 'string' || !result.todo_id || (kind !== 'create' && result.todo_id !== params.guid)) throw unknown('企微待办回执缺少匹配标识或成功标志。');
    return { guid: result.todo_id, raw: result };
  }

  private async mirror(workItemId: string | null, id: string, target: SourceTarget, observed: ObservedSourceItem, params: Record<string, any>): Promise<void> {
    const repo = this.deps.repos(), prior = await repo.tasks.byGuid(observed.nativeId);
    if (prior && await this.deps.todos.localObjectId(prior) !== sourceObjectId(target, observed.nativeId)) throw new Error('本地旧待办 GUID 与当前身份对象冲突，已保留原关联；原平台已接收的变更不会重发。');
    const row = { id: prior?.id ?? id, work_item_id: prior?.work_item_id ?? (params.kind === 'create' ? workItemId : null),
      task_guid: observed.nativeId, url: typeof observed.locator.url === 'string' ? observed.locator.url : null,
      summary: String(observed.body.summary), due_at: observed.body.dueAt || observed.body.dueDate ? new Date(String(observed.body.dueAt ?? observed.body.dueDate)) : null,
      due_has_time: observed.body.dueHasTime === true, planned_at: params.values.plannedAt === undefined ? prior?.planned_at ?? null : params.values.plannedAt === null ? null : new Date(params.values.plannedAt),
      estimate_minutes: params.values.estimateMinutes === undefined ? prior?.estimate_minutes ?? null : params.values.estimateMinutes,
      status: String(observed.body.status), last_synced_at: new Date(), external_updated_at: new Date(), channel: target.platform };
    if (prior && (taskFingerprint(prior) !== taskFingerprint(row) || prior.status !== row.status)) await this.deps.notify(observed.nativeId, row.status === 'open' ? taskFingerprint(row) : null);
    const saved = await repo.tasks.save(row);
    if (params.projectId) await repo.projects.link(params.projectId, saved.id);
  }
}
