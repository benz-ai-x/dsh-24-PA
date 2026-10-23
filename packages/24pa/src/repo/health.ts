import type { PaDb } from '../db.js';
import { hash } from '../util.js';

export type HealthState = 'verified' | 'partial' | 'unverified' | 'unchecked' | 'disabled' | 'no_activity' | 'fault' | 'stale';
export interface HealthEvidence {
  scope: string; state: HealthState; checkedAt: string; configVersion: string;
  coverage: string; message: string; impact: string; nextSteps: string[]; detail?: unknown;
}
export interface HealthTestRow {
  id: string; request_hash: string; config_version: string; status: 'prepared' | 'running' | 'succeeded' | 'failed' | 'unknown';
  plan: Record<string, any>; result: Record<string, any> | null; cleanup: Record<string, any> | null;
  created_at: Date; updated_at: Date;
}
export interface HealthIdentity { ownerId: string; authority: string }
export interface HealthIdentityRow { platform: string; accepted: HealthIdentity; observed: HealthIdentity; changed: boolean; accepted_at: Date; observed_at: Date; updated_at: Date }

/** Evidence is append-only across configuration generations. It never grants permission. */
export class HealthRepo {
  constructor(private readonly db: PaDb) {}
  async save(record: HealthEvidence): Promise<void> {
    await this.db.query(`insert into pa24.health_evidence (id,scope,config_version,state,record,checked_at) values ($1,$2,$3,$4,$5,$6)
      on conflict (id) do update set state=excluded.state,record=excluded.record,checked_at=excluded.checked_at`,
      [hash(JSON.stringify([record.scope, record.configVersion])), record.scope, record.configVersion, record.state, JSON.stringify(record), new Date(record.checkedAt)]);
  }
  async latest(): Promise<HealthEvidence[]> {
    const rows = (await this.db.query<{ scope: string; record: HealthEvidence }>('select scope,record from pa24.health_evidence order by checked_at desc,id')).rows;
    return [...new Map(rows.reverse().map(row => [row.scope, row.record])).values()];
  }
  async monitor(id: string): Promise<Record<string, any> | null> {
    return (await this.db.query<{ record: Record<string, any> }>('select record from pa24.health_monitor where id=$1', [id])).rows[0]?.record ?? null;
  }
  async saveMonitor(id: string, record: Record<string, unknown>): Promise<void> {
    await this.db.query(`insert into pa24.health_monitor (id,record) values ($1,$2) on conflict(id) do update set record=excluded.record,updated_at=now()`, [id, JSON.stringify(record)]);
  }
  async monitorDelivery(key: string): Promise<unknown> {
    return (await this.db.query('select channel,target,status,message_id,last_error,created_at,sent_at from pa24.outbox where dedup_key=$1', [key])).rows[0] ?? null;
  }
  async identity(platform: string): Promise<HealthIdentityRow | null> {
    return (await this.db.query<HealthIdentityRow>('select * from pa24.health_identity where platform=$1', [platform])).rows[0] ?? null;
  }
  async observeIdentity(platform: string, identity: HealthIdentity): Promise<HealthIdentityRow> {
    return this.db.withTransaction(async tx => {
      await tx.query('insert into pa24.health_identity (platform,accepted,observed) values ($1,$2,$2) on conflict(platform) do nothing', [platform, JSON.stringify(identity)]);
      const previous = (await tx.query<HealthIdentityRow>('select * from pa24.health_identity where platform=$1 for update', [platform])).rows[0]!;
      const changed = previous.accepted.ownerId !== identity.ownerId || previous.accepted.authority !== identity.authority;
      const observedChanged = previous.observed.ownerId !== identity.ownerId || previous.observed.authority !== identity.authority;
      return (await tx.query<HealthIdentityRow>('update pa24.health_identity set observed=$2,changed=$3,observed_at=$4,updated_at=now() where platform=$1 returning *', [platform, JSON.stringify(identity), changed, observedChanged ? new Date() : previous.observed_at])).rows[0]!;
    });
  }
  async acceptIdentity(platform: string, expected: HealthIdentity): Promise<HealthIdentityRow> {
    return this.db.withTransaction(async tx => {
      const row = (await tx.query<HealthIdentityRow>('select * from pa24.health_identity where platform=$1 for update', [platform])).rows[0];
      if (!row || JSON.stringify(row.observed) !== JSON.stringify(expected)) throw new Error('身份检查已更新，请重新核对当前真人和机器人。');
      return (await tx.query<HealthIdentityRow>('update pa24.health_identity set accepted=observed,changed=false,accepted_at=now() where platform=$1 returning *', [platform])).rows[0]!;
    });
  }
  async test(id: string): Promise<HealthTestRow | null> {
    return (await this.db.query<HealthTestRow>('select * from pa24.health_test where id=$1', [id])).rows[0] ?? null;
  }
  async tests(): Promise<HealthTestRow[]> {
    return (await this.db.query<HealthTestRow>('select * from pa24.health_test order by created_at desc limit 100')).rows;
  }
  async prepareTest(id: string, requestHash: string, configVersion: string, plan: Record<string, unknown>): Promise<{ created: boolean; row: HealthTestRow }> {
    return this.db.withTransaction(async tx => {
      const inserted = await tx.query<HealthTestRow>(`insert into pa24.health_test (id,request_hash,config_version,status,plan) values ($1,$2,$3,'prepared',$4) on conflict(id) do nothing returning *`, [id, requestHash, configVersion, JSON.stringify(plan)]);
      const row = inserted.rows[0] ?? (await tx.query<HealthTestRow>('select * from pa24.health_test where id=$1', [id])).rows[0]!;
      if (row.request_hash !== requestHash) throw new Error('测试请求标识已用于不同目标或动作。');
      return { created: !!inserted.rows[0], row };
    });
  }
  async updateTest(id: string, status: HealthTestRow['status'], result: Record<string, unknown>): Promise<HealthTestRow> {
    return (await this.db.query<HealthTestRow>('update pa24.health_test set status=$2,result=$3,updated_at=now() where id=$1 returning *', [id, status, JSON.stringify(result)])).rows[0]!;
  }
  async cleanupTest(id: string, cleanup: Record<string, unknown>): Promise<HealthTestRow> {
    return (await this.db.query<HealthTestRow>('update pa24.health_test set cleanup=$2,updated_at=now() where id=$1 returning *', [id, JSON.stringify(cleanup)])).rows[0]!;
  }
  async traffic(): Promise<{ channels: unknown[]; inbox: unknown[]; since: string | null }> {
    const channels = (await this.db.query(`select channel,status,count(*) as count,min(created_at) as since,max(sent_at) as last_sent_at from pa24.outbox group by channel,status order by channel,status`)).rows;
    const inbox = (await this.db.query(`select source,kind,status,count(*) as count,min(created_at) as since,max(created_at) as last_received_at from pa24.inbox group by source,kind,status order by source,kind,status`)).rows;
    return { channels, inbox, since: null };
  }
  async impacts(): Promise<Record<string, number>> {
    const result = (await this.db.query<{ kind: string; count: string }>(`select 'work' as kind,count(*) as count from pa24.work_item where status in ('queued','running','waiting_input','needs_reconciliation')
      union all select 'outbox',count(*) from pa24.outbox where status in ('pending','sending','unknown')
      union all select 'reviews',count(*) from pa24.note_version where status='pending_review'`)).rows;
    return Object.fromEntries(result.map(row => [row.kind, Number(row.count)]));
  }
}
