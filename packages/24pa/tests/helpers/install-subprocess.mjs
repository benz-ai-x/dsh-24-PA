// Runs for every test file (vitest setupFiles): the plugin's CLI gateway
// starts a process only through a subprocess service (#310), so a stand-in
// for the host's is named before any test can run one.
import { startChildrenThrough } from '../../lib/cli-gateway.js';
import { installedSubprocess } from './subprocess.mjs';

startChildrenThrough(installedSubprocess);
