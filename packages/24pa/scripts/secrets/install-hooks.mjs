// Idempotent local setup: point git's hooksPath at the committed pre-commit
// secret scanner. CI runs the same scanner directly (see the secret-scan
// workflow), so skipping this only loses the local pre-push of the gate.
import { execFileSync } from 'node:child_process';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const hooksPath = 'packages/24pa/scripts/secrets/hooks';
let current = '';
try {
  current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
} catch {
  // git config --get exits non-zero when the key is unset.
}
if (current.trim() === hooksPath) {
  console.log(`core.hooksPath already set to ${hooksPath}`);
} else {
  execFileSync('git', ['config', 'core.hooksPath', hooksPath]);
  console.log(`core.hooksPath -> ${hooksPath} (pre-commit secret scan enabled)`);
}
console.log(`repo root: ${root}`);
