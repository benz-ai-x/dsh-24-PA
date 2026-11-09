// Test-only process clock. All product paths keep the real implementation;
// the parent process controls time without editing the business database.
import { readFileSync } from 'node:fs';
if (process.env.PA24_TEST_CLOCK_FILE) {
  const NativeDate = Date;
  const offset = () => JSON.parse(readFileSync(process.env.PA24_TEST_CLOCK_FILE, 'utf8')).offsetMs;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.now() + offset()])); }
    static now() { return NativeDate.now() + offset(); }
  };
}
