// F36/P68: 工作区密钥库——密钥值经面板表单写入 `<workspace>/.24pa/secrets.json`
// （0600、原子写），不进 AGENTS.md/系统提示/备份；环境变量（引用名仍可配）
// 优先于密钥库（部署层 override），存量 env-only 部署零影响。
import { readFile, writeFile, rm, chmod, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { PaConfig } from './config.js';

export const SECRET_KEYS = ['feishuAppId', 'feishuAppSecret', 'pgDsn', 'volcTtsKey'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];
export type SecretStore = Partial<Record<SecretKey, string>>;

/** Resolve against an explicit workspace snapshot, never ambient runtime state. */
export function secretRefs(config: PaConfig | null): Record<SecretKey, string> {
  return {
    feishuAppId: config?.appIdEnv || 'PA24_FEISHU_APP_ID',
    feishuAppSecret: config?.appSecretEnv || 'PA24_FEISHU_APP_SECRET',
    pgDsn: config?.pgDsnEnv || 'PA24_PG_DSN',
    volcTtsKey: config?.tts?.volcKeyEnv || 'PA24_VOLC_TTS_KEY',
  };
}

export function secretEnvironment(config: PaConfig | null, env: Record<string, string | undefined>, store: SecretStore): Record<string, string | undefined> {
  const resolved = { ...env };
  const refs = secretRefs(config);
  for (const key of SECRET_KEYS) {
    const value = resolveSecret(refs[key], env, store, key);
    if (value) resolved[refs[key]] = value;
  }
  return resolved;
}
/** 面板/快照可见的状态（永不包含值）。 */
export type SecretStatus = Partial<Record<SecretKey, { set: true; source: 'env' | 'store' } | { set: false; source: null }>>;

export function secretsPath(statePath: string): string {
  return join(statePath, '.24pa', 'secrets.json');
}

/** 读取密钥库；文件缺失或损坏按空库处理（密钥库不是业务权威，坏库不该炸面板）。 */
export async function readSecretStore(statePath: string): Promise<SecretStore> {
  try {
    const parsed = JSON.parse(await readFile(secretsPath(statePath), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: SecretStore = {};
    for (const key of SECRET_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string' && value) store[key] = value;
    }
    return store;
  } catch {
    return {};
  }
}

/** 原子写整库（tmp+rename）并收紧 0600；空库也落文件，便于 ls 一眼确认存在。 */
export async function writeSecretStore(statePath: string, store: SecretStore): Promise<void> {
  const path = secretsPath(statePath);
  const tmp = `${path}.pa24-tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tmp, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600); // 显式补一遍：权限失败应让写入响亮失败，不静默 0644
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * 解析顺序：环境变量（refName 命中且非空）优先，密钥库兜底。
 * 纯函数便于单测；refName 为空串时只看密钥库。
 */
export function resolveSecret(refName: string | undefined, env: Record<string, string | undefined>, store: SecretStore, key: SecretKey): string {
  const fromEnv = refName ? (env[refName] ?? '').trim() : '';
  if (fromEnv) return fromEnv;
  return (store[key] ?? '').trim();
}

/** 逐能力位状态（env/store/未设置），快照与面板展示用，不含值。 */
export function secretStatus(refs: Record<SecretKey, string | undefined>, env: Record<string, string | undefined>, store: SecretStore): SecretStatus {
  const status: SecretStatus = {};
  for (const key of SECRET_KEYS) {
    const value = resolveSecret(refs[key], env, store, key);
    status[key] = value
      ? { set: true, source: refs[key] && (env[refs[key]!] ?? '').trim() ? 'env' : 'store' }
      : { set: false, source: null };
  }
  return status;
}
