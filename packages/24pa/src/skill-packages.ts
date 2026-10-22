import type { SkillRepo, SkillEntryRow, SkillVersionRow, SkillChange } from './repo/skill.js';
import type { SkillDefinitionLike, SkillRegistryLike } from './skills.js';
import { editSkillPackage, exportSkillPackage, importSkillPackage, intelligentSkillCopy, makeSkillPackage, parseSkillMarkdown, readSkillFile, skillContract, skillHash, validateSkillPackage, type SkillPackage } from './skill-package.js';

interface PackageContext { cwd: string; binding: string; repo: SkillRepo }
interface SkillPackagesDeps {
  context(): PackageContext | null;
  registry: SkillRegistryLike | null;
  plans(): Promise<readonly { id: string; kind: string; status: string; skill: string }[]>;
  pausePlan(id: string): Promise<unknown>;
  check(def: SkillDefinitionLike, pkg?: SkillPackage): Promise<string[]>;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Skill 包校验失败。';
const selectedId = (id: unknown) => typeof id === 'string' && /^managed:[a-f0-9-]{36}$/.test(id) ? id.slice(8) : (() => { throw new Error('请选择受管 Skill。'); })();
function label(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 120) throw new Error('Skill 名称须为 1–120 字符。');
  return input.trim();
}
function definitionOf(pkg: SkillPackage): Pick<SkillVersionRow, 'definition' | 'validation_error'> {
  try { const definition = parseSkillMarkdown(readSkillFile(pkg, 'SKILL.md').toString('utf8')); skillContract(definition); return { definition, validation_error: null }; }
  catch (error) { return { definition: null, validation_error: message(error) }; }
}
const permissionShape = (def: SkillDefinitionLike | null) => JSON.stringify([def?.metadata?.tools, def?.metadata?.pa24, def?.metadata?.track, def?.metadata?.kind]);

/** SQL owns the complete version; host discovery is a replaceable view.
 * Workspace leases are held by callers, and each operation captures one repo. */
export class SkillPackages {
  private invalidate: (() => void) | null = null;
  constructor(private readonly deps: SkillPackagesDeps) {}

  register(): () => void {
    if (!this.deps.registry?.registerProvider) return () => {};
    return this.deps.registry.registerProvider(control => {
      this.invalidate = () => { if (!control.signal.aborted) control.invalidate(); };
      return {
        name: 'pa24-managed',
        list: async options => {
          const ctx = this.deps.context();
          if (!ctx || options.cwd !== ctx.cwd) return [];
          const entries = (await ctx.repo.list()).filter(entry => entry.status === 'enabled');
          return Promise.all(entries.map(async entry => {
            const version = await this.version(ctx, entry, entry.active_version!);
            const def = this.definition(entry, version);
            return { ...def, description: def.description!, invocation: { modelInvocable: false, userInvocable: false }, rank: -10,
              locator: { id: entry.id, version: version.id, binding: ctx.binding } };
          }));
        },
        get: async (candidate, options) => {
          const ctx = this.deps.context();
          const locator = candidate.locator as { id?: string; version?: string; binding?: string } | undefined;
          if (!ctx || ctx.cwd !== options.cwd || locator?.binding !== ctx.binding || !locator.id || !locator.version) return undefined;
          const entry = await ctx.repo.get(locator.id);
          if (!entry || entry.status !== 'enabled' || entry.active_version !== locator.version) { this.refresh(); return undefined; }
          return { ...this.definition(entry, await this.version(ctx, entry, locator.version)), invocation: { modelInvocable: false, userInvocable: false } };
        },
      };
    });
  }

  refresh(): void { this.invalidate?.(); }
  context(binding: unknown): PackageContext {
    const ctx = this.deps.context();
    if (!ctx || ctx.binding !== binding) throw new Error('工作区未就绪或已切换，请刷新 Skill 管理。');
    return ctx;
  }
  private async version(ctx: PackageContext, entry: SkillEntryRow, id: string): Promise<SkillVersionRow> {
    const version = await ctx.repo.version(id);
    if (!version || version.skill_id !== entry.id) throw new Error('Skill 版本已缺失，不能回退到同名来源。');
    validateSkillPackage(version.package_data);
    return version;
  }
  definition(entry: SkillEntryRow, version: SkillVersionRow): SkillDefinitionLike {
    if (!version.definition || version.validation_error) throw new Error(version.validation_error ?? 'Skill 尚未通过校验。');
    return { ...structuredClone(version.definition), name: entry.name, description: `${entry.display_name} · ${version.definition.description}`,
      source: 'pa24-managed', provider: 'pa24-managed',
      metadata: { ...version.definition.metadata, pa24Identity: { id: entry.id, versionId: version.id, packageHash: version.package_data.hash } },
      resourceBase: { kind: 'opaque', description: '不可变受管 Skill 包；资源仅在已授权运行中读取。' } };
  }

  async resolveName(name: string): Promise<SkillDefinitionLike | undefined> {
    const ctx = this.deps.context();
    if (!ctx) return undefined;
    const entry = await ctx.repo.byName(name);
    if (!entry) return undefined;
    if (entry.status !== 'enabled' || !entry.active_version) throw new Error('该 Skill 未启用或已删除，不能改用同名来源。');
    return this.definition(entry, await this.version(ctx, entry, entry.active_version));
  }

  async list(binding: unknown) {
    const ctx = this.context(binding);
    return Promise.all((await ctx.repo.list(true)).map(async entry => {
      const base = { id: `managed:${entry.id}`, name: entry.display_name, internalName: entry.name, source: 'managed' as const, managedStatus: entry.status };
      try {
        const version = await this.version(ctx, entry, entry.draft_version);
        return { ...base,
        status: version.validation_error ? 'error' as const : 'loaded' as const, error: version.validation_error,
        description: version.definition?.description ?? '未完成草稿', verification: await ctx.repo.verification(entry.id, version.id),
        type: this.type(version.definition), track: String(version.definition?.metadata?.track ?? 'agent') };
      } catch (error) { return { ...base, status: 'error' as const, error: message(error), description: '该条目不可读取，请修复版本资料。' }; }
    }));
  }
  async check(definition: SkillDefinitionLike, pkg: SkillPackage): Promise<string[]> { return this.deps.check(definition, pkg); }
  private type(def: SkillDefinitionLike | null) {
    return def?.metadata?.kind === 'worker-persona' ? 'persona' : def?.metadata?.kind === 'setup' ? 'setup' : def?.metadata?.track === 'template' ? 'template' : 'task';
  }

  async inspect(id: unknown, binding: unknown, versionId?: string) {
    const ctx = this.context(binding), entry = await ctx.repo.get(selectedId(id));
    if (!entry) throw new Error('Skill 不存在。');
    const version = await this.version(ctx, entry, versionId ?? entry.draft_version);
    const restrictions = version.definition ? await this.deps.check(version.definition, version.package_data) : [version.validation_error ?? 'Skill 尚未通过校验。'];
    let plans = null, plansError: string | null = null;
    try { plans = (await this.deps.plans()).filter(p => p.skill === entry.name); }
    catch (error) { plansError = message(error); }
    return { id: `managed:${entry.id}`, name: entry.display_name, internalName: entry.name, description: version.definition?.description ?? '未完成草稿',
      source: 'managed' as const, type: this.type(version.definition), track: String(version.definition?.metadata?.track ?? 'agent'),
      content: version.definition?.content ?? '', markdown: readSkillFile(version.package_data, 'SKILL.md').toString('utf8'),
      metadata: version.definition?.metadata ?? {}, fingerprint: version.package_data.hash, entry, versionId: version.id,
      versions: await ctx.repo.versions(entry.id), files: version.package_data.files.map(({ content: _content, ...file }) => file),
      verification: await ctx.repo.verification(entry.id, version.id), restrictions, plans, plansError, workspaceBinding: binding };
  }

  async download(id: unknown, versionId: string, binding: unknown) {
    const ctx = this.context(binding), entry = await ctx.repo.get(selectedId(id));
    if (!entry) throw new Error('Skill 不存在。');
    const version = await this.version(ctx, entry, versionId);
    return { filename: `${entry.name}.zip`, base64: (await exportSkillPackage(version.package_data)).toString('base64'), workspaceBinding: binding };
  }

  async capture(id: unknown, versionId: string, binding: unknown): Promise<SkillPackage> {
    const ctx = this.context(binding), entry = await ctx.repo.get(selectedId(id));
    if (!entry || entry.status === 'deleted') throw new Error('Skill 已删除或不存在。');
    return (await this.version(ctx, entry, versionId)).package_data;
  }

  async change(input: Record<string, unknown>, copiedPackage?: SkillPackage | (() => Promise<SkillPackage>)) {
    const ctx = this.context(input.workspaceBinding);
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId)) throw new Error('缺少有效的操作标识。');
    const requestHash = skillHash(JSON.stringify(input));
    const repeated = await ctx.repo.repeated(input.requestId, requestHash);
    if (repeated) { this.refresh(); return { entry: repeated, repeated: true, warnings: await this.reconcilePlans() }; }
    const op = String(input.op);
    if (!['save', 'publish', 'disable', 'delete', 'rollback', 'rename'].includes(op)) throw new Error('未知 Skill 操作。');
    const entry = input.id ? await ctx.repo.get(selectedId(input.id)) : null;
    if (input.id && !entry) throw new Error('Skill 已不存在。');
    let pkg = typeof copiedPackage === 'function' ? await copiedPackage() : copiedPackage;
    if (pkg && (input.base64 !== undefined || input.markdown !== undefined)) throw new Error('复制与上传／编辑不能混为同一次操作。');
    if (input.intelligentCopy === true) {
      if (op !== 'save' || entry || !pkg || !input.copyFrom) throw new Error('智能转换须建立一个新的模板副本。');
      pkg = intelligentSkillCopy(pkg);
    }
    if (op === 'save') {
      if (typeof input.base64 === 'string') {
        if (input.base64.length > 12 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new Error('上传文件编码或大小无效。');
        pkg = await importSkillPackage(String(input.filename ?? ''), Buffer.from(input.base64, 'base64'));
      } else if (typeof input.markdown === 'string') {
        pkg = entry ? editSkillPackage((await this.version(ctx, entry, typeof input.baseVersionId === 'string' ? input.baseVersionId : entry.draft_version)).package_data, input.markdown)
          : makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(input.markdown) }]);
      }
      if (!pkg) throw new Error('缺少 Skill 草稿或上传文件。');
    }
    let blockPlans = false;
    if (op === 'publish' || op === 'rollback') {
      if (!entry) throw new Error('请先保存草稿。');
      const next = await this.version(ctx, entry, typeof input.versionId === 'string' ? input.versionId : entry.draft_version);
      if (!next.definition) throw new Error(next.validation_error ?? 'Skill 尚未通过校验。');
      const errors = await this.deps.check(next.definition, next.package_data);
      if (errors.length) throw new Error(errors.join('\n'));
      const before = entry.active_version ? await this.version(ctx, entry, entry.active_version) : null;
      blockPlans = !!before && (permissionShape(before.definition) !== permissionShape(next.definition)
        || JSON.stringify(before.package_data.files.map(f => f.path)) !== JSON.stringify(next.package_data.files.map(f => f.path)));
      if (input.confirm !== true) throw new Error('请先查看版本内容、所需权限与受影响计划，再明确启用此版本。');
    }
    const saved = await ctx.repo.change({
      requestId: input.requestId, requestHash, op: op as SkillChange['op'], id: entry?.id,
      expectedRevision: typeof input.expectedRevision === 'number' ? input.expectedRevision : undefined,
      displayName: input.displayName === undefined ? undefined : label(input.displayName),
      source: copiedPackage ? String(input.copyFrom).startsWith('builtin:') ? 'builtin-copy' : 'file-copy' : typeof input.base64 === 'string' ? 'imported' : 'personal',
      ...(pkg ? { version: { package_data: pkg, ...definitionOf(pkg) } } : {}),
      ...(typeof input.versionId === 'string' ? { versionId: input.versionId } : {}), blockPlans,
    });
    this.refresh();
    return { entry: saved, repeated: false, warnings: await this.reconcilePlans() };
  }

  async reconcilePlans(): Promise<string[]> {
    const ctx = this.deps.context();
    if (!ctx) return [];
    const warnings: string[] = [];
    for (const block of await ctx.repo.planBlocks()) {
      try { await this.deps.pausePlan(block.plan_id); }
      catch (error) { warnings.push(`${block.plan_id}：已阻止新运行，原生触发清理待重试：${message(error)}`); }
    }
    return warnings;
  }
}
