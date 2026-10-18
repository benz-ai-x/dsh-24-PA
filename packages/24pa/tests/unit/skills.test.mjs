import { describe, expect, it } from 'vitest';
import { SkillCatalog, BUILTIN_DIGEST_SKILLS } from '../../lib/skills.js';

describe('F40：任务 skill 目录', () => {
  it('内置三件：digest-* 前缀、模板轨、kind 映射齐全', () => {
    expect(BUILTIN_DIGEST_SKILLS.map(s => s.name)).toEqual(['digest-morning', 'digest-evening', 'digest-weekly', 'meeting-prep']);
    for (const s of BUILTIN_DIGEST_SKILLS) {
      expect(s.metadata.track).toBe('template');
      expect(['morning', 'evening', 'weekly', 'meeting_prep']).toContain(s.metadata.kind);
    }
  });

  it('宿主未挂载（registry 缺席）：目录回落内置三件，模板轨可用', async () => {
    const catalog = new SkillCatalog(null);
    const list = await catalog.list();
    expect(list).toHaveLength(4);
    expect(list.every(s => s.source === 'builtin' && s.track === 'template')).toBe(true);
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
