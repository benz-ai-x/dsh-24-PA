// 任务 skill 目录（F40/spec 2.11）：「做什么」的统一单元骑宿主原生 dsh-skill
// 体系——插件内置三件经 ctx.skills 注册（runtime provider），工作区自定义经
// dsh-skill-filesystem 发现于 <workspace>/.dsh/skills/（<name>.md 或
// <name>/SKILL.md，frontmatter 必需 name/description）。宿主未挂载 skill 三包
// 时 ctx.skills 缺席，目录回落内置三件——模板轨照常可执行，只是无自定义面。
// 执行轨（spec 2.11）：metadata.track＝'template'（确定性组装，不过模型）或
// 'agent'（任务指令进模型回合，F41 交付）；缺省按 agent。

export type SkillTrack = 'template' | 'agent';

export interface TaskSkill {
  /** kebab-case 名（digest-* 为插件内置保留前缀）。 */
  name: string;
  description: string;
  track: SkillTrack;
  /** builtin＝插件 runtime 注册；其余为宿主目录来源标签。 */
  source: string;
  /** 模板轨内置 skill 关联的计划类型（渲染口径）。 */
  kind?: string;
}

/** 宿主 ctx.skills 的最小结构面（dsh-skill 的 SkillRegistry 子集）。 */
export interface SkillRegistryLike {
  register(skill: {
    name: string;
    description: string;
    whenToUse?: string;
    content: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): () => void;
  list(options?: { cwd?: string }): Promise<readonly { name: string; description: string; metadata?: Record<string, unknown>; provider?: string; source?: string }[]>;
  get(name: string, options?: { cwd?: string }): Promise<{ name: string; content: string; metadata?: Record<string, unknown>; provider?: string; source?: string } | undefined>;
}

/** 内置三件（spec 2.11/F40）：正文＝渲染规则与输出契约，模板轨组装在代码层。 */
export const BUILTIN_DIGEST_SKILLS: readonly { name: string; description: string; whenToUse: string; content: string; metadata: { track: SkillTrack; kind: string; pa24: true } }[] = [
  {
    name: 'digest-morning',
    description: '晨报：当日计划的事实聚合与建议（模板轨，确定性组装）',
    whenToUse: '晨报计划到点投递，或主人要求「出晨报/今日概览」。',
    content: [
      '按「事实与建议分开」的契约组装晨报：',
      '1. 事实（来自实际对象）：日历今日日程、到期/计划中待办、进行中等待事项、待审手写数、已审核笔记、项目进展——逐项带来源；',
      '2. 建议（推断，需主人选定）：今日重点（按到期与估时，超 6 小时提示延后），不自动修改任何任务、日程或记忆；',
      '3. 数据缺失单列节，明确「没有事项」与「暂时无法读取」的区别；',
      '语音版走口播变体（剥离同步时间戳、来源括注与链接），超限截断并播报提示。',
    ].join('\n'),
    metadata: { track: 'template', kind: 'morning', pa24: true },
  },
  {
    name: 'digest-evening',
    description: '晚间复盘：当日完成情况与下一步（模板轨，确定性组装）',
    whenToUse: '晚间回顾计划到点投递，或主人要求「出复盘」。',
    content: [
      '按「事实与建议分开」的契约组装晚间复盘：',
      '1. 事实：近 24 小时完成的任务、今日日程、剩余到期待办（标注逾期）、等待事项检查点、待审手写数；',
      '2. 建议：优先处理逾期项（是否延期由主人决定），无逾期则推进项目下一步或安排明日重点；',
      '3. 数据缺失单列节；不自动修改任何对象、不写记忆。',
    ].join('\n'),
    metadata: { track: 'template', kind: 'evening', pa24: true },
  },
  {
    name: 'digest-weekly',
    description: '每周回顾：一周进展与下周重点（模板轨，确定性组装）',
    whenToUse: '每周回顾计划到点投递，或主人要求「出周报」。',
    content: [
      '按「事实与建议分开」的契约组装每周回顾：',
      '1. 事实：本周完成事项汇总、项目进展比例、逾期与等待积压、待审队列；',
      '2. 建议：下周重点（按项目下一步与到期分布），不自动修改任何对象；',
      '3. 数据缺失单列节。',
    ].join('\n'),
    metadata: { track: 'template', kind: 'weekly', pa24: true },
  },
  {
    name: 'meeting-prep',
    description: '会前准备：按日程生成资料包与纪要行动（模板轨，专属构建管线）',
    whenToUse: '会前准备计划到点（meeting_prep_build），或主人要求会前资料。',
    content: [
      '会前准备的契约：按目标日程聚合相关笔记/纪要/任务与等待事项，',
      '生成资料包（带来源）与建议议程；产出经 meeting_prep_build 专属管线交付。',
    ].join('\n'),
    metadata: { track: 'template', kind: 'meeting_prep', pa24: true },
  },
];

/** 经 DigestService/DigestPlanRow 绑定的计划 skill 目录访问面。 */
export class SkillCatalog {
  constructor(
    private readonly registry: SkillRegistryLike | null,
    /** 工作区根（fs provider 的 projectRoot 探测点；未绑定时内置回落不受影响）。 */
    private readonly cwd: () => string | null = () => null,
  ) {}

  /** 内置三件注册进宿主目录（runtime provider）；宿主未挂载时安全跳过。 */
  registerBuiltins(): void {
    if (!this.registry) return;
    for (const skill of BUILTIN_DIGEST_SKILLS) {
      this.registry.register({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        content: skill.content,
        // registry 装载校验要求 source 为字符串（SkillSummary 必填位）。
        source: 'runtime',
        metadata: { ...skill.metadata },
      });
    }
  }

  private toTaskSkill(entry: { name: string; description: string; metadata?: Record<string, unknown>; provider?: string; source?: string }): TaskSkill {
    const builtin = entry.provider === 'runtime' || entry.name.startsWith('digest-');
    return {
      name: entry.name,
      description: entry.description,
      track: entry.metadata?.track === 'template' ? 'template' : 'agent',
      source: builtin ? 'builtin' : entry.source === 'runtime' ? 'builtin' : entry.source ?? 'workspace',
      kind: typeof entry.metadata?.kind === 'string' ? entry.metadata.kind : undefined,
    };
  }

  /** 全目录（内置＋工作区自定义）；宿主目录缺席时回落内置三件。 */
  async list(): Promise<TaskSkill[]> {
    if (!this.registry) {
      return BUILTIN_DIGEST_SKILLS.map(s => ({ name: s.name, description: s.description, track: s.metadata.track, source: 'builtin', kind: s.metadata.kind }));
    }
    const raw = await this.registry.list({ cwd: this.cwd() ?? undefined });
    // list() 的 SkillSummary 不带 metadata（track/kind 在 get() 的 Definition）——
    // 逐名取一次补富；get 失败回退原条目（视为缺省 agent 轨）。
    const entries = await Promise.all(raw.map(async e => {
      try {
        const def = await this.registry!.get(e.name, { cwd: this.cwd() ?? undefined });
        return def ? { ...e, metadata: def.metadata ?? e.metadata } : e;
      } catch {
        return e;
      }
    }));
    const seen = new Set(entries.map(e => e.name));
    const builtins = BUILTIN_DIGEST_SKILLS.filter(s => !seen.has(s.name)).map(s => ({ name: s.name, description: s.description, provider: 'runtime', metadata: { ...s.metadata } }));
    // spec 2.11：计划绑定面＝内置＋工作区（project-dsh）；用户全局目录
    // （user-dsh/user-agents）是主人自己的 agent 技能库，不进周期任务下拉。
    return [...entries, ...builtins]
      .map(e => this.toTaskSkill(e))
      .filter(s => s.source === 'builtin' || s.source === 'project-dsh' || s.source === 'runtime');
  }

  /** 按 kebab-case 名校验存在性；返回 null＝目录中无此名。 */
  async find(name: string): Promise<TaskSkill | null> {
    return (await this.list()).find(s => s.name === name) ?? null;
  }

  /** 加载 skill 正文（agent 轨任务指令；内置三件返回契约正文）。 */
  async content(name: string): Promise<string | null> {
    const loaded = await this.registry?.get(name, { cwd: this.cwd() ?? undefined });
    if (loaded?.content) return loaded.content;
    return BUILTIN_DIGEST_SKILLS.find(s => s.name === name)?.content ?? null;
  }
}
