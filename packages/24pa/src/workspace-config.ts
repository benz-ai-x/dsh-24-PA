import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError, CONFIG_UPDATE_ALLOWED, parseAgentsMd, rawAgentsMdConfig, replaceAgentsMdConfig, validateConfig, type ParsedAgentsMd, type PaConfig } from './config.js';
import { readSecretStore, type SecretStore } from './secrets.js';

export interface WorkspaceConfiguration extends ParsedAgentsMd { secrets: SecretStore }

/** Read one target workspace before opening any of its resources. */
export async function readWorkspaceConfiguration(path: string): Promise<WorkspaceConfiguration> {
  const [source, secrets] = await Promise.all([readFile(join(path, 'AGENTS.md'), 'utf8'), readSecretStore(path)]);
  return { ...parseAgentsMd(source), secrets };
}

/** The caller owns the serial gate; validation and prose-preserving publication stay together. */
export async function writeWorkspaceConfiguration(path: string, patch: Record<string, unknown>, check: (config: PaConfig, secrets: SecretStore) => Promise<void>): Promise<void> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ConfigError('配置补丁必须是对象。');
  const rejected = Object.keys(patch).filter(key => !CONFIG_UPDATE_ALLOWED.has(key));
  if (rejected.length) throw new ConfigError(`不接受从表单更新的字段：${rejected.join('、')}（storage 切换走迁移流程；version 固定；密钥值走「密钥」组，进工作区密钥库）。`);
  const target = join(path, 'AGENTS.md');
  const source = await readFile(target, 'utf8');
  const current = rawAgentsMdConfig(source);
  const merged = { ...current, ...patch };
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  // TTS fields are individually editable; retain concurrently changed siblings.
  if (record(patch.tts)) merged.tts = { ...(record(current.tts) ? current.tts : {}), ...patch.tts };
  if (record(patch.workerModels)) {
    const routes: Record<string, unknown> = { ...(record(current.workerModels) ? current.workerModels : {}) };
    for (const [role, routePatch] of Object.entries(patch.workerModels)) {
      // Omitted roles/fields are unchanged. null explicitly removes a role;
      // empty strings clear one field and false disables its simple persona.
      if (routePatch === null) { delete routes[role]; continue; }
      if (!record(routePatch)) { routes[role] = routePatch; continue; }
      const route: Record<string, unknown> = { provider: '', model: '', ...(record(routes[role]) ? routes[role] : {}), ...routePatch };
      const empty = route.provider === '' && route.model === '' && (route.simplePersona === undefined || route.simplePersona === false)
        && Object.keys(route).every(key => ['provider', 'model', 'simplePersona'].includes(key));
      if (empty) delete routes[role];
      else routes[role] = route;
    }
    merged.workerModels = routes;
  }
  await check(validateConfig(merged), await readSecretStore(path));
  const tmp = `${target}.pa24-tmp`;
  try {
    await writeFile(tmp, replaceAgentsMdConfig(source, merged), 'utf8');
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
