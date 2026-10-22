import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { SkillDefinitionLike } from './skills.js';
import { skillContract, type SkillPackage } from './skill-package.js';

/** Dependency inspection never runs a declared command or reads a secret's
 * value into a receipt. Available dependencies still do not grant tools. */
export async function skillRequirements(definition: SkillDefinitionLike, pkg?: SkillPackage, environment = process.env): Promise<string[]> {
  const requires = skillContract(definition)?.dependencies;
  if (!requires) return [];
  const errors: string[] = [];
  for (const path of requires.resources ?? []) if (!pkg?.files.some(file => file.path === path)) errors.push(`缺少包内资源：${path}`);
  for (const name of requires.environment ?? []) if (!environment[name]?.trim()) errors.push(`缺少环境变量：${name}（请在宿主环境配置，勿写入 Skill）`);
  for (const command of requires.commands ?? []) {
    let found = false;
    for (const directory of (environment.PATH ?? '').split(delimiter).filter(Boolean)) {
      try { const path = join(directory, command); if (!(await stat(path)).isFile()) continue; await access(path, constants.X_OK); found = true; break; }
      catch { /* inspect the remaining PATH entries */ }
    }
    if (!found) errors.push(`缺少可执行依赖：${command}；安装并加入宿主 PATH 后重新检查。`);
  }
  return errors;
}
