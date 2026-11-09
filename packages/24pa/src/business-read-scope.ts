import { AsyncLocalStorage } from 'node:async_hooks';
import type { SourceTarget } from './source-registry.js';

/** Evidence of the sources whose data reached a business result. Missing or
 * incomplete evidence cannot be reconstructed from today's default sources. */
export interface BusinessReadScope { version: 1; complete: boolean; targets: SourceTarget[] }
const active = new AsyncLocalStorage<BusinessReadScope>();
export const emptyBusinessReadScope = (): BusinessReadScope => ({ version: 1, complete: true, targets: [] });

const targetKey = (target: SourceTarget) => JSON.stringify([target.sourceId, target.domain, target.platform,
  target.identityKey, target.resource.kind, target.resource.id, target.registrationRevision, target.scopeHash, target.connectionHash]);
export function mergeBusinessReadScopes(...scopes: Array<BusinessReadScope | null | undefined>): BusinessReadScope {
  const result = emptyBusinessReadScope(), targets = new Map<string, SourceTarget>();
  for (const scope of scopes) {
    if (scope?.version !== 1 || scope.complete !== true || !Array.isArray(scope.targets)) result.complete = false;
    for (const target of scope?.targets ?? []) targets.set(targetKey(target), structuredClone(target));
  }
  result.targets = [...targets.values()];
  return result;
}
export function recordBusinessSource(target: SourceTarget): void {
  const scope = active.getStore(); if (!scope) return;
  if (!scope.targets.some(row => targetKey(row) === targetKey(target))) scope.targets.push(structuredClone(target));
}
export function unverifiedBusinessRead(): void { const scope = active.getStore(); if (scope) scope.complete = false; }

/** Save before a tool result or template result can leave the operation. */
export async function captureBusinessReads<T>(work: () => Promise<T>, save: (scope: BusinessReadScope) => Promise<void>): Promise<T> {
  const scope = emptyBusinessReadScope();
  return active.run(scope, async () => {
    try { return await work(); }
    finally { await save(scope); }
  });
}
