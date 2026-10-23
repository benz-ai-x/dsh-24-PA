import { createHash } from 'node:crypto';
import { effectiveSources, selectSource, sourceScopeFingerprint, SourceError, type LegacySourceConfiguration, type SourceDomain, type SourcePlatform, type SourceRegistration, type SourceSelector } from './source-config.js';
import type { SourceRepo, SourceEvidenceRow, SourceRegistrationRow } from './repo/source.js';

export type SourceCapability = 'read' | 'create' | 'update' | 'cancel' | 'leave' | 'reminders' | 'series';
export type CapabilityVerdict = 'allowed' | 'attemptable' | 'denied' | 'unknown' | 'adapter_unavailable';
export interface SourceIdentity {
  platform: SourcePlatform;
  ownerId: string;
  /** Real application/tenant or bot identity returned by the same adapter. */
  authority: string;
}
export interface SourceEvidence {
  checkedAt: string;
  state: 'verified' | 'pending' | 'failed';
  identity: SourceIdentity | null;
  /** Exact resolved container or authorized scope, never the alias "primary". */
  resource: { kind: SourceRegistration['resourceKind']; id: string } | null;
  capabilities: Record<SourceCapability, CapabilityVerdict>;
  message: string;
  role?: string;
}
export interface SourceTarget {
  sourceId: string;
  domain: SourceDomain;
  platform: SourcePlatform;
  identity: SourceIdentity;
  identityKey: string;
  resource: NonNullable<SourceEvidence['resource']>;
  registrationRevision: number;
  scopeHash: string;
  connectionHash: string;
  selectedBy: 'explicit' | 'mapping' | 'default';
  /** Frozen evidence: attemptable permits a requested create, not a verified write permission. */
  permission?: { capability: SourceCapability; verdict: CapabilityVerdict };
  checkedAt: string;
}
export interface SourceRegistryDeps {
  repo(): SourceRepo;
  config(): LegacySourceConfiguration;
  /** A non-secret digest of the active adapter identity/config generation. */
  connectionHash(platform: SourcePlatform): string;
  probe(source: SourceRegistration): Promise<SourceEvidence>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
}
export function unknownCapabilities(): SourceEvidence['capabilities'] {
  return { read: 'unknown', create: 'unknown', update: 'unknown', cancel: 'unknown', leave: 'unknown', reminders: 'unknown', series: 'unknown' };
}
export function sourceIdentityKey(identity: SourceIdentity): string {
  return createHash('sha256').update(JSON.stringify([identity.platform, identity.authority, identity.ownerId])).digest('hex');
}

export class SourceRegistry {
  constructor(private readonly deps: SourceRegistryDeps) {}
  async synchronize(): Promise<void> { await this.deps.repo().synchronize(effectiveSources(this.deps.config())); }

  /** Browsing only reads stored evidence; no implicit CLI or model invocation. */
  async list() {
    const config = effectiveSources(this.deps.config()), repo = this.deps.repo();
    const rows = await repo.list();
    const entries = await Promise.all(config.entries.map(async source => {
      const registration = rows.find(row => row.id === source.id && !row.removed), stored = await repo.evidence(source.id);
      const valid = registration && this.validEvidence(source, registration, stored);
      return { ...source, revision: registration?.revision ?? null, evidence: valid ? stored!.evidence : null,
        previousCheckAt: stored?.checked_at ?? null, status: !source.enabled ? 'disabled' : valid ? stored!.evidence.state : 'pending' };
    }));
    return { config, legacy: this.deps.config().sources == null, entries, removed: rows.filter(row => row.removed) };
  }
  private validEvidence(source: SourceRegistration, row: SourceRegistrationRow, proof: SourceEvidenceRow | null): boolean {
    return !!proof && !row.removed && proof.registration_revision === row.revision && proof.scope_hash === sourceScopeFingerprint(source)
      && proof.connection_hash === this.deps.connectionHash(source.platform);
  }

  async check(id: string): Promise<SourceEvidence> {
    return this.deps.gate(`source-check:${id}`, async () => {
      await this.synchronize();
      const source = effectiveSources(this.deps.config()).entries.find(row => row.id === id);
      if (!source || !source.enabled) throw new SourceError('来源未登记或已停用。');
      const repo = this.deps.repo(), row = (await repo.get(id))!, connection = this.deps.connectionHash(source.platform);
      let evidence: SourceEvidence;
      try {
        evidence = await this.deps.probe(source);
        if (!Number.isFinite(Date.parse(evidence.checkedAt))) throw new SourceError('来源检查缺少有效核验时间。');
        if (evidence.state === 'verified' && (!evidence.identity?.ownerId || !evidence.identity.authority || evidence.identity.platform !== source.platform
          || (source.ownerId && evidence.identity.ownerId !== source.ownerId) || !evidence.resource?.id || evidence.resource.id === 'primary'
          || evidence.resource.kind !== source.resourceKind || (source.resourceId !== 'primary' && evidence.resource.id !== source.resourceId))) throw new SourceError('实际身份或资源与登记来源不一致，不能沿用该检查结果。');
        if (evidence.state === 'verified' && row.identity_key && evidence.identity && row.identity_key !== sourceIdentityKey(evidence.identity)) throw new SourceError('来源的实际应用、机器人或真人身份已改变，请重新登记并核验，不会沿用旧来源执行。');
      } catch (error) {
        evidence = { state: 'failed', checkedAt: new Date().toISOString(), identity: null, resource: null, capabilities: unknownCapabilities(), message: (error as Error).message };
      }
      const current = effectiveSources(this.deps.config()).entries.find(item => item.id === id);
      if (connection !== this.deps.connectionHash(source.platform) || !current || sourceScopeFingerprint(current) !== row.scope_hash) throw new SourceError('检查期间来源或接入身份已变更，请重试。');
      await repo.saveEvidence(row, connection, evidence);
      return evidence;
    });
  }

  /** Resolve once at authorization time; the snapshot survives future default changes. */
  async bind(domain: SourceDomain, selector: SourceSelector = {}, capability: SourceCapability = 'create'): Promise<SourceTarget> {
    const { source, reason } = selectSource(effectiveSources(this.deps.config()), domain, selector, capability !== 'read');
    const connection = this.deps.connectionHash(source.platform);
    const proof = await this.check(source.id);
    this.assertCapability(proof, capability, source.name);
    const row = (await this.deps.repo().get(source.id))!;
    const current = effectiveSources(this.deps.config()).entries.find(item => item.id === source.id);
    if (!current || row.removed || row.scope_hash !== sourceScopeFingerprint(source) || sourceScopeFingerprint(current) !== row.scope_hash || connection !== this.deps.connectionHash(source.platform)) throw new SourceError('目标解析期间来源已变更，请重新确认。');
    return { sourceId: source.id, domain, platform: source.platform, identity: proof.identity!, identityKey: sourceIdentityKey(proof.identity!), resource: proof.resource!,
      registrationRevision: row.revision, scopeHash: row.scope_hash, connectionHash: connection, selectedBy: reason, permission: { capability, verdict: proof.capabilities[capability] }, checkedAt: proof.checkedAt };
  }

  /** Current registration and actual permissions may only narrow an existing authorization. */
  async verify(target: SourceTarget, capability: SourceCapability): Promise<SourceEvidence> {
    const source = effectiveSources(this.deps.config()).entries.find(row => row.id === target.sourceId);
    if (!source || !source.enabled || sourceScopeFingerprint(source) !== target.scopeHash) throw new SourceError('原目标的来源、接入身份或授权范围已变更；需明确修复或重配，不能改投新默认。');
    if (capability !== 'read' && source.access !== 'readwrite') throw new SourceError('原来源已改为只读。');
    const connection = this.deps.connectionHash(target.platform);
    const proof = await this.check(source.id), registration = await this.deps.repo().get(source.id);
    if (!registration || registration.revision !== target.registrationRevision || connection !== this.deps.connectionHash(target.platform)) throw new SourceError('原来源已移除、重新登记或正在切换接入，请核对原目标后重配。');
    this.assertCapability(proof, capability, source.name);
    if (sourceIdentityKey(proof.identity!) !== target.identityKey || proof.resource!.id !== target.resource.id || proof.resource!.kind !== target.resource.kind) throw new SourceError('原目标的实际身份或资源已改变，请核对，不能按新身份执行。');
    return proof;
  }
  private assertCapability(proof: SourceEvidence, capability: SourceCapability, name: string): void {
    const permitted = proof.capabilities[capability] === 'allowed' || (capability === 'create' && proof.capabilities.create === 'attemptable');
    if (proof.state !== 'verified' || !proof.identity || !proof.resource || !permitted) throw new SourceError(`来源「${name}」的 ${capability} 能力未核验通过：${proof.message}`);
  }
}
