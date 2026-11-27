// Stand-ins for the vendor CLIs, for tests that run them from a file: each runs the test stub, told where its state is.
import { chmod, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const STATE_VARIABLE = { lark: 'PA24_LARK_STUB_STATE', wecom: 'PA24_WECOM_STUB_STATE' };
/** Write a stand-in for lark-cli or wecom-cli into `dir`; it is executable, and returns its path. */
export async function writeStandIn(dir, name, state) {
  const path = join(dir, `${name}-cli`);
  await writeFile(path, '#!/usr/bin/env node\nprocess.env.' + STATE_VARIABLE[name] + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n', { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}
