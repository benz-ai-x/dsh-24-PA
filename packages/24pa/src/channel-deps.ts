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
