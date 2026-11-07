// Historical compatibility fixture, not a user creation entry. It seeds the old
// format through the real lifecycle and real native Schedule in an isolated host.
// New conversational creation is exercised separately by f50-plan-consistency.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { PlanLifecycle } from '../../lib/plan-lifecycle.js';
import { bridgeScheduleService } from '../../lib/schedule-bridge.js';

export async function seedLegacyPlan(host, dsn, input = {}) {
  const { workspace } = await host.api('snapshot');
  const db = workspace.config.storage === 'sqlite' ? new SqliteDb(join(workspace.path, 'data', 'pa24.db')) : new PaDatabase(dsn);
  try {
    const repos = createRepos(db), kind = input.kind ?? 'morning', zone = input.timeZone ?? workspace.config.timeZone;
    const native = bridgeScheduleService({
      create: request => host.remote('schedule/create', { request }),
      edit: request => host.remote('schedule/edit', { request }),
      catalog: () => host.remote('schedule/catalog', {}),
      history: request => host.remote('schedule/history', { request }),
    });
    const lifecycle = new PlanLifecycle({ repo: () => repos.digests, native: () => native });
    const spec = kind === 'once' ? { at: input.at ?? new Date(Date.now() + (input.afterSeconds ?? 600) * 1000).toISOString(), time_zone: zone }
      : kind === 'weekly' ? { weekly: { time: input.time ?? '09:00:00', time_zone: zone, weekdays: input.weekdays ?? [5] } }
      : { daily: { time: input.time ?? '09:00:00', time_zone: zone } };
    return await lifecycle.enable({ id: `dig-fixture-${randomUUID()}`, title: input.title ?? (kind === 'once' ? '一次性简报' : '旧计划兼容验收'),
      kind, skill: input.skill ?? `digest-${kind === 'once' ? 'morning' : kind}`, voice: input.voice === true, session_id: workspace.accessSessionId, schedule_spec: spec, last_window: null });
  } finally { await db.close(); }
}
