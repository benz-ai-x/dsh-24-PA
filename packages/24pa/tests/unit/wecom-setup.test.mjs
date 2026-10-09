// F16/F23 unit: the bundled wecom-setup.md guide must ship with the package
// and carry the one-shot delivery structure and channel contracts.
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('企微接入指南（wecom-setup.md）', () => {
  it('随包分发且包含一次交付结构与关键契约', async () => {
    const content = await readFile(resolve(pkgDir, 'wecom-setup.md'), 'utf8');
    for (const heading of ['准备（你代办，配置开始立即做）', '本人操作全量清单（一次交付给本人）', '块 A', '块 B', '自动验收（一次汇总，不逐项追问）', '授权到期后的续期（持续性）', '已知边界']) {
      expect(content).toContain(heading);
    }
    expect(content).toContain('一次交付＋一次验收');
    expect(content).toContain('auth init');
    expect(content).toContain('850002');
    expect(content).toContain('850003');
    expect(content).toContain('主动推送续期链接');
  });
});
