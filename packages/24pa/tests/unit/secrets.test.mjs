import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SECRET_KEYS, readSecretStore, writeSecretStore, resolveSecret, secretStatus, secretsPath,
} from '../../lib/secrets.js';

describe('工作区密钥库（F36）', () => {
  it('空/缺库/坏库都按空库读，不抛', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa24-sec-'));
    expect(await readSecretStore(dir)).toEqual({});
    await mkdir(join(dir, '.24pa'), { recursive: true });
    await writeFile(secretsPath(dir), 'not json', 'utf8');
    expect(await readSecretStore(dir)).toEqual({});
    await writeFile(secretsPath(dir), JSON.stringify({ feishuAppId: 'x', other: 1, pgDsn: '' }), 'utf8');
    expect(await readSecretStore(dir)).toEqual({ feishuAppId: 'x' }); // 非白名单/空值丢弃
  });

  it('写库原子且 0600；清除＝删除该位', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa24-sec-'));
    await writeSecretStore(dir, { feishuAppId: 'cli_a', volcTtsKey: 'k1' });
    const st = await stat(secretsPath(dir));
    expect(st.mode & 0o777).toBe(0o600);
    expect(await readSecretStore(dir)).toEqual({ feishuAppId: 'cli_a', volcTtsKey: 'k1' });
    await writeSecretStore(dir, { feishuAppId: 'cli_a' }); // volcTtsKey 被清除
    expect(await readSecretStore(dir)).toEqual({ feishuAppId: 'cli_a' });
    const raw = await readFile(secretsPath(dir), 'utf8');
    expect(raw).not.toContain('k1');
  });

  it('解析顺序：环境变量优先于密钥库；refName 空只看库', () => {
    const env = { PA24_FEISHU_APP_ID: 'from-env' };
    const store = { feishuAppId: 'from-store', volcTtsKey: 'k' };
    expect(resolveSecret('PA24_FEISHU_APP_ID', env, store, 'feishuAppId')).toBe('from-env');
    expect(resolveSecret(undefined, env, store, 'volcTtsKey')).toBe('k');
    expect(resolveSecret('MISSING', env, store, 'feishuAppId')).toBe('from-store');
    expect(resolveSecret('MISSING', env, {}, 'feishuAppId')).toBe('');
  });

  it('secretStatus 只含 {set, source}，永不包含值', () => {
    const refs = { feishuAppId: 'PA24_FEISHU_APP_ID', appSecretEnv: undefined, pgDsn: 'PA24_PG_DSN', volcTtsKey: 'VOLC_TTS_KEY' };
    const status = secretStatus(
      { feishuAppId: refs.feishuAppId, feishuAppSecret: undefined, pgDsn: refs.pgDsn, volcTtsKey: refs.volcTtsKey },
      { PA24_FEISHU_APP_ID: 'from-env', VOLC_TTS_KEY: '' },
      { volcTtsKey: 'secret-value-must-not-appear', pgDsn: '' },
    );
    expect(status.feishuAppId).toEqual({ set: true, source: 'env' });
    expect(status.feishuAppSecret).toEqual({ set: false, source: null });
    expect(status.volcTtsKey).toEqual({ set: true, source: 'store' });
    expect(status.pgDsn).toEqual({ set: false, source: null });
    expect(JSON.stringify(status)).not.toContain('secret-value');
    for (const key of SECRET_KEYS) expect(status[key]).toBeDefined();
  });
});
