// #307: the official Feishu plugin manages lark-cli's current configuration and
// passes no profile. The default profile follows it; a named profile still
// selects its own, and readiness then says the plugin page manages the current
// configuration only.
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LARK_PROFILE, runLarkCli } from '../../lib/lark.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { fixture } from '../helpers/runtime.mjs';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

/** A lark-cli stand-in that reports the arguments it was given in the official envelope. */
async function echoCli() {
  const root = await mkdtemp(join(tmpdir(), 'pa24-lark-profile-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'lark-cli');
  await writeFile(bin, "#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true, data: { argv: process.argv.slice(2) } }));\n", { mode: 0o755 });
  await chmod(bin, 0o755);
  return bin;
}

describe('lark-cli profile（#307）', () => {
  it('缺省 profile 就是配置的缺省值', () => {
    expect(DEFAULT_CONFIG.larkProfile).toBe(DEFAULT_LARK_PROFILE);
  });

  it('缺省 profile 不传 --profile，与官方飞书插件同语义', async () => {
    const bin = await echoCli();
    const { data } = await runLarkCli({ bin, profile: DEFAULT_LARK_PROFILE, timeoutMs: 10000 }, ['auth', 'status', '--verify']);
    expect(data.argv).toEqual(['auth', 'status', '--verify', '--json']);
  });

  it('具名 profile 仍然选自己的配置', async () => {
    const bin = await echoCli();
    const { data } = await runLarkCli({ bin, profile: 'work', timeoutMs: 10000 }, ['auth', 'status']);
    expect(data.argv).toEqual(['--profile', 'work', 'auth', 'status', '--json']);
  });

  it('readiness 只在具名 profile 时提示插件页只管理当前生效配置', async () => {
    const f = await fixture(); cleanup.push(() => f.cleanup());
    const configMessage = async patch => {
      await f.rt.bind(await f.workspace(`profile-${patch.larkProfile ?? 'default'}`, patch));
      return f.rt.readiness().items.find(row => row.id === 'config').message;
    };
    expect(await configMessage({})).toContain('profile=default');
    expect(await configMessage({})).not.toContain('具名 profile');
    const named = await configMessage({ larkProfile: 'work' });
    expect(named).toContain('profile=work');
    expect(named).toContain('官方飞书插件页只管理 lark-cli 当前生效的配置');
  });
});
