import { describe, expect, it } from 'vitest';
import { SkillCatalog, BUILTIN_TASK_SKILLS } from '../../lib/skills.js';

describe('F40：任务 skill 目录', () => {
  it('内置三件：digest-* 前缀、模板轨、kind 映射齐全', () => {
    expect(BUILTIN_TASK_SKILLS.map(s => s.name)).toEqual(['digest-morning', 'digest-evening', 'digest-weekly', 'handwriting-review-flow', 'meeting-prep']);
    for (const s of BUILTIN_TASK_SKILLS) {
      expect(s.metadata.track).toBe('template');
      expect(['morning', 'evening', 'weekly', 'meeting_prep', 'review']).toContain(s.metadata.kind);
    }
  });

  it('宿主未挂载（registry 缺席）：目录回落内置三件，模板轨可用', async () => {
    const catalog = new SkillCatalog(null);
    const list = await catalog.list();
    const taskSkills = list.filter(s => !s.name.startsWith('worker-persona'));
    expect(taskSkills.map(s => s.name)).toEqual(['digest-morning', 'digest-evening', 'digest-weekly', 'handwriting-review-flow', 'meeting-prep']);
    expect(taskSkills.every(s => s.source === 'builtin' && s.track === 'template')).toBe(true);
    expect(list.every(s => !s.name.startsWith('worker-persona') && !s.name.endsWith('-setup-flow'))).toBe(true); // F42/F43：persona/向导件不进计划绑定面
    expect(await catalog.content('worker-persona-memo')).toContain('备忘整理'); // persona 件经 content() 仍可载
    expect((await catalog.find('digest-morning'))?.kind).toBe('morning');
    expect(await catalog.find('nope')).toBeNull();
    expect(await catalog.content('digest-morning')).toContain('事实');
  });

  it('宿主挂载：合并工作区来源，metadata.track 判轨，同名内置不被工作区覆盖', async () => {
    const registry = {
      register: () => () => {},
      list: async () => [
        { name: 'digest-morning', description: '工作区同名', provider: 'filesystem', metadata: { track: 'agent' } },
        { name: 'standup-prep', description: '自定义站会准备', source: 'project-dsh', metadata: {} },
        { name: 'weekly-report-x', description: '自定义', source: 'project-dsh', metadata: { track: 'template' } },
      ],
      get: async name => (name === 'standup-prep' ? { name, content: '正文', description: '' } : undefined),
    };
    const catalog = new SkillCatalog(registry);
    const list = await catalog.list();
    const byName = Object.fromEntries(list.map(s => [s.name, s]));
    // 工作区同名 digest-morning 走宿主胜者（filesystem 覆盖 runtime），目录如实反映
    expect(byName['digest-morning'].track).toBe('agent');
    expect(byName['standup-prep'].track).toBe('agent'); // 缺省 track=agent
    expect(byName['weekly-report-x'].track).toBe('template');
    // 未被工作区覆盖的内置其余两件补齐
    expect(byName['digest-evening'].source).toBe('builtin');
    expect(await catalog.content('standup-prep')).toBe('正文');
    expect(await catalog.content('digest-evening')).toContain('复盘');
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
