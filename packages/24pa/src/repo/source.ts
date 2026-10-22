import type { PaDb } from '../db.js';
import { sourceConfigurationFingerprint, sourceScopeFingerprint, type SourceConfiguration, type SourceRegistration } from '../source-config.js';
import type { SourceEvidence } from '../source-registry.js';
import { sourceIdentityKey } from '../source-registry.js';

export interface SourceRegistrationRow {
  id: string;
  revision: number;
  scope_hash: string;
  registration: SourceRegistration;
  identity_key: string | null;
  removed: boolean;
  created_at: Date;
  updated_at: Date;
}
export interface SourceEvidenceRow {
  source_id: string;
  registration_revision: number;
  scope_hash: string;
  connection_hash: string;
  evidence: SourceEvidence;
  checked_at: Date;
}

/** History and observed capability evidence, never a second editable config source. */
export class SourceRepo {
  constructor(private readonly db: PaDb) {}

  async synchronize(config: SourceConfiguration): Promise<void> {
    const fingerprint = sourceConfigurationFingerprint(config);
    await this.db.withTransaction(async tx => {
      await tx.query("insert into pa24.source_registry_state (id, config_hash) values ('current', '') on conflict (id) do nothing");
      const state = (await tx.query<{ config_hash: string }>("select config_hash from pa24.source_registry_state where id = 'current' for update")).rows[0]!;
      if (state.config_hash === fingerprint) return;
      for (const source of config.entries) {
        const previous = (await tx.query<SourceRegistrationRow>('select * from pa24.source_registration where id = $1 for update', [source.id])).rows[0];
        const identityKey = previous && !previous.removed && previous.registration.platform === source.platform && previous.registration.ownerId === source.ownerId ? previous.identity_key : null;
        await tx.query(
          `insert into pa24.source_registration (id, scope_hash, registration, identity_key) values ($1,$2,$3,$4)
           on conflict (id) do update set
             revision = pa24.source_registration.revision + case when pa24.source_registration.scope_hash <> excluded.scope_hash or pa24.source_registration.removed = true then 1 else 0 end,
             identity_key = excluded.identity_key,
             scope_hash = excluded.scope_hash, registration = excluded.registration, removed = false, updated_at = now()`,
          [source.id, sourceScopeFingerprint(source), JSON.stringify(source), identityKey],
        );
      }
      await tx.query('update pa24.source_registration set removed = true, revision = revision + 1, updated_at = now() where removed = false and id <> all($1::text[])', [config.entries.map(source => source.id)]);
      await tx.query("update pa24.source_registry_state set config_hash = $1, revision = revision + 1, updated_at = now() where id = 'current'", [fingerprint]);
    });
  }
  async list(): Promise<SourceRegistrationRow[]> {
    return (await this.db.query<SourceRegistrationRow>('select * from pa24.source_registration order by created_at, id')).rows;
  }
  async get(id: string): Promise<SourceRegistrationRow | null> {
    return (await this.db.query<SourceRegistrationRow>('select * from pa24.source_registration where id = $1', [id])).rows[0] ?? null;
  }
  async evidence(id: string): Promise<SourceEvidenceRow | null> {
    return (await this.db.query<SourceEvidenceRow>('select * from pa24.source_evidence where source_id = $1', [id])).rows[0] ?? null;
  }

  /** A check made before a resource change/removal cannot validate the new registration. */
  async saveEvidence(source: SourceRegistrationRow, connectionHash: string, evidence: SourceEvidence): Promise<SourceEvidenceRow> {
    return this.db.withTransaction(async tx => {
      const current = (await tx.query<SourceRegistrationRow>('select * from pa24.source_registration where id = $1 for update', [source.id])).rows[0];
      if (!current || current.removed || current.revision !== source.revision || current.scope_hash !== source.scope_hash) throw new Error('检查期间来源已变更，请刷新并重新检查。');
      if (evidence.state === 'verified' && evidence.identity) {
        const identity = sourceIdentityKey(evidence.identity);
        if (current.identity_key && current.identity_key !== identity) throw new Error('实际接入身份已改变，需重新登记并核验来源。');
        await tx.query('update pa24.source_registration set identity_key = $2 where id = $1', [source.id, identity]);
      }
      return (await tx.query<SourceEvidenceRow>(
        `insert into pa24.source_evidence (source_id, registration_revision, scope_hash, connection_hash, evidence, checked_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (source_id) do update set registration_revision = excluded.registration_revision,
           scope_hash = excluded.scope_hash, connection_hash = excluded.connection_hash, evidence = excluded.evidence, checked_at = excluded.checked_at
         returning *`,
        [source.id, source.revision, source.scope_hash, connectionHash, JSON.stringify(evidence), new Date(evidence.checkedAt)],
      )).rows[0]!;
    });
  }
}
