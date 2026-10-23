import type { Repos, SkillRunRow } from './repo.js';
import type { SkillPackages } from './skill-packages.js';
import type { SkillManagement } from './skill-management.js';
import { parseSkillMarkdown, readSkillFile } from './skill-package.js';

export function templateRunParameters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模板参数须为字段映射。');
  const parameters = value as Record<string, unknown>;
  if (Object.keys(parameters).some(key => key !== 'title')) throw new Error('此确定性模板仅支持 title 标题参数。');
  if (parameters.title !== undefined && (typeof parameters.title !== 'string' || !parameters.title.trim() || parameters.title.length > 120)) throw new Error('模板标题须为 1–120 字。');
  return parameters.title === undefined ? {} : { title: String(parameters.title).trim() };
}

/** Resolve a selected identity once and capture its immutable content. File
 * providers stay file providers; an execution never invents a managed copy. */
export async function captureRunSkill(input: {
  id: unknown; versionId?: unknown; previous?: SkillRunRow | null; original: boolean;
  binding: string; repos: Repos; packages: SkillPackages; management?: SkillManagement;
}) {
  const { previous, original, repos, binding, packages } = input;
  const id = previous ? previous.snapshot.provider?.id ?? `managed:${previous.skill_id}` : input.id;
  if (typeof id !== 'string') throw new Error('请选择目录中的 Skill。');
  if (id.startsWith('managed:')) {
    const entry = await repos.skills.get(id.slice(8));
    if (!entry || ['disabled', 'deleted'].includes(entry.status)) throw new Error('Skill 已禁用、删除或不存在，不能开始新运行。');
    const versionId = original ? previous!.version_id : previous ? entry.active_version : input.versionId ?? entry.active_version ?? entry.draft_version;
    if (typeof versionId !== 'string' || !versionId) throw new Error('此 Skill 尚未启用。');
    const pkg = original ? previous!.snapshot.package : await packages.capture(id, versionId, binding);
    const definition = original ? previous!.snapshot.definition : parseSkillMarkdown(readSkillFile(pkg, 'SKILL.md').toString('utf8'));
    return { id, runSkillId: entry.id, name: entry.name, displayName: entry.display_name, versionId,
      revision: entry.revision, entry, pkg, definition, provider: undefined };
  }
  if (!input.management || !/^(builtin|project-dsh):/.test(id)) throw new Error('所选 Skill 来源不可用。');
  const view = await input.management.inspect(id, binding);
  const current = await input.management.capture(id, view.fingerprint, binding);
  const definition = original ? previous!.snapshot.definition : parseSkillMarkdown(readSkillFile(current, 'SKILL.md').toString('utf8'));
  // A managed name cannot be revived through a registry's stale file alias.
  if (await repos.skills.byName(definition.name)) throw new Error('此名称属于受管 Skill，请从个人目录选择，不能以文件来源绕过状态。');
  const pkg = original ? previous!.snapshot.package : current;
  return { id, runSkillId: id, name: definition.name, displayName: definition.description ?? definition.name,
    versionId: original ? previous!.version_id : pkg.hash, revision: null, entry: null, pkg, definition,
    provider: { id, fingerprint: view.fingerprint } };
}
