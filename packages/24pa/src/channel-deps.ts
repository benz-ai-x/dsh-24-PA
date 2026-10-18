// Shared deep-module dependency subset (F31): proven by HandwritingDeps and
// WecomDeps (signatures were verbatim duplicates). New channel modules extend
// this instead of re-declaring the subset; the runtime wires it once via
// baseChannelDeps(). Deliberately NOT an injection container — only the
// subset two real consumers already share.

import type { PaConfig } from './config.js';
import type { Repos, WorkItemRow, ActionOperationRow } from './repo.js';

export interface SharedChannelDeps {
  repos(): Repos;
  config(): PaConfig;
  /** CLI to reach the channel's platform; bin differs per channel. */
  cli(): { bin: string; timeoutMs: number };
  notifyOwner(dedupKey: string, body: string): Promise<void>;
  stagedOperation(item: WorkItemRow, kind: string, paramsKey: string, params: Record<string, unknown>, reconcileHint?: string): Promise<{ created: boolean; row: ActionOperationRow }>;
  failStaged(operationId: string, error: unknown): Promise<void>;
}

/**
 * Second proven tier (round-3 review): the context subset HandwritingDeps and
 * DigestDeps both re-declared verbatim. Same discipline as above — only fields
 * two real consumers share get promoted; wecom-channels stays on the base tier.
 */
export interface ChannelContextDeps extends SharedChannelDeps {
  accessSessionId(): string | null;
  workspace(): { statePath: string } | null;
}
