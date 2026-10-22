import { randomUUID } from 'node:crypto';
import type { PaDb, PaQueryer } from '../db.js';
import type { SkillPackage } from '../skill-package.js';
import type { SkillDefinitionLike } from '../skills.js';

export interface SkillEntryRow {
  id: string;
  name: string;
  display_name: string;
  source: 'personal' | 'imported' | 'file-copy' | 'builtin-copy';
  status: 'draft' | 'enabled' | 'disabled' | 'deleted';
  revision: number;
  draft_version: string;
  active_version: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface SkillVersionRow {
  id: string;
  skill_id: string;
  package_data: SkillPackage;
  definition: SkillDefinitionLike | null;
  validation_error: string | null;
  created_at: Date;
}
export interface SkillChange {
  requestId: string;
  requestHash: string;
  op: 'save' | 'publish' | 'disable' | 'delete' | 'rollback' | 'rename';
  id?: string;
  expectedRevision?: number;
  displayName?: string;
  source?: SkillEntryRow['source'];
  version?: Pick<SkillVersionRow, 'package_data' | 'definition' | 'validation_error'>;
  versionId?: string;
  blockPlans?: boolean;
}
const restoreEntry = (entry: SkillEntryRow): SkillEntryRow => ({ ...entry, created_at: new Date(entry.created_at), updated_at: new Date(entry.updated_at) });

/** Plan admission and Skill changes take the same lock before touching plan
 * rows. A tombstone can never fall back to a filesystem Skill of the same name. */
export async function lockPlanSkill(tx: PaQueryer, name: string, planId?: string, rebind = false): Promise<SkillVersionRow | null> {
  const entry = (await tx.query<SkillEntryRow>('select * from pa24.skill_entry where name = $1 for update', [name])).rows[0];
  if (!entry && /^pa24-[a-f0-9-]{36}$/.test(name)) throw new Error('计划绑定的受管 Skill 已缺失，请重新选择。');
  if (entry && (entry.status !== 'enabled' || !entry.active_version)) throw new Error('计划绑定的 Skill 尚未启用、已禁用或删除。');
  if (planId && !rebind) {
    const block = (await tx.query<{ reason: string }>('select reason from pa24.skill_plan_block where plan_id = $1', [planId])).rows[0];
    if (block) throw new Error(block.reason);
  }
  if (!entry) return null;
  const version = (await tx.query<SkillVersionRow>('select * from pa24.skill_version where id = $1 and skill_id = $2', [entry.active_version, entry.id])).rows[0];
  if (!version?.definition || version.validation_error) throw new Error('计划绑定的 Skill 版本不可用。');
  return version;
}

/** Immutable package versions and active selection commit together. Changes
 * have durable request identities, including when an HTTP receipt is lost. */
export class SkillRepo {
  constructor(private readonly db: PaDb) {}

  async repeated(requestId: string, requestHash: string): Promise<SkillEntryRow | null> {
    const row = (await this.db.query<{ request_hash: string; result: SkillEntryRow | null }>('select * from pa24.skill_change where id = $1', [requestId])).rows[0];
    if (!row) return null;
    if (row.request_hash !== requestHash || !row.result) throw new Error('操作标识已用于其他请求，请刷新后重试。');
    return restoreEntry(row.result);
  }

  async list(): Promise<SkillEntryRow[]> {
    return (await this.db.query<SkillEntryRow>("select * from pa24.skill_entry where status <> 'deleted' order by created_at, id")).rows;
  }
  async get(id: string): Promise<SkillEntryRow | null> {
    return (await this.db.query<SkillEntryRow>('select * from pa24.skill_entry where id = $1', [id])).rows[0] ?? null;
  }
  async byName(name: string): Promise<SkillEntryRow | null> {
    return (await this.db.query<SkillEntryRow>('select * from pa24.skill_entry where name = $1', [name])).rows[0] ?? null;
  }
  async version(id: string): Promise<SkillVersionRow | null> {
    return (await this.db.query<SkillVersionRow>('select * from pa24.skill_version where id = $1', [id])).rows[0] ?? null;
  }
  async versions(id: string): Promise<Omit<SkillVersionRow, 'package_data' | 'definition'>[]> {
    return (await this.db.query<Omit<SkillVersionRow, 'package_data' | 'definition'>>('select id, skill_id, validation_error, created_at from pa24.skill_version where skill_id = $1 order by created_at desc, id', [id])).rows;
  }
  async verification(id: string, versionId: string) {
    const row = (await this.db.query<{ runs: string; trials: string; completed: string }>(`select count(*) as runs,
      coalesce(sum(case when trial then 1 else 0 end), 0) as trials,
      coalesce(sum(case when status = 'completed' then 1 else 0 end), 0) as completed
      from pa24.skill_run where skill_id = $1 and version_id = $2`, [id, versionId])).rows[0]!;
    return { runs: Number(row.runs), trials: Number(row.trials), completed: Number(row.completed) };
  }
  async planBlocks(): Promise<{ plan_id: string; skill_id: string; reason: string }[]> {
    return (await this.db.query<{ plan_id: string; skill_id: string; reason: string }>('select * from pa24.skill_plan_block')).rows;
  }

  async change(input: SkillChange): Promise<SkillEntryRow> {
    return this.db.withTransaction(async tx => {
      const claim = await tx.query('insert into pa24.skill_change (id, request_hash) values ($1, $2) on conflict (id) do nothing returning id', [input.requestId, input.requestHash]);
      if (!claim.rowCount) {
        const saved = (await tx.query<{ request_hash: string; result: SkillEntryRow }>('select * from pa24.skill_change where id = $1', [input.requestId])).rows[0]!;
        if (saved.request_hash !== input.requestHash || !saved.result) throw new Error('操作标识已用于不同请求，请刷新后重试。');
        return restoreEntry(saved.result);
      }
      let entry: SkillEntryRow;
      if (input.id) {
        const current = (await tx.query<SkillEntryRow>('select * from pa24.skill_entry where id = $1 for update', [input.id])).rows[0];
        if (!current || current.status === 'deleted') throw new Error('Skill 已删除或不存在。');
        if (input.expectedRevision !== current.revision) throw new Error('Skill 已被其他编辑修改，请刷新详情后再保存；草稿内容可另存副本。');
        entry = current;
      } else {
        if (input.op !== 'save' || !input.version || !input.displayName) throw new Error('新 Skill 须先保存草稿。');
        const id = randomUUID();
        entry = (await tx.query<SkillEntryRow>(`insert into pa24.skill_entry (id, name, display_name, source, draft_version)
          values ($1, $2, $3, $4, '') returning *`, [id, `pa24-${id}`, input.displayName, input.source ?? 'personal'])).rows[0]!;
      }
      if (input.op === 'delete') {
        const references = await tx.query("select id from pa24.digest_plan where skill = $1 and status <> 'stopped' for update", [entry.name]);
        if (references.rowCount) throw new Error('仍有有效计划引用此 Skill，请先换绑或删除计划。');
      }
      if (input.op === 'save') {
        if (!input.version) throw new Error('缺少 Skill 包内容。');
        const versionId = randomUUID();
        await tx.query(`insert into pa24.skill_version (id, skill_id, package_data, definition, validation_error) values ($1, $2, $3, $4, $5)`,
          [versionId, entry.id, JSON.stringify(input.version.package_data), input.version.definition ? JSON.stringify(input.version.definition) : null, input.version.validation_error]);
        entry = (await tx.query<SkillEntryRow>(`update pa24.skill_entry set draft_version = $2, display_name = $3, revision = revision + 1, updated_at = now() where id = $1 returning *`,
          [entry.id, versionId, input.displayName ?? entry.display_name])).rows[0]!;
      } else if (input.op === 'publish' || input.op === 'rollback') {
        const selected = input.versionId ?? entry.draft_version;
        const version = (await tx.query<SkillVersionRow>('select * from pa24.skill_version where id = $1 and skill_id = $2', [selected, entry.id])).rows[0];
        if (!version?.definition || version.validation_error) throw new Error('此版本尚未通过校验，不能启用。');
        entry = (await tx.query<SkillEntryRow>(`update pa24.skill_entry set active_version = $2, status = 'enabled', revision = revision + 1, updated_at = now() where id = $1 returning *`, [entry.id, selected])).rows[0]!;
      } else {
        entry = (await tx.query<SkillEntryRow>(`update pa24.skill_entry set status = $2, display_name = $3, revision = revision + 1, updated_at = now() where id = $1 returning *`,
          [entry.id, input.op === 'disable' ? 'disabled' : input.op === 'delete' ? 'deleted' : entry.status, input.displayName ?? entry.display_name])).rows[0]!;
      }
      if (input.op === 'disable' || input.blockPlans) {
        const plans = (await tx.query<{ id: string }>("select id from pa24.digest_plan where skill = $1 and status <> 'stopped' for update", [entry.name])).rows;
        for (const plan of plans) await tx.query(`insert into pa24.skill_plan_block (plan_id, skill_id, reason) values ($1, $2, $3)
          on conflict (plan_id) do update set skill_id = excluded.skill_id, reason = excluded.reason`,
          [plan.id, entry.id, input.op === 'disable' ? 'Skill 已禁用；重新启用后计划仍须手工恢复。' : 'Skill 参数或权限要求变化；核验并重新选择 Skill 后再恢复。']);
      }
      await tx.query('update pa24.skill_change set result = $2 where id = $1', [input.requestId, JSON.stringify(entry)]);
      return entry;
    });
  }

  async clearPlanBlock(planId: string): Promise<void> {
    await this.db.query('delete from pa24.skill_plan_block where plan_id = $1', [planId]);
  }
}
