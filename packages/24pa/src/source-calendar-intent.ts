import type { PaConfig } from './config.js';
import { effectiveSources, selectSource, sourceScopeFingerprint } from './source-config.js';
import type { SourceTarget } from './source-registry.js';
import { isDeepStrictEqual } from 'node:util';

/** Compare selectors with the original authorization, including the declared
 * primary alias. A changed default or mapping must not redirect a retry. */
export function sameCalendarTarget(args: Record<string, unknown>, target: SourceTarget, saved: { request?: Record<string, unknown>; registeredResourceId?: string }, config: PaConfig): boolean {
  const old = saved.request ?? {}, sources = effectiveSources(config);
  const registration = sources.entries.find(row => row.id === target.sourceId);
  const declaredId = saved.registeredResourceId ?? (registration && sourceScopeFingerprint(registration) === target.scopeHash ? registration.resourceId : undefined);
  if (args.channel !== undefined && args.channel !== target.platform) return false;
  if (args.calendarId !== undefined && args.calendarId !== target.resource.id && args.calendarId !== declaredId && args.calendarId !== old.calendarId) return false;
  if (args._sourceTarget && !isDeepStrictEqual(args._sourceTarget, target)) return false;
  if (args.sourceId !== undefined) {
    if (args.sourceId === target.sourceId) return true;
    try { return selectSource(sources, 'calendar', { sourceId: String(args.sourceId) }, false).source.id === target.sourceId; }
    catch { return false; }
  }
  if (args.company !== undefined || args.project !== undefined) {
    if (args.company === old.company && args.project === old.project && old.sourceId === undefined) return true;
    try { return selectSource(sources, 'calendar', { company: args.company as string | undefined, project: args.project as string | undefined }, false).source.id === target.sourceId; }
    catch { return false; }
  }
  return old.sourceId === undefined && old.company === undefined && old.project === undefined || sources.defaults.calendar === target.sourceId;
}
