import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PaDb } from '../db.js';
import type { SourceDomain, SourcePlatform } from '../source-config.js';
import type { SourceTarget } from '../source-registry.js';
import type { SourceRegistrationRow } from './source.js';
import type { ActionOperationRow } from './work.js';

export interface SourceRoles { complete: boolean; values: string[]; reason?: string }
export interface ObservedSourceItem {
  /** Calendar IDs must be qualified with their native calendar/instance location. */
  nativeId: string;
  locator: Record<string, unknown>;
  body: Record<string, unknown>;
  roles: SourceRoles;
  capabilities: Record<string, unknown>;
  active: boolean;
  startTime?: Date | null;
  endTime?: Date | null;
}
export interface SourceObservationQuery {
  /** All remote members in the window, before display-role filtering. */
  from: string | null;
  to: string | null;
}
export interface SourceObservation {
  state: 'complete' | 'partial' | 'failed';
  query: SourceObservationQuery;
  reason?: string;
  observedAt: Date;
  items: ObservedSourceItem[];
}
export interface SourceMembershipRow {
  source_id: string;
  locator_id: string;
  object_id: string;
  registration_revision: number;
  scope_hash: string;
  locator: Record<string, unknown>;
  roles: SourceRoles;
  capabilities: Record<string, unknown>;
  active: boolean;
  start_time: Date | null;
  end_time: Date | null;
  observed_at: Date;
  body: Record<string, unknown>;
  domain: SourceDomain;
  platform: SourcePlatform;
  identity_key: string;
  native_id: string;
}
export interface SourceObservationRow {
  source_id: string;
  query_key: string;
  registration_revision: number;
  scope_hash: string;
  state: SourceObservation['state'];
  query: SourceObservationQuery;
  reason: string | null;
  observed_at: Date;
  last_complete_at: Date | null;
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function hydrateJoinedBody(row: SourceMembershipRow): SourceMembershipRow {
  // Keep every location's body and times from the same observation. A later
  // copy in another calendar must not rewrite this location's saved snapshot.
  return { ...row, body: typeof row.body === 'string' ? JSON.parse(row.body) : row.body };
}
export function sourceObjectId(target: Pick<SourceTarget, 'domain' | 'platform' | 'identityKey'>, nativeId: string): string {
  return `object:${digest([target.domain, target.platform, target.identityKey, nativeId])}`;
}

/** A source disappearing never deletes the remote object or another source's membership. */
export class SourceProjectionRepo {
  constructor(private readonly db: PaDb) {}

  /** Repair a known remote acceptance under its original identity, including
   * after removal. It cannot make that removed source queryable again. */
  async recordReceipt(operationId: string, target: SourceTarget, item: ObservedSourceItem): Promise<void> {
    await this.db.withTransaction(async tx => {
      const operation = (await tx.query<ActionOperationRow>('select * from pa24.action_operation where id = $1 for update', [operationId])).rows[0];
      const original = operation?.params.sourceTarget as SourceTarget | undefined;
      if (!operation?.receipt || (!Object.hasOwn(operation.receipt, '_externalResult') && operation.status !== 'succeeded')
        || !original || !isDeepStrictEqual(original, target)) throw new Error('缺少原目标的持久平台回执，不能补写对象关联。');
      const external = operation.receipt._externalResult as { data?: any } | undefined;
      const eventId = operation.receipt.eventId ?? (operation.params.kind === 'create'
        ? external?.data?.event?.event_id ?? external?.data?.event_id ?? external?.data?.schedule_id : operation.params.eventId);
      if (!eventId || item.locator.eventId !== eventId) throw new Error('补写对象与持久平台回执的标识不符。');
      const source = (await tx.query<SourceRegistrationRow>('select * from pa24.source_registration where id = $1', [target.sourceId])).rows[0];
      const current = source && !source.removed && source.revision === target.registrationRevision && source.scope_hash === target.scopeHash && source.identity_key === target.identityKey;
      await this.upsert(tx, target, { ...item, active: item.active && !!current }, operation.created_at);
    });
  }

  private async upsert(tx: Pick<PaDb, 'query'>, target: SourceTarget, item: ObservedSourceItem, observedAt: Date): Promise<void> {
    const id = sourceObjectId(target, item.nativeId);
    await tx.query(
      `insert into pa24.source_object (id, domain, platform, identity_key, native_id, body, observed_at) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set body = excluded.body, observed_at = excluded.observed_at, updated_at = now()
       where pa24.source_object.observed_at <= excluded.observed_at`,
      [id, target.domain, target.platform, target.identityKey, item.nativeId, JSON.stringify(item.body), observedAt],
    );
    await tx.query(
      `insert into pa24.source_membership (source_id, locator_id, object_id, registration_revision, scope_hash, locator, roles, capabilities, active, start_time, end_time, observed_at, body)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (source_id, locator_id) do update set object_id = excluded.object_id, registration_revision = excluded.registration_revision,
         scope_hash = excluded.scope_hash, locator = excluded.locator, roles = excluded.roles, capabilities = excluded.capabilities,
         active = excluded.active, start_time = excluded.start_time, end_time = excluded.end_time, observed_at = excluded.observed_at, body = excluded.body
       where pa24.source_membership.observed_at <= excluded.observed_at`,
      [target.sourceId, id, id, target.registrationRevision, target.scopeHash, JSON.stringify(item.locator), JSON.stringify(item.roles), JSON.stringify(item.capabilities), item.active, item.startTime ?? null, item.endTime ?? null, observedAt, JSON.stringify(item.body)],
    );
  }

  async observe(target: SourceTarget, observation: SourceObservation): Promise<void> {
    const { query, items, observedAt } = observation;
    const from = query.from === null ? null : new Date(query.from), to = query.to === null ? null : new Date(query.to);
    if (!Number.isFinite(observedAt.getTime()) || (!!from !== !!to) || (from && to && !(from < to))) throw new Error('来源观察时间范围无效。');
    if (target.domain === 'calendar' && !from) throw new Error('日历观察必须有明确时间窗口。');
    const ids = items.map(item => sourceObjectId(target, item.nativeId));
    if (new Set(ids).size !== ids.length || items.some(item => !item.nativeId || (target.domain === 'calendar' && (!item.startTime || !item.endTime || !(item.startTime < item.endTime))))) throw new Error('来源观察包含重复、缺少标识或无效时间的对象。');
    if (observation.state === 'failed' && items.length) throw new Error('失败观察不能携带已确认对象；部分结果应标为 partial。');
    // complete proves the native object range, before role filtering. Missing
    // role evidence remains per item and makes role-filtered queries partial.
    await this.db.withTransaction(async tx => {
      const source = (await tx.query<SourceRegistrationRow>('select * from pa24.source_registration where id = $1 for update', [target.sourceId])).rows[0];
      if (!source || source.removed || source.revision !== target.registrationRevision || source.scope_hash !== target.scopeHash || source.identity_key !== target.identityKey) throw new Error('观察期间来源或身份已改变，未覆盖当前缓存。');
      const key = digest(query);
      const previous = (await tx.query<SourceObservationRow>('select * from pa24.source_observation where source_id = $1 and query_key = $2', [target.sourceId, key])).rows[0];
      if (previous && previous.observed_at > observedAt) throw new Error('较早的来源观察已失效，保留较新的结果。');
      for (let index = 0; index < items.length; index++) {
        await this.upsert(tx, target, items[index]!, observedAt);
      }
      if (observation.state === 'complete') {
        const window = from ? 'and start_time < $6 and end_time > $5' : '';
        await tx.query(
          `update pa24.source_membership set active = false, observed_at = $4 where source_id = $1 and registration_revision = $2
           and locator_id <> all($3::text[]) and observed_at <= $4 ${window}`,
          from ? [target.sourceId, target.registrationRevision, ids, observedAt, from, to] : [target.sourceId, target.registrationRevision, ids, observedAt],
        );
      }
      const retainedTime = previous?.registration_revision === target.registrationRevision && previous.scope_hash === target.scopeHash ? previous.last_complete_at : null;
      await tx.query(
        `insert into pa24.source_observation (source_id, query_key, registration_revision, scope_hash, state, query, reason, observed_at, last_complete_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (source_id, query_key) do update set registration_revision = excluded.registration_revision, scope_hash = excluded.scope_hash,
           state = excluded.state, query = excluded.query, reason = excluded.reason, observed_at = excluded.observed_at, last_complete_at = excluded.last_complete_at`,
        [target.sourceId, key, target.registrationRevision, target.scopeHash, observation.state, JSON.stringify(query), observation.reason ?? null, observedAt, observation.state === 'complete' ? observedAt : retainedTime],
      );
    });
  }

  async cached(target: Pick<SourceTarget, 'sourceId' | 'registrationRevision' | 'scopeHash'>, query: SourceObservationQuery): Promise<{ items: SourceMembershipRow[]; observation: SourceObservationRow | null }> {
    const window = query.from ? 'and m.start_time < $5 and m.end_time > $4' : '';
    const items = (await this.db.query<SourceMembershipRow>(
      `select m.*, o.domain, o.platform, o.identity_key, o.native_id from pa24.source_membership m
       join pa24.source_object o on o.id = m.object_id where m.source_id = $1 and m.registration_revision = $2 and m.scope_hash = $3 and m.active = true ${window}
       order by m.start_time, m.object_id`,
      query.from ? [target.sourceId, target.registrationRevision, target.scopeHash, new Date(query.from), new Date(query.to!)] : [target.sourceId, target.registrationRevision, target.scopeHash],
    )).rows;
    const observation = (await this.db.query<SourceObservationRow>(
      'select * from pa24.source_observation where source_id = $1 and query_key = $2 and registration_revision = $3 and scope_hash = $4',
      [target.sourceId, digest(query), target.registrationRevision, target.scopeHash],
    )).rows[0] ?? null;
    return { items: items.map(hydrateJoinedBody), observation };
  }

  async locations(objectId: string): Promise<SourceMembershipRow[]> {
    return (await this.db.query<SourceMembershipRow>(
      `select m.*, o.domain, o.platform, o.identity_key, o.native_id from pa24.source_membership m
       join pa24.source_object o on o.id = m.object_id where m.object_id = $1 order by m.source_id`, [objectId],
    )).rows.map(hydrateJoinedBody);
  }

  async calendarLocations(eventId: string): Promise<SourceMembershipRow[]> {
    return (await this.db.query<SourceMembershipRow>(
      `select m.*, o.domain, o.platform, o.identity_key, o.native_id from pa24.source_membership m
       join pa24.source_object o on o.id = m.object_id where o.domain = 'calendar' and m.locator->>'eventId' = $1 order by m.source_id`, [eventId],
    )).rows.map(hydrateJoinedBody);
  }
}
