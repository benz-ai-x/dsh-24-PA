import { describe, expect, it } from 'vitest';
import { SkillCatalog, BUILTIN_TASK_SKILLS } from '../../lib/skills.js';

describe('F40：任务 skill 目录', () => {
  it('内置三件：digest-* 前缀、模板轨、kind 映射齐全', () => {
    expect(BUILTIN_TASK_SKILLS.map(s => s.name)).toEqual(['waiting-followup', 'digest-morning', 'digest-evening', 'digest-weekly', 'handwriting-review-flow', 'meeting-prep']);
    for (const s of BUILTIN_TASK_SKILLS) {
      expect(s.metadata.track).toBe(s.name === 'waiting-followup' ? 'agent' : 'template');
      expect(['morning', 'evening', 'weekly', 'meeting_prep', 'review']).toContain(s.metadata.kind);
    }
  });

  it('宿主未挂载（registry 缺席）：目录回落内置三件，模板轨可用', async () => {
    const catalog = new SkillCatalog(null);
    const list = await catalog.list();
    const taskSkills = list.filter(s => !s.name.startsWith('worker-persona'));
    expect(taskSkills.map(s => s.name)).toEqual(['waiting-followup', 'digest-morning', 'digest-evening', 'digest-weekly', 'handwriting-review-flow', 'meeting-prep']);
    expect(taskSkills.every(s => s.source === 'builtin' && s.track === (s.name === 'waiting-followup' ? 'agent' : 'template'))).toBe(true);
    expect(list.every(s => !s.name.startsWith('worker-persona') && !s.name.endsWith('-setup-flow'))).toBe(true); // F42/F43：persona/向导件不进计划绑定面
    expect(await catalog.content('worker-persona-memo')).toContain('备忘整理'); // persona 件经 content() 仍可载
    expect((await catalog.find('digest-morning'))?.kind).toBe('morning');
    expect(await catalog.find('nope')).toBeNull();
    expect(await catalog.content('digest-morning')).toContain('事实');
  });

  it('宿主完整定义决定来源与执行轨；读取失败的条目不进入可绑定目录', async () => {
    const definitions = new Map(new SkillCatalog(null).builtinAll().map(s => [s.name, s]));
    definitions.set('digest-morning', { name: 'digest-morning', description: '工作区覆盖', source: 'project-dsh', content: '晨报正文', metadata: { track: 'agent' } });
    definitions.set('standup-prep', { name: 'standup-prep', description: '站会准备', source: 'project-dsh', content: '正文' });
    const registry = { register() {},
      list: async () => [...definitions.values(), { name: 'broken', source: 'project-dsh' }].map(({ name, description, source }) => ({ name, description, source })),
      get: async name => { if (name === 'broken') throw new Error('read failed'); return definitions.get(name); },
    };
    const catalog = new SkillCatalog(registry);
    const byName = Object.fromEntries((await catalog.list()).map(s => [s.name, s]));
    expect(byName['digest-morning']).toMatchObject({ track: 'agent', source: 'project-dsh' });
    expect(byName['standup-prep'].track).toBe('agent');
    expect(byName['digest-evening'].source).toBe('builtin');
    expect(byName.broken).toBeUndefined();
    await expect(catalog.resolveForAgentRun('broken', ['pa24_work'])).rejects.toThrow('read failed');
  });

});

describe('F44：工作流参数与受控接入', () => {
  it('params()：内置 review-flow 返回默认模板；registry 定义优先（工作区覆盖生效）', async () => {
    const fallback = new SkillCatalog(null);
    const params = await fallback.params('handwriting-review-flow');
    expect(String(params.pendingRemindTemplate)).toContain('{noteId}');
    const mounted = new SkillCatalog({
      register: () => () => {},
      list: async () => [{ name: 'handwriting-review-flow', description: '覆盖', provider: 'filesystem', source: 'project-dsh' }],
      get: async () => ({ name: 'handwriting-review-flow', description: '', content: '', metadata: { params: { pendingRemindTemplate: '私稿提醒 {noteId}' } } }),
    });
    expect((await mounted.params('handwriting-review-flow')).pendingRemindTemplate).toBe('私稿提醒 {noteId}');
  });
});

describe('F41/F44：工具声明平台层强制', () => {
  it('声明白名单外工具＝越权拒绝；子集与缺省放行', async () => {
    const { assertToolDeclaration } = await import('../../lib/skills.js');
    expect(() => assertToolDeclaration({ tools: ['bash', 'read'] }, ['pa24_work', 'pa24_memory'], 's1')).toThrow(/越权.*bash/);
    expect(() => assertToolDeclaration(undefined, ['pa24_work'], 's2')).not.toThrow();
    expect(() => assertToolDeclaration({}, ['pa24_work'], 's3')).not.toThrow();
    expect(() => assertToolDeclaration({ tools: ['pa24_work'] }, ['pa24_work', 'pa24_memory'], 's4')).not.toThrow();
    expect(() => assertToolDeclaration({ tools: [] }, ['pa24_work'], 's5')).not.toThrow();
  });
});

describe('F43：接入向导 skill 化', () => {
  it('指南可读时注册两向导件（正文=指南全文，agent 轨）；不可读时安全缺位', async () => {
    const { setupGuideSkills } = await import('../../lib/skills.js');
    const flows = setupGuideSkills(file => (file === 'feishu-setup.md' ? '# 飞书指南正文' : '# 企微指南正文'));
    expect(flows.map(s => s.name)).toEqual(['feishu-setup-flow', 'wecom-setup-flow']);
    expect(flows[0].content).toBe('# 飞书指南正文');
    expect(flows.every(s => s.metadata.track === 'agent' && s.metadata.kind === 'setup')).toBe(true);
    expect(setupGuideSkills(() => null)).toEqual([]);
    // 目录回落态含向导件（readGuide 经构造器注入）
    const catalog = new SkillCatalog(null, () => null, file => (file === 'feishu-setup.md' ? '# F' : null));
    const list = await catalog.list();
    // F45 修复后：向导件不进计划绑定面，但经 content() 可载（agent 按其执行）
    expect(list.map(s => s.name)).not.toContain('feishu-setup-flow');
    expect(await catalog.content('feishu-setup-flow')).toBe('# F');
    expect(await catalog.content('wecom-setup-flow')).toBeNull();
  });
});

describe('arch-6：执行轨判定收进 SkillCatalog（resolveForAgentRun）', () => {
  it('模板轨 skill 在 seam 被拒绝，不进模型回合（spec 2.11 零模型红线）', async () => {
    const catalog = new SkillCatalog(null);
    await expect(catalog.resolveForAgentRun('digest-morning', ['pa24_work'])).rejects.toThrow(/模板轨/);
    await expect(catalog.resolveForAgentRun('handwriting-review-flow', ['pa24_work'])).rejects.toThrow(/模板轨/);
  });

  it('目录外名拒绝（含绑定面外的向导件）；工作区 agent 轨 skill 放行并返回正文', async () => {
    const catalog = new SkillCatalog(null);
    await expect(catalog.resolveForAgentRun('ghost-skill', ['pa24_work'])).rejects.toThrow(/不在目录中/);
    // 向导件不在计划绑定面（isBindable 过滤），resolveForAgentRun 同样拒绝。
    const withGuide = new SkillCatalog(null, () => null, file => (file === 'feishu-setup.md' ? '# 指南' : null));
    await expect(withGuide.resolveForAgentRun('feishu-setup-flow', ['pa24_work'])).rejects.toThrow(/不在目录中/);
    // 绑定面内的 agent 轨件只能来自工作区（内置任务件全是模板轨）。
    const registry = {
      register() {},
      async list() { return [{ name: 'ws-agent-skill', description: 'x', source: 'project-dsh' }]; },
      async get() { return { name: 'ws-agent-skill', description: 'x', source: 'project-dsh', content: '按此执行', metadata: { track: 'agent' } }; },
    };
    const resolved = await new SkillCatalog(registry).resolveForAgentRun('ws-agent-skill', ['pa24_work', 'pa24_memory']);
    expect(resolved.name).toBe('ws-agent-skill');
    expect(resolved.content).toBe('按此执行');
  });

  it('工具声明越权在 seam 拒绝（收紧红线随轨判定收口）', async () => {
    const registry = {
      register() {},
      async list() { return [{ name: 'e2e-overclaim', description: 'x', source: 'project-dsh' }]; },
      async get() { return { name: 'e2e-overclaim', description: 'x', source: 'project-dsh', content: '正文', metadata: { track: 'agent', tools: ['pa24_work', 'shell'] } }; },
    };
    const catalog = new SkillCatalog(registry);
    await expect(catalog.resolveForAgentRun('e2e-overclaim', ['pa24_work', 'pa24_memory'])).rejects.toThrow(/越权/);
  });
});

describe('同一完整定义决定执行轨、正文和工具准入', () => {
  it('第一次读取失败即拒绝，不能用随后模板定义拼出 agent 轨', async () => {
    let reads = 0;
    const catalog = new SkillCatalog({ register() {}, list: async () => [{ name: 'unstable', source: 'project-dsh' }],
      get: async () => { if (++reads === 1) throw new Error('definition unavailable'); return { name: 'unstable', source: 'project-dsh', content: 'TEMPLATE_BODY', metadata: { track: 'template' } }; } });
    await expect(catalog.resolveForAgentRun('unstable', ['pa24_work'])).rejects.toThrow(/definition unavailable|加载/);
    expect(reads).toBe(1);
  });
  it('一次执行只读一份定义，正文与准入不混用后续版本', async () => {
    let reads = 0;
    const catalog = new SkillCatalog({ register() {}, list: async () => [{ name: 'changing', source: 'project-dsh' }],
      get: async () => ({ name: 'changing', source: 'project-dsh', content: ++reads === 1 ? 'BODY_A' : 'BODY_B', metadata: { track: reads === 1 ? 'agent' : 'template', tools: ['pa24_work'] } }) });
    expect((await catalog.resolveForAgentRun('changing', ['pa24_work'])).content).toBe('BODY_A');
    expect(reads).toBe(1);
  });
  it('全局用户 skill 不能凭 digest 前缀伪装内置执行来源', async () => {
    const catalog = new SkillCatalog({ register() {}, list: async () => [{ name: 'digest-foreign', source: 'user-dsh' }],
      get: async () => ({ name: 'digest-foreign', source: 'user-dsh', content: 'FOREIGN', metadata: { track: 'agent' } }) });
    await expect(catalog.resolveForAgentRun('digest-foreign', ['pa24_work'])).rejects.toThrow(/不在目录中|来源/);
  });
});
