import { createHash } from 'node:crypto';
import { assertToolDeclaration } from './skills.js';
import type { SkillDefinitionLike, SkillRegistryLike, SkillSummaryLike } from './skills.js';

interface SkillManagementDeps {
  registry: SkillRegistryLike | null;
  builtins: () => readonly SkillDefinitionLike[];
  context: () => { cwd: string | null; binding: string | null; enabled: boolean; allowed: readonly string[] };
  plans: () => Promise<readonly { id: string; kind: string; status: string; skill: string }[]>;
}

type SelectionSource = 'builtin' | 'project-dsh';
type SkillType = 'task' | 'template' | 'persona' | 'setup';
interface Selection { id: string; name: string; source: SelectionSource }
interface SkillView extends Selection {
  description: string;
  type: SkillType;
  track: string;
  content: string;
  metadata: Record<string, unknown>;
  fingerprint: string;
  restrictions: string[];
  definition: SkillDefinitionLike;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const message = (error: unknown) => error instanceof Error ? error.message : 'Skill 读取失败。';
const identity = (def: SkillSummaryLike | SkillDefinitionLike, source: SelectionSource): string => source === 'builtin'
  ? `builtin:${def.name}`
  : `project-dsh:${def.name}:${digest([def.provider ?? null, def.path ?? null, def.resourceBase ?? null])}`;

/** Read-only management of the selected definition. Execution still uses
 * SkillCatalog's gate; this module never loads package resources or runs tools.
 * The caller holds the workspace read lease throughout each operation. */
export class SkillManagement {
  constructor(private readonly deps: SkillManagementDeps) {}

  private context(expectedBinding: unknown) {
    const context = this.deps.context();
    if (expectedBinding !== context.binding) throw new Error('工作区已切换，请刷新 Skill 目录。');
    return context;
  }

  async list(expectedBinding: unknown) {
    const context = this.context(expectedBinding);
    const definitions = this.deps.builtins();
    const entries: ({ id: string; name: string; source: SelectionSource; description: string; status: 'loaded' | 'error'; type?: SkillType; track?: string; error?: string })[] =
      definitions.map(def => {
        const view = this.view(def, 'builtin', context);
        return { id: view.id, name: view.name, description: view.description, source: view.source, status: 'loaded', type: view.type, track: view.track };
      });
    let discovery: 'complete' | 'partial' | 'unknown' | 'unavailable' = 'unavailable';
    let discoveryError: string | null = null;
    if (context.cwd && this.deps.registry) {
      try {
        const options = { cwd: context.cwd };
        const snapshot = this.deps.registry.snapshot ? await this.deps.registry.snapshot(options) : null;
        const summaries = snapshot ? snapshot.skills : await this.deps.registry.list(options);
        discovery = snapshot ? snapshot.complete ? 'complete' : 'partial' : 'unknown';
        // Other projects and user-wide providers are deliberately outside the
        // managed workspace. Keep built-in originals even when shadowed.
        const local = summaries.filter(def => def.source === 'project-dsh');
        for (const summary of local) {
          const id = identity(summary, 'project-dsh');
          try {
            const view = await this.read(id, context);
            entries.push({ id, name: view.name, description: view.description, source: view.source, status: 'loaded', type: view.type, track: view.track });
          } catch (error) {
            entries.push({ id, name: summary.name, description: summary.description, source: 'project-dsh', status: 'error', error: message(error) });
          }
        }
      } catch (error) {
        discovery = 'partial';
        discoveryError = message(error);
      }
    }
    return { entries, discovery, discoveryError, workspaceBinding: context.binding, observedAt: new Date().toISOString() };
  }

  async inspect(id: unknown, expectedBinding: unknown) {
    const context = this.context(expectedBinding);
    const { definition: _definition, ...view } = await this.read(id, context);
    let plans: readonly { id: string; kind: string; status: string }[] | null = null;
    let plansError: string | null = null;
    try { plans = (await this.deps.plans()).filter(plan => plan.skill === view.name).map(({ id, kind, status }) => ({ id, kind, status })); }
    catch (error) { plansError = message(error); }
    return { ...view, plans, plansError, workspaceBinding: context.binding };
  }

  async exportMarkdown(id: unknown, fingerprint: unknown, expectedBinding: unknown) {
    const context = this.context(expectedBinding);
    const view = await this.read(id, context);
    if (typeof fingerprint !== 'string' || fingerprint !== view.fingerprint) throw new Error('Skill 内容或来源已变更，请刷新详情后再下载。');
    const def = view.definition;
    // JSON is valid YAML frontmatter and preserves quotes, multiline values,
    // nested metadata and invocation restrictions without hand-escaping YAML.
    const frontmatter = {
      name: view.name, description: view.description,
      ...(def.whenToUse ? { whenToUse: def.whenToUse } : {}),
      ...(def.invocation ? { 'disable-model-invocation': !def.invocation.modelInvocable, 'user-invocable': def.invocation.userInvocable } : {}),
      metadata: view.metadata,
    };
    return { filename: `${view.name}.md`, content: `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${view.content}\n`, fingerprint: view.fingerprint, workspaceBinding: context.binding };
  }

  private async read(id: unknown, context: ReturnType<SkillManagement['context']>): Promise<SkillView> {
    if (typeof id !== 'string') throw new Error('请选择目录中的 Skill。');
    const [source, name] = id.split(':');
    if (!name || !NAME.test(name) || !['builtin', 'project-dsh'].includes(source ?? '')) throw new Error('Skill 来源或名称无效。');
    let definition: SkillDefinitionLike | undefined;
    if (source === 'builtin') definition = this.deps.builtins().find(def => def.name === name);
    else {
      if (!context.cwd || !this.deps.registry) throw new Error('工作区 Skill 目录不可用。');
      definition = await this.deps.registry.get(name, { cwd: context.cwd });
      if (definition?.source !== 'project-dsh') throw new Error('Skill 来源已变更，请刷新目录。');
    }
    if (!definition || definition.name !== name || !definition.content?.trim()) throw new Error('Skill 正文加载失败，请检查文件或刷新目录。');
    const selectedSource = source as SelectionSource;
    if (identity(definition, selectedSource) !== id) throw new Error('Skill 来源已变更，请刷新目录。');
    return this.view(definition, selectedSource, context);
  }

  private view(definition: SkillDefinitionLike, source: SelectionSource, context: ReturnType<SkillManagement['context']>): SkillView {
    const def = structuredClone(definition);
    const metadata = def.metadata ?? {};
    const track = String(metadata.track ?? 'agent');
    const type: SkillType = def.name.startsWith('worker-persona-') || metadata.kind === 'worker-persona' ? 'persona'
      : def.name.endsWith('-setup-flow') || metadata.kind === 'setup' ? 'setup' : track === 'template' ? 'template' : 'task';
    const restrictions: string[] = [];
    if (type === 'persona') restrictions.push('职责 Skill 可查看和导出，不作为普通任务运行。');
    else if (type === 'setup') restrictions.push('接入向导由本地对话办理，不作为普通定时任务。');
    else if (type === 'template') restrictions.push('确定性模板由对应业务管线运行，不进入通用模型执行。');
    else {
      if (!context.enabled) restrictions.push('通用 Skill 执行角色尚未启用。');
      if (!context.allowed.includes(def.name)) restrictions.push('此 Skill 尚未列入工作区业务放行范围。');
    }
    if (!['agent', 'template'].includes(track)) restrictions.push('执行轨无效，需修正 Skill 声明。');
    try { assertToolDeclaration(metadata, ['pa24_work', 'pa24_memory'], def.name); }
    catch (error) { restrictions.push(message(error)); }
    restrictions.push('当前仅核对定义和配置；依赖与实际执行环境尚未验证，运行时仍须检查获胜来源和权限。');
    return {
      id: identity(def, source), name: def.name, description: def.description ?? def.name, source, type, track,
      content: def.content, metadata, restrictions,
      fingerprint: digest([source, def]), definition: def,
    };
  }
}
