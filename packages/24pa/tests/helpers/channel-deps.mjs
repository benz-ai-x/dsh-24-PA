// F31: shared stub for the SharedChannelDeps subset — one fake instead of one
// per channel module's unit tests. Domain-specific deps stay per-file.

export const makeBaseDeps = (over = {}) => ({
  repos: () => { throw new Error('not needed'); },
  config: () => { throw new Error('not needed'); },
  cli: () => ({ bin: 'missing-cli-bin', timeoutMs: 2000 }),
  notifyOwner: async () => {},
  stagedOperation: async () => { throw new Error('not needed'); },
  failStaged: async () => {},
  ...over,
});
