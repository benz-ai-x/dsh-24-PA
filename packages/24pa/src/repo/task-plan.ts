import { randomUUID } from 'node:crypto';
import type { PaDb, PaQueryer } from '../db.js';
import type { TaskPlanAuthorization, TaskPlanBlock, TaskPlanConfiguration } from '../task-plan.js';
import type { DigestPlanRow } from './digest.js';
import { lockPlanSkill, type SkillEntryRow } from './skill.js';
import { SkillRunRepo, type SkillRunRow } from './skill-run.js';

export interface TaskPlanRow extends DigestPlanRow {
  revision: number;
  task_config: TaskPlanConfiguration | null;
  task_authorization: TaskPlanAuthorization | null;
  owner_enabled: boolean;
  recycled_at: Date | null;
  delete_when_idle: boolean;
  failure_count: number;
  last_success_hash: string | null;
}
interface ChangeIdentity { requestId: string; requestHash: string }
interface PlanSelection extends ChangeIdentity { id: string; expectedRevision: number }
const restored = (row: TaskPlanRow): TaskPlanRow => ({ ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at), recycled_at: row.recycled_at ? new Date(row.recycled_at) : null });

/** Legacy controls and native lifecycle recovery share the new plan gates. */
export async function assertTaskPlanEnabled(tx: PaQueryer, id: string): Promise<void> {
  const row = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1', [id])).rows[0];
  if (!row?.task_config) return;
  if (!row.owner_enabled || !row.task_authorization || row.recycled_at || row.delete_when_idle
    || (await tx.query('select key from pa24.task_plan_block where plan_id = $1', [id])).rowCount) throw new Error('定时任务尚未获准启用或仍有阻断，不能通过旧入口恢复。');
}

/** Extends the existing plan identity. Owner choices, independent blocking
 * causes and native schedule receipts are separate durable facts. */
export class TaskPlanRepo {
  constructor(private readonly db: PaDb) {}
  async get(id: string, tx: PaQueryer = this.db): Promise<TaskPlanRow | null> {
    return (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1', [id])).rows[0] ?? null;
  }
  async repeated(input: ChangeIdentity, tx: PaQueryer = this.db): Promise<TaskPlanRow | null> {
    const row = (await tx.query<{ request_hash: string; result: TaskPlanRow }>('select * from pa24.task_plan_change where request_id = $1', [input.requestId])).rows[0];
    if (!row) return null;
    if (row.request_hash !== input.requestHash || !row.result) throw new Error('计划操作标识已用于其他内容，请刷新后重试。');
    return restored(row.result);
  }
  async remember(input: ChangeIdentity, row: TaskPlanRow): Promise<TaskPlanRow> { return this.change(input, async () => row); }
  private async change(input: ChangeIdentity, work: (tx: PaQueryer) => Promise<TaskPlanRow>): Promise<TaskPlanRow> {
    return this.db.withTransaction(async tx => {
      const claim = await tx.query('insert into pa24.task_plan_change (request_id, request_hash) values ($1,$2) on conflict (request_id) do nothing returning request_id', [input.requestId, input.requestHash]);
      if (!claim.rowCount) return (await this.repeated(input, tx))!;
      const row = await work(tx);
      await tx.query('update pa24.task_plan_change set result = $2 where request_id = $1', [input.requestId, JSON.stringify(row)]);
      return row;
    });
  }
  private async selected(input: PlanSelection, tx: PaQueryer): Promise<TaskPlanRow> {
    const row = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1 for update', [input.id])).rows[0];
    if (!row) throw new Error('定时任务不存在。');
    if (row.revision !== input.expectedRevision) throw new Error('计划已有其他修改，请刷新后重试。');
    return row;
  }
  async save(input: ChangeIdentity & { id?: string; expectedRevision?: number; title: string; kind: string; skill: string; sessionId: string; scheduleSpec: Record<string, unknown>; configuration: TaskPlanConfiguration }): Promise<TaskPlanRow> {
    return this.change(input, async tx => {
      // Match Skill mutation lock order. A paused draft may reference a
      // disabled Skill, but never a deleted identity or another alias.
      const entry = (await tx.query<SkillEntryRow>('select * from pa24.skill_entry where name = $1 for update', [input.skill])).rows[0];
      if (input.configuration.skillId.startsWith('managed:') && (!entry || input.configuration.skillId !== `managed:${entry.id}` || entry.status === 'deleted')) throw new Error('所选 Skill 已删除或身份不符。');
      if (entry && input.configuration.skillId !== `managed:${entry.id}`) throw new Error('受管 Skill 不得以文件来源绕过状态检查。');
      let row;
      if (input.id) {
        row = await this.selected({ ...input, id: input.id, expectedRevision: input.expectedRevision ?? -1 }, tx);
        if (row.recycled_at || row.delete_when_idle) throw new Error('计划已进入删除流程，请先还原。');
        if (row.status === 'active' || row.schedule_id || row.lifecycle) throw new Error('请先确认原生计划暂停，再保存新的计划配置。');
        row = (await tx.query<TaskPlanRow>(`update pa24.digest_plan set title = $2, kind = $3, skill = $4, schedule_spec = $5,
          task_config = $6, owner_enabled = false, status = 'paused', voice = $7,
          revision = revision + 1, updated_at = now() where id = $1 returning *`,
        [row.id, input.title, input.kind, input.skill, JSON.stringify(input.scheduleSpec), JSON.stringify(input.configuration), input.configuration.delivery.voice])).rows[0]!;
      } else {
        row = (await tx.query<TaskPlanRow>(`insert into pa24.digest_plan
          (id, title, kind, skill, session_id, schedule_spec, status, voice, task_config, owner_enabled)
          values ($1,$2,$3,$4,$5,$6,'paused',$7,$8,false) returning *`,
        [`plan-${randomUUID()}`, input.title, input.kind, input.skill, input.sessionId, JSON.stringify(input.scheduleSpec), input.configuration.delivery.voice, JSON.stringify(input.configuration)])).rows[0]!;
      }
      return row;
    });
  }
  /** Captures only the already checked scope. A draft or copy cannot enable
   * itself by carrying an authorization object from another plan. */
  async authorize(input: PlanSelection & { authorization: TaskPlanAuthorization }): Promise<TaskPlanRow> {
    return this.change(input, async tx => {
      const observed = await this.get(input.id, tx);
      if (!observed) throw new Error('定时任务不存在。');
      const version = await lockPlanSkill(tx, observed.skill, undefined, true);
      const row = await this.selected(input, tx), auth = input.authorization;
      if (!row.task_config || row.recycled_at || row.delete_when_idle || row.skill !== observed.skill
        || auth.skill.id !== row.task_config.skillId || auth.skill.name !== row.skill || (version && version.id !== auth.skill.versionId)) throw new Error('计划或 Skill 已变化，请重新核验授权。');
      await tx.query('delete from pa24.skill_plan_block where plan_id = $1', [row.id]);
      await tx.query("delete from pa24.task_plan_block where plan_id = $1 and key = 'preflight'", [row.id]);
      return (await tx.query<TaskPlanRow>('update pa24.digest_plan set task_authorization = $2, revision = revision + 1, updated_at = now() where id = $1 returning *', [row.id, JSON.stringify(auth)])).rows[0]!;
    });
  }
  async chooseEnabled(input: PlanSelection & { enabled: boolean }): Promise<TaskPlanRow> {
    return this.change(input, async tx => {
      const observed = await this.get(input.id, tx);
      if (!observed) throw new Error('定时任务不存在。');
      if (input.enabled) await lockPlanSkill(tx, observed.skill, observed.id);
      const row = await this.selected(input, tx);
      if (row.recycled_at || row.delete_when_idle) throw new Error('计划已进入删除流程。');
      if (input.enabled && (!row.task_authorization || row.task_authorization.skill.id !== row.task_config?.skillId || row.skill !== observed.skill || (await this.blocks(row.id, tx)).length)) throw new Error('计划仍有未解决的阻断，须重新核验授权后启用。');
      if (!input.enabled) await new SkillRunRepo(this.db).cancelQueuedPlan(row.id, '主人暂停计划，未启动的排队运行已停止。', tx);
      return (await tx.query<TaskPlanRow>(`update pa24.digest_plan set owner_enabled = $2,
        status = case when $2 then status else 'paused' end, revision = revision + 1, updated_at = now() where id = $1 returning *`, [row.id, input.enabled])).rows[0]!;
    });
  }
  async blocks(id: string, tx: PaQueryer = this.db): Promise<TaskPlanBlock[]> {
    return (await tx.query<TaskPlanBlock>('select * from pa24.task_plan_block where plan_id = $1 order by key', [id])).rows;
  }
  async block(id: string, block: Pick<TaskPlanBlock, 'key' | 'kind' | 'reason'>, expectedRevision?: number): Promise<void> {
    await this.db.withTransaction(async tx => {
      const row = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1 for update', [id])).rows[0];
      if (!row || row.recycled_at || (expectedRevision !== undefined && row.revision !== expectedRevision)) return;
      await tx.query(`insert into pa24.task_plan_block (plan_id, key, kind, reason) values ($1,$2,$3,$4)
        on conflict (plan_id, key) do update set kind = excluded.kind, reason = excluded.reason`, [id, block.key, block.kind, block.reason]);
      await tx.query("update pa24.digest_plan set status = 'paused', revision = revision + 1, updated_at = now() where id = $1", [id]);
      await new SkillRunRepo(this.db).cancelQueuedPlan(id, `计划阻断：${block.reason}`, tx);
    });
  }
  async clearBlock(id: string, key: string): Promise<void> {
    await this.db.withTransaction(async tx => {
      await tx.query('select id from pa24.digest_plan where id = $1 for update', [id]);
      const result = await tx.query('delete from pa24.task_plan_block where plan_id = $1 and key = $2 returning key', [id, key]);
      if (result.rowCount) await tx.query('update pa24.digest_plan set revision = revision + 1, updated_at = now() where id = $1', [id]);
    });
  }
  async repairBlock(input: PlanSelection & { key: string }): Promise<TaskPlanRow> {
    return this.change(input, async tx => {
      const row = await this.selected(input, tx);
      if (!['failures', 'expired-once'].includes(input.key)) throw new Error('此阻断须通过对应的权限或依赖修复入口处理。');
      if (row.recycled_at || row.delete_when_idle) throw new Error('请先还原计划。');
      await tx.query('delete from pa24.task_plan_block where plan_id = $1 and key = $2', [row.id, input.key]);
      return (await tx.query<TaskPlanRow>(`update pa24.digest_plan set failure_count = case when $2 then 0 else failure_count end,
        revision = revision + 1, updated_at = now() where id = $1 returning *`, [row.id, input.key === 'failures'])).rows[0]!;
    });
  }
  async activeRuns(id: string, tx: PaQueryer = this.db): Promise<Array<{ id: string; status: string }>> {
    const rows = (await tx.query<SkillRunRow>('select * from pa24.skill_run where plan_id = $1', [id])).rows;
    const runs = new SkillRunRepo(this.db), unsettled = [];
    for (const row of rows) if (await runs.isUnsettled(row, tx)) unsettled.push({ id: row.id, status: row.status });
    return unsettled;
  }
  async requestDelete(input: PlanSelection): Promise<TaskPlanRow> {
    return this.change(input, async tx => {
      const row = await this.selected(input, tx);
      if (row.recycled_at) return row;
      await new SkillRunRepo(this.db).cancelQueuedPlan(row.id, '计划进入删除流程，未启动的排队运行已停止。', tx);
      return (await tx.query<TaskPlanRow>(`update pa24.digest_plan set owner_enabled = false, status = 'paused', delete_when_idle = true,
        revision = revision + 1, updated_at = now() where id = $1 returning *`, [row.id])).rows[0]!;
    });
  }
  async finishDelete(id: string): Promise<TaskPlanRow | null> {
    return this.db.withTransaction(async tx => {
      const row = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1 for update', [id])).rows[0];
      if (!row || !row.delete_when_idle || row.schedule_id || row.lifecycle || (await this.activeRuns(id, tx)).length) return row ?? null;
      return (await tx.query<TaskPlanRow>(`update pa24.digest_plan set status = 'stopped', recycled_at = now(), delete_when_idle = false,
        revision = revision + 1, updated_at = now() where id = $1 returning *`, [id])).rows[0]!;
    });
  }
  async restore(input: PlanSelection): Promise<TaskPlanRow> {
    return this.change(input, async tx => {
      const row = await this.selected(input, tx);
      if (!row.recycled_at && !row.delete_when_idle) throw new Error('此计划不在回收或删除流程中。');
      return (await tx.query<TaskPlanRow>(`update pa24.digest_plan set status = 'paused', recycled_at = null, delete_when_idle = false,
        owner_enabled = false, task_authorization = null, revision = revision + 1, updated_at = now() where id = $1 returning *`, [row.id])).rows[0]!;
    });
  }
  async list(input: { query?: string; skillId?: string; state?: 'enabled' | 'paused' | 'blocked' | 'recycled'; offset?: number; limit?: number } = {}) {
    const values: unknown[] = [], clauses: string[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (input.state === 'recycled') clauses.push('p.recycled_at is not null'); else clauses.push('p.recycled_at is null');
    if (input.query?.trim()) { const key = bind(`%${input.query.trim().toLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`); clauses.push(`(lower(p.title) like ${key} escape '\\' or lower(p.id) like ${key} escape '\\')`); }
    if (input.skillId) clauses.push(`p.task_config->>'skillId' = ${bind(input.skillId)}`);
    if (input.state === 'enabled') clauses.push("p.owner_enabled = true and p.status = 'active'");
    if (input.state === 'paused') clauses.push('p.owner_enabled = false');
    if (input.state === 'blocked') clauses.push('(exists (select 1 from pa24.task_plan_block b where b.plan_id = p.id) or exists (select 1 from pa24.skill_plan_block b where b.plan_id = p.id))');
    const where = clauses.join(' and ');
    const total = Number((await this.db.query<{ count: string }>(`select count(*) as count from pa24.digest_plan p where ${where}`, values)).rows[0]!.count);
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 20))), offset = Math.max(0, Math.floor(input.offset ?? 0));
    const rows = (await this.db.query<TaskPlanRow>(`select p.* from pa24.digest_plan p where ${where} order by p.created_at desc, p.id limit ${bind(limit)} offset ${bind(offset)}`, values)).rows;
    return { rows, total, offset, limit };
  }
}
