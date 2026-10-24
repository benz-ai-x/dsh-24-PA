import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { makeSkillPackage, parseSkillMarkdown, skillContract, skillParameters, importSkillPackage, exportSkillPackage, readSkillFile, captureSkillDirectory, intelligentSkillCopy, skillPackageManifest, skillPackagePreview, SKILL_PACKAGE_PREVIEW_BYTES } from '../../lib/skill-package.js';
import { skillRequirements } from '../../lib/skill-requirements.js';

const md = '---\nname: sample\ndescription: 样例\n---\n\n核实资料并生成结果。';
const file = (path, data = 'resource') => ({ path, bytes: Buffer.from(data) });

// A stored ZIP builder allows adversarial names/attributes that normal ZIP
// writers deliberately reject before reaching the package boundary.
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const { name, data = 'resource', mode = 0o100644, checksum } of entries) {
    const path = Buffer.from(name), bytes = Buffer.from(data), crc = checksum ?? crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(path.length, 26);
    locals.push(local, path, bytes);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(bytes.length, 24); header.writeUInt16LE(path.length, 28);
    header.writeUInt32LE((mode << 16) >>> 0, 38); header.writeUInt32LE(offset, 42); central.push(header, path);
    offset += local.length + path.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('Skill 包边界', () => {
  it('启用前只读检查声明的文件、命令和环境依赖，不执行命令、不泄露变量值', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa24-dependency-'));
    try {
      const executable = join(root, 'fake-engine'); await writeFile(executable, '#!/bin/sh\nexit 73\n'); await chmod(executable, 0o700);
      const pkg = makeSkillPackage([file('SKILL.md', md), file('references/data.txt')]);
      const definition = { ...parseSkillMarkdown(md), metadata: { tools: [], pa24: { schemaVersion: 1, mode: 'local', parameters: {}, expectedResult: '结果', completionCriteria: '标准',
        dependencies: { commands: ['fake-engine'], environment: ['PA24_TEST_CREDENTIAL'], resources: ['references/data.txt'] } } } };
      expect(await skillRequirements(definition, pkg, { PATH: root, PA24_TEST_CREDENTIAL: 'DO_NOT_PRINT' })).toEqual([]);
      const missing = await skillRequirements(definition, makeSkillPackage([file('SKILL.md', md)]), { PATH: root, PA24_TEST_CREDENTIAL: '' });
      expect(missing).toHaveLength(2); expect(missing.join(' ')).not.toContain('DO_NOT_PRINT');
      await chmod(executable, 0o600);
      expect((await skillRequirements(definition, pkg, { PATH: root, PA24_TEST_CREDENTIAL: 'secret' })).join(' ')).toContain('缺少可执行依赖');
      definition.metadata.pa24.dependencies.commands = ['echo secret'];
      expect(() => skillContract(definition)).toThrow(/命令参数/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('确定性模板转智能副本保留业务正文和资源，不继承工具授权、不修改原件', () => {
    const original = makeSkillPackage([file('SKILL.md', md.replace('description: 样例', 'description: 样例\nmetadata: {track: template, tools: [pa24_work]}')), file('references/facts.txt', '原始资料')]);
    const copy = intelligentSkillCopy(original);
    const definition = parseSkillMarkdown(readSkillFile(copy, 'SKILL.md').toString());
    expect(definition.metadata).toMatchObject({ track: 'agent', kind: 'task', tools: [], pa24: { mode: 'local', parameters: {} } });
    expect(skillContract(definition)).toBeTruthy();
    expect(definition.content).toContain('模型用量'); expect(definition.content).toContain('核实资料');
    expect(readSkillFile(copy, 'references/facts.txt').equals(readSkillFile(original, 'references/facts.txt'))).toBe(true);
    expect(parseSkillMarkdown(readSkillFile(original, 'SKILL.md').toString()).metadata.track).toBe('template');
    expect(() => intelligentSkillCopy(copy)).toThrow(/只有确定性模板/);
  });

  it('完整包往返保留脚本、二进制资源和指纹，导入不执行脚本', async () => {
    const pkg = makeSkillPackage([file('SKILL.md', md), file('scripts/run.sh', 'exit 77'), file('references/facts.txt', '事实'), file('assets/pixel.bin', Buffer.from([0, 255, 127]))]);
    const restored = await importSkillPackage('skill.zip', await exportSkillPackage(pkg));
    expect(restored).toEqual(pkg); expect(readSkillFile(restored, 'assets/pixel.bin')).toEqual(Buffer.from([0, 255, 127]));
    expect(await importSkillPackage('skill.md', Buffer.from(md))).toEqual(makeSkillPackage([file('SKILL.md', md)]));
  });

  it('包清单只暴露真实路径、大小和 SHA-256，文本与空文件预览不携带 Base64', () => {
    const pkg = makeSkillPackage([file('SKILL.md', md), file('references/中文.txt', '甲乙丙'), file('empty.txt', Buffer.alloc(0))]);
    const manifest = skillPackageManifest(pkg);
    expect(manifest.packageHash).toBe(pkg.hash);
    expect(manifest.files.map(item => item.path)).toEqual(['empty.txt', 'references/中文.txt', 'SKILL.md']);
    expect(manifest.files.every(item => item.content === undefined)).toBe(true);
    expect(skillPackagePreview(pkg, 'references/中文.txt')).toMatchObject({ bytes: 9, preview: { kind: 'text', content: '甲乙丙', truncated: false } });
    expect(skillPackagePreview(pkg, 'empty.txt')).toMatchObject({ hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', preview: { kind: 'text', content: '', truncated: false } });
    expect(skillPackagePreview(pkg, 'SKILL.md').content).toBeUndefined();
    for (const path of ['../outside', '/absolute', 'scripts\\escape', 'missing.txt']) expect(() => skillPackagePreview(pkg, path)).toThrow();
    const changed = structuredClone(pkg); changed.files.find(item => item.path === 'references/中文.txt').content = Buffer.from('tampered').toString('base64');
    expect(() => skillPackagePreview(changed, 'references/中文.txt')).toThrow(/校验|指纹/);
    expect(() => skillPackageManifest({ ...pkg, hash: '0'.repeat(64) })).toThrow(/指纹/);
  });

  it('NUL 与非法 UTF-8 是二进制且不返正文，超过 256 KiB 的合法文本按字符边界截断', () => {
    const long = Buffer.from('界'.repeat(Math.ceil(SKILL_PACKAGE_PREVIEW_BYTES / 3) + 2));
    const pkg = makeSkillPackage([file('SKILL.md', md), file('null-byte.bin', Buffer.concat([Buffer.from('text'), Buffer.from([0]), Buffer.from('more')])),
      file('invalid.bin', Buffer.from([0xe4, 0xb8])), file('late-invalid.bin', Buffer.concat([Buffer.alloc(SKILL_PACKAGE_PREVIEW_BYTES + 4, 97), Buffer.from([255])])), file('long.txt', long)]);
    for (const path of ['null-byte.bin', 'invalid.bin', 'late-invalid.bin']) expect(skillPackagePreview(pkg, path).preview).toEqual({ kind: 'binary', content: null, truncated: false });
    const preview = skillPackagePreview(pkg, 'long.txt');
    expect(preview.bytes).toBe(long.length); expect(preview.preview.kind).toBe('text'); expect(preview.preview.truncated).toBe(true);
    expect(Buffer.byteLength(preview.preview.content)).toBeLessThanOrEqual(SKILL_PACKAGE_PREVIEW_BYTES);
    expect(Buffer.byteLength(preview.preview.content)).toBeGreaterThanOrEqual(SKILL_PACKAGE_PREVIEW_BYTES - 2);
    expect(preview.preview.content).not.toContain('�');
  });

  it.each(['../outside', '/absolute', 'C:/absolute', 'scripts\\escape', 'references/AUX.txt', '.24pa/history.json', '.dsh/config.json', '.env.local', 'references/token.json', 'assets/key.pem'])('拒绝不可移植或敏感路径 %s', path => {
    expect(() => makeSkillPackage([file('SKILL.md', md), file(path)])).toThrow();
  });
  it('拒绝大小写冲突、文件目录冲突、大小和数量超限以及无效文本编码', () => {
    for (const files of [[file('SKILL.md', md), file('skill.md')], [file('SKILL.md', md), file('assets'), file('assets/a')], [file('SKILL.md', md), file('large', Buffer.alloc(2 * 1024 * 1024 + 1))], [file('SKILL.md', md), ...Array.from({ length: 128 }, (_, i) => file('f' + i))], [file('SKILL.md', Buffer.from([255]))]]) {
      expect(() => makeSkillPackage(files)).toThrow();
    }
  });
  it('ZIP 唯一包装目录可导入；多 Skill、目录外文件、链接、路径逃逸和 CRC 损坏均拒绝', async () => {
    expect((await importSkillPackage('one.zip', zip([{ name: 'one/SKILL.md', data: md }, { name: 'one/assets/a' }]))).files.map(f => f.path)).toEqual(['assets/a', 'SKILL.md']);
    for (const entries of [
      [{ name: 'a/SKILL.md', data: md }, { name: 'b/SKILL.md', data: md }],
      [{ name: 'a/SKILL.md', data: md }, { name: 'outside.txt' }],
      [{ name: 'SKILL.md', data: md }, { name: 'assets/link', data: '/tmp/elsewhere', mode: 0o120777 }],
      [{ name: 'SKILL.md', data: md }, { name: '../escape' }],
      [{ name: 'SKILL.md', data: md, checksum: 42 }],
      [{ name: 'SKILL.md', data: md }, { name: 'a' }, { name: 'A' }],
    ]) await expect(importSkillPackage('bad.zip', zip(entries))).rejects.toThrow();
  });
  it('拒绝 YAML 重复键、别名扩张、原型字段、凭据字段和可识别密钥', () => {
    for (const frontmatter of ['name: a\nname: b\ndescription: d', 'name: a\ndescription: &x d\nmetadata: {alias: *x}', 'name: a\ndescription: d\nmetadata: {__proto__: {polluted: true}}', 'name: a\ndescription: d\nmetadata: {api_key: secret}']) {
      expect(() => parseSkillMarkdown('---\n' + frontmatter + '\n---\nbody')).toThrow();
    }
    expect(() => makeSkillPackage([file('SKILL.md', md), file('assets/plain.txt', '-----BEGIN PRIVATE KEY-----')])).toThrow(/凭据/);
    expect({}.polluted).toBeUndefined();
  });
  it('参数按声明校验，未知字段、必填空值、非有限数字和非法默认值拒绝', () => {
    const def = { name: 'sample', content: 'work', metadata: { tools: [], pa24: { schemaVersion: 1, mode: 'local', parameters: { subject: { type: 'string', required: true }, count: { type: 'integer', default: 2 }, flag: { type: 'boolean' } }, expectedResult: 'result', completionCriteria: 'criteria' } } };
    const contract = skillContract(def);
    expect(skillParameters(contract, { subject: '内容', flag: false })).toEqual({ subject: '内容', count: 2, flag: false });
    for (const values of [{}, { subject: '' }, { subject: 'x', count: 0.5 }, { subject: 'x', extra: true }, { subject: 'x', count: Infinity }]) expect(() => skillParameters(contract, values)).toThrow();
    expect(() => skillContract({ ...def, metadata: { ...def.metadata, pa24: { ...contract, parameters: { count: { type: 'integer', default: '2' } } } } })).toThrow();
  });
  it('文件采纳包含完整包，保留原件，拒绝越界与任何符号链接', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa24-package-'));
    try {
      const dir = join(root, '.dsh/skills/example'); await mkdir(join(dir, 'references'), { recursive: true });
      const entry = join(dir, 'SKILL.md'); await writeFile(entry, md); await writeFile(join(dir, 'references/a.txt'), 'original');
      expect((await captureSkillDirectory(root, entry)).files).toHaveLength(2);
      const outside = join(root, 'outside.md'); await writeFile(outside, md);
      await expect(captureSkillDirectory(root, outside)).rejects.toThrow();
      await symlink(outside, join(dir, 'references/link'));
      await expect(captureSkillDirectory(root, entry)).rejects.toThrow(/链接/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
