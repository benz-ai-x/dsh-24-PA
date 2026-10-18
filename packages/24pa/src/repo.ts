// Barrel (round-3 review): repo.ts re-exports the split repo/ modules so
// every existing `./repo.js` import keeps working; the Repos facade lives in
// repo/index.ts.
export * from './repo/index.js';
