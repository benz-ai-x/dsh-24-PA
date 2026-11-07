import { isDeepStrictEqual } from 'node:util';
import type { PaConfig } from './config.js';
import { effectiveSources } from './source-config.js';

/** The three existing configuration boundaries that need an explanation before saving. */
export function configurationImpactKinds(config: PaConfig, patch: Record<string, unknown>, secretKeys: string[]) {
  const changed = (keys: (keyof PaConfig)[]) => keys.some(key => Object.hasOwn(patch, key) && !isDeepStrictEqual(patch[key], config[key]));
  const identity = changed(['mode', 'ownerOpenId', 'larkProfile', 'appIdEnv', 'appSecretEnv'])
    || secretKeys.some(key => key === 'feishuAppId' || key === 'feishuAppSecret');
  const postgres = changed(['pgDsnEnv']) || secretKeys.includes('pgDsn');
  // A label-only edit does not change identity, access, query scope or routing.
  const withoutNames = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    return { ...source, entries: Array.isArray(source.entries) ? source.entries.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const { name: _name, ...rest } = entry;
      return rest;
    }) : source.entries };
  };
  const targets = changed(['calendarChannel', 'todoChannel', 'notifyChannel', 'calendarId', 'tasklistId', 'folderToken', 'wikiNodeToken'])
    || Object.hasOwn(patch, 'sources') && !isDeepStrictEqual(withoutNames(patch.sources), withoutNames(effectiveSources(config)));
  return { identity, targets, postgres };
}
