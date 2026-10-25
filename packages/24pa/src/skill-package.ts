import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { constants } from 'node:fs';
import { open, readdir, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { fromBuffer, type ZipFile, type Entry } from 'yauzl';
import { ZipFile as ZipWriter } from 'yazl';
import type { SkillDefinitionLike } from './skills.js';

export const SKILL_PACKAGE_LIMITS = { files: 128, fileBytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, uploadBytes: 8 * 1024 * 1024 } as const;
export const SKILL_PACKAGE_PREVIEW_BYTES = 256 * 1024;
export interface SkillFile { path: string; bytes: number; hash: string; content: string }
export interface SkillPackage { files: SkillFile[]; hash: string; bytes: number }
export interface SkillParameter { type: 'string' | 'number' | 'integer' | 'boolean'; required?: boolean; default?: string | number | boolean; description?: string }
export interface SkillContract {
  schemaVersion: 1;
  mode: 'local' | 'business';
  parameters: Record<string, SkillParameter>;
  expectedResult: string;
  completionCriteria: string;
  actions?: string[];
  dependencies?: { resources?: string[]; commands?: string[]; environment?: string[] };
}
export const skillHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_SECRET = /(^|\/)(?:\.env(?:\.|$)|\.(?:git|24pa|dsh)(?:\/|$)|(?:credentials?|secrets?|tokens?)(?:[./]|$)|id_(?:rsa|ed25519)(?:[./]|$)|.*\.(?:pem|p12|pfx|key)$)/i;
const SECRET_VALUE = /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|(?:sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/;
const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key)$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function pathOf(raw: string): string {
  if (!raw || raw.length > 240 || raw !== raw.normalize('NFC') || /[\\:\u0000-\u001f\u007f]/u.test(raw) || isAbsolute(raw)) throw new Error(`包路径无效：${raw.slice(0, 100)}`);
  for (const segment of raw.split('/')) if (!segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) throw new Error(`包路径无效：${raw}`);
  if (PATH_SECRET.test(raw)) throw new Error(`包中不能包含凭据或隐藏运行数据：${raw}`);
  return raw;
}

function inspectMetadata(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('Skill 元数据嵌套过深。');
  if (typeof value === 'string' && (value.length > 60000 || SECRET_VALUE.test(value))) throw new Error('Skill 元数据包含超长文本或凭据内容。');
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error('Skill 元数据数组过长。');
    value.forEach(v => inspectMetadata(v, depth + 1));
  } else if (object(value)) {
    if (Object.keys(value).length > 128) throw new Error('Skill 元数据字段过多。');
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || SECRET_KEY.test(key)) throw new Error(`Skill 元数据不能包含该字段：${key}；凭据请使用环境引用。`);
      inspectMetadata(v, depth + 1);
    }
  } else if (value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value)) throw new Error('Skill 元数据类型无效。');
}

export function parseSkillMarkdown(markdown: string): SkillDefinitionLike {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error('SKILL.md 须以 YAML frontmatter 开头，包含 name 和 description。');
  const document = parseDocument(match[1]!, { uniqueKeys: true, version: '1.2' });
  if (document.errors.length || document.warnings.length) throw new Error(`Skill 元数据无效：${document.errors[0]?.message ?? document.warnings[0]?.message}`);
  const data: unknown = document.toJS({ maxAliasCount: 0 });
  if (!object(data)) throw new Error('Skill 元数据须为字段映射。');
  inspectMetadata(data);
  if (typeof data.name !== 'string' || data.name.length > 80 || !NAME.test(data.name)) throw new Error('Skill name 须为不超过 80 字符的小写英文、数字与连字符。');
  if (typeof data.description !== 'string' || !data.description.trim() || data.description.length > 2000) throw new Error('Skill description 须为 1–2000 字符。');
  for (const field of ['disable-model-invocation', 'user-invocable']) if (data[field] !== undefined && typeof data[field] !== 'boolean') throw new Error(`${field} 须为布尔值。`);
  if (data.metadata !== undefined && !object(data.metadata)) throw new Error('metadata 须为字段映射。');
  const content = match[2]!.trim();
  if (!content) throw new Error('Skill 正文不能为空。');
  return {
    name: data.name, description: data.description, content, metadata: data.metadata ?? {},
    ...(typeof data.whenToUse === 'string' ? { whenToUse: data.whenToUse } : {}),
    invocation: { modelInvocable: data['disable-model-invocation'] !== true, userInvocable: data['user-invocable'] !== false },
  };
}

/** Package bytes are the authority. All validation completes before a caller
 * can publish them; neither import nor export executes package instructions. */
export function makeSkillPackage(input: readonly { path: string; bytes: Buffer }[]): SkillPackage {
  if (!input.length || input.length > SKILL_PACKAGE_LIMITS.files) throw new Error(`Skill 包须为 1–${SKILL_PACKAGE_LIMITS.files} 个文件。`);
  let bytes = 0;
  const seen = new Set<string>();
  const files = input.map(file => {
    const path = pathOf(file.path);
    const key = path.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error(`包内路径重复：${path}`);
    seen.add(key);
    bytes += file.bytes.length;
    if (file.bytes.length > SKILL_PACKAGE_LIMITS.fileBytes || bytes > SKILL_PACKAGE_LIMITS.totalBytes) throw new Error('Skill 包超限：单文件 2 MiB、全部文件 8 MiB。');
    if (SECRET_VALUE.test(file.bytes.toString('utf8'))) throw new Error(`包文件包含可识别的凭据内容：${path}`);
    if (path === 'SKILL.md') {
      try { new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
      catch { throw new Error('SKILL.md 必须使用有效的 UTF-8 编码。'); }
    }
    return { path, bytes: file.bytes.length, hash: skillHash(file.bytes), content: file.bytes.toString('base64') };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const file of files) {
    const parts = file.path.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join('/'))) throw new Error(`文件与目录冲突：${file.path}`);
  }
  if (!files.some(file => file.path === 'SKILL.md')) throw new Error('包根目录缺少 SKILL.md。');
  return { files, bytes, hash: skillHash(JSON.stringify(files.map(({ path, hash, bytes }) => ({ path, hash, bytes })))) };
}

export function readSkillFile(pkg: SkillPackage, path: string): Buffer {
  const file = pkg.files.find(f => f.path === pathOf(path));
  if (!file) throw new Error(`Skill 包内不存在资源：${path}`);
  const bytes = Buffer.from(file.content, 'base64');
  if (bytes.length !== file.bytes || skillHash(bytes) !== file.hash) throw new Error(`Skill 资源校验失败：${path}`);
  return bytes;
}

export function validateSkillPackage(pkg: SkillPackage): SkillPackage {
  const checked = makeSkillPackage(pkg.files.map(file => ({ path: file.path, bytes: readSkillFile(pkg, file.path) })));
  if (checked.hash !== pkg.hash || checked.bytes !== pkg.bytes) throw new Error('Skill 包指纹不一致。');
  return checked;
}

export function skillPackageManifest(pkg: SkillPackage) {
  const checked = validateSkillPackage(pkg);
  return { packageHash: checked.hash, bytes: checked.bytes,
    files: checked.files.map(({ content: _content, ...file }) => file) };
}

export function skillPackagePreview(pkg: SkillPackage, path: string) {
  const checked = validateSkillPackage(pkg), bytes = readSkillFile(checked, path);
  const file = checked.files.find(item => item.path === path)!;
  const base = { path: file.path, bytes: file.bytes, hash: file.hash };
  const withoutText = (kind: 'binary' | 'invalid-text') => ({ ...base, preview: { kind, content: null, truncated: false } });
  if (bytes.includes(0)) return withoutText('binary');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try { decoder.decode(bytes); }
  catch { return withoutText('invalid-text'); }
  if (bytes.length <= SKILL_PACKAGE_PREVIEW_BYTES) return { ...base, preview: { kind: 'text' as const, content: bytes.toString('utf8'), truncated: false } };
  let end = SKILL_PACKAGE_PREVIEW_BYTES;
  for (;; end--) {
    try {
      const content = decoder.decode(bytes.subarray(0, end));
      return { ...base, preview: { kind: 'text' as const, content, truncated: true } };
    } catch { }
  }
}

export function editSkillPackage(pkg: SkillPackage, markdown: string): SkillPackage {
  return makeSkillPackage(pkg.files.map(file => ({ path: file.path, bytes: file.path === 'SKILL.md' ? Buffer.from(markdown) : readSkillFile(pkg, file.path) })));
}

/** Conversion creates a new draft; it never mutates the deterministic source
 * or silently grants the tools needed to change its behavior. */
export function intelligentSkillCopy(pkg: SkillPackage): SkillPackage {
  const source = parseSkillMarkdown(readSkillFile(pkg, 'SKILL.md').toString('utf8'));
  if (source.metadata?.track !== 'template') throw new Error('只有确定性模板需要转换为智能副本。');
  const definition = {
    name: source.name, description: `智能副本：${source.description ?? source.name}`,
    metadata: { track: 'agent', kind: 'task', tools: [], pa24: {
      schemaVersion: 1, mode: 'local', parameters: {},
      expectedResult: '按原模板业务规则和本次输入生成有依据的结果。',
      completionCriteria: '事实与建议分开；标明来源，缺少资料或工具时明确说明，不编造完成。',
    } },
  };
  return editSkillPackage(pkg, `---\n${JSON.stringify(definition, null, 2)}\n---\n\n这是使用模型执行的智能副本，可自由调整业务指令；运行会产生模型用量。启用前请明确所需工具与参数。\n\n${source.content}`);
}

export async function importSkillPackage(filename: string, bytes: Buffer): Promise<SkillPackage> {
  if (bytes.length > SKILL_PACKAGE_LIMITS.uploadBytes) throw new Error('上传文件不能超过 8 MiB。');
  if (/\.md$/i.test(filename)) return makeSkillPackage([{ path: 'SKILL.md', bytes }]);
  if (!/\.zip$/i.test(filename)) throw new Error('请选择 Markdown 或 ZIP 文件。');
  const zip = await new Promise<ZipFile>((accept, reject) => fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : accept(value!)));
  try {
    const files: { path: string; bytes: Buffer }[] = [];
    const paths = new Set<string>();
    let total = 0;
    let count = 0;
    await new Promise<void>((accept, reject) => {
      const fail = (error: unknown) => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', accept);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          if (++count > SKILL_PACKAGE_LIMITS.files * 2) throw new Error('ZIP 条目数量超限。');
          const directory = entry.fileName.endsWith('/');
          const path = pathOf(directory ? entry.fileName.slice(0, -1) : entry.fileName);
          const key = path.toLowerCase();
          if (paths.has(key)) throw new Error(`ZIP 路径重复：${path}`);
          paths.add(key);
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== (directory ? 0x4000 : 0x8000)) throw new Error(`ZIP 不接受链接或特殊文件：${path}`);
          if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) throw new Error('ZIP 不支持加密或该压缩方式。');
          if (directory) {
            if (entry.uncompressedSize) throw new Error('ZIP 目录携带了文件内容。');
          } else {
            if (files.length >= SKILL_PACKAGE_LIMITS.files || entry.uncompressedSize > SKILL_PACKAGE_LIMITS.fileBytes || total + entry.uncompressedSize > SKILL_PACKAGE_LIMITS.totalBytes) throw new Error('ZIP 解压后大小或文件数量超限。');
            const stream = await new Promise<NodeJS.ReadableStream>((ok, no) => zip.openReadStream(entry, (error, value) => error ? no(error) : ok(value!)));
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream) {
              const buffer = Buffer.from(chunk);
              size += buffer.length; total += buffer.length;
              if (size > SKILL_PACKAGE_LIMITS.fileBytes || total > SKILL_PACKAGE_LIMITS.totalBytes) throw new Error('ZIP 实际解压大小超限。');
              chunks.push(buffer);
            }
            const content = Buffer.concat(chunks);
            if (content.length !== entry.uncompressedSize || crc32(content) !== entry.crc32) throw new Error(`ZIP 内容校验失败：${path}`);
            files.push({ path, bytes: content });
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
    // Accept a single wrapper directory; multiple skills are never guessed.
    const roots = files.filter(file => file.path === 'SKILL.md' || file.path.endsWith('/SKILL.md'));
    if (roots.length !== 1) throw new Error('ZIP 须包含唯一的 SKILL.md。');
    const prefix = roots[0]!.path.slice(0, -'SKILL.md'.length);
    if (files.some(file => !file.path.startsWith(prefix))) throw new Error('ZIP 包装目录之外含有文件。');
    return makeSkillPackage(files.map(file => ({ path: file.path.slice(prefix.length), bytes: file.bytes })));
  } finally { zip.close(); }
}

export async function exportSkillPackage(pkg: SkillPackage): Promise<Buffer> {
  validateSkillPackage(pkg);
  const zip = new ZipWriter();
  for (const file of pkg.files) zip.addBuffer(readSkillFile(pkg, file.path), file.path, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644 });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Explicit file adoption copies a bounded stable observation, never writes
 * back. External editors need not honor our locks, so any observed change fails. */
export async function captureSkillDirectory(workspace: string, entry: string): Promise<SkillPackage> {
  const root = join(await realpath(workspace), '.dsh/skills');
  if (await realpath(root) !== root) throw new Error('工作区 Skill 目录不能是符号链接。');
  const logicalRoot = resolve(workspace, '.dsh/skills');
  const logicalPath = relative(logicalRoot, resolve(entry));
  // macOS exposes /var through /private/var. Canonicalize the workspace
  // prefix only; symlinks inside the package remain forbidden.
  const target = logicalPath && !logicalPath.startsWith('..') && !isAbsolute(logicalPath) ? join(root, logicalPath) : resolve(entry);
  const within = relative(root, target);
  if (!within || within.startsWith('..') || isAbsolute(within) || await realpath(target) !== target) throw new Error('文件 Skill 不在本工作区的真实 .dsh/skills 目录中。');
  const base = target.endsWith('/SKILL.md') ? dirname(target) : null;
  const files: { path: string; bytes: Buffer }[] = [];
  const observed: { path: string; hash: string }[] = [];
  const directories: { path: string; names: string[] }[] = [];
  let total = 0, entries = 0;
  async function real(path: string): Promise<void> {
    if (await realpath(path) !== path) throw new Error('Skill 路径已变更或包含符号链接。');
  }
  async function read(path: string, name: string) {
    if (files.length >= SKILL_PACKAGE_LIMITS.files) throw new Error('Skill 文件数量超限。');
    await real(dirname(path));
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > SKILL_PACKAGE_LIMITS.fileBytes || total + before.size > SKILL_PACKAGE_LIMITS.totalBytes) throw new Error('Skill 包含特殊文件或超限文件。');
      const bytes = await handle.readFile();
      total += bytes.length;
      if (total > SKILL_PACKAGE_LIMITS.totalBytes || bytes.length > SKILL_PACKAGE_LIMITS.fileBytes) throw new Error('Skill 包大小超限。');
      const after = await handle.stat();
      await real(dirname(path));
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Skill 文件读取期间已变化，请重新采纳。');
      files.push({ path: name, bytes }); observed.push({ path, hash: skillHash(bytes) });
    } finally { await handle.close(); }
  }
  async function walk(dir: string, prefix = ''): Promise<void> {
    await real(dir);
    const names = (await readdir(dir)).sort();
    directories.push({ path: dir, names });
    if (prefix.split('/').length > 20 || (entries += names.length) > SKILL_PACKAGE_LIMITS.files * 2) throw new Error('Skill 目录层级或条目数超限。');
    for (const name of names) {
      const path = join(dir, name), rel = pathOf(prefix + name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Skill 包不能包含符号链接：${rel}`);
      if (info.isDirectory()) await walk(path, `${rel}/`);
      else if (info.isFile()) await read(path, rel);
      else throw new Error(`Skill 包不能包含特殊文件：${rel}`);
    }
  }
  if (base) await walk(base); else await read(target, 'SKILL.md');
  for (const dir of directories) {
    await real(dir.path);
    if (JSON.stringify((await readdir(dir.path)).sort()) !== JSON.stringify(dir.names)) throw new Error('Skill 目录读取期间已变化，请重新采纳。');
  }
  for (const file of observed) {
    await real(dirname(file.path));
    const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > SKILL_PACKAGE_LIMITS.fileBytes || skillHash(await handle.readFile()) !== file.hash) throw new Error('源文件已被修改，请刷新后重新采纳。');
      await real(dirname(file.path));
    }
    finally { await handle.close(); }
  }
  return makeSkillPackage(files);
}

export function skillContract(def: SkillDefinitionLike): SkillContract | null {
  const input = def.metadata?.pa24;
  if (input === undefined || input === true) return null;
  if (!object(input) || input.schemaVersion !== 1 || !['local', 'business'].includes(String(input.mode)) || !object(input.parameters)) throw new Error('metadata.pa24 须声明 schemaVersion: 1、mode 和 parameters。');
  if (typeof input.expectedResult !== 'string' || !input.expectedResult.trim() || typeof input.completionCriteria !== 'string' || !input.completionCriteria.trim()) throw new Error('请填写预期结果和完成标准。');
  for (const [name, field] of Object.entries(input.parameters)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) || !object(field) || !['string', 'number', 'integer', 'boolean'].includes(String(field.type))) throw new Error(`参数定义无效：${name}`);
    if (field.required !== undefined && typeof field.required !== 'boolean') throw new Error(`参数 required 无效：${name}`);
    if (field.default !== undefined) validateParameter(name, field.default, field as unknown as SkillParameter);
  }
  if (input.actions !== undefined && (!Array.isArray(input.actions) || input.actions.some(a => typeof a !== 'string'))) throw new Error('actions 须为操作名称数组。');
  if (input.dependencies !== undefined) {
    if (!object(input.dependencies) || Object.keys(input.dependencies).some(key => !['resources', 'commands', 'environment'].includes(key))) throw new Error('dependencies 只接受 resources、commands 和 environment。');
    for (const [key, values] of Object.entries(input.dependencies)) {
      if (!Array.isArray(values) || values.length > 32 || values.some(value => typeof value !== 'string' || !value || value.length > 240)) throw new Error(`依赖 ${key} 须为最多 32 项的名称数组。`);
      for (const value of values as string[]) {
        if (key === 'resources') pathOf(value);
        if (key === 'commands' && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error('命令依赖须填写可执行文件名，不能包含路径或命令参数。');
        if (key === 'environment' && !/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new Error('环境依赖只保存变量名，不保存变量值。');
      }
      if (key === 'commands' && values.length && input.mode !== 'local') throw new Error('自定义命令依赖仅适用于本地执行；业务任务使用平台已授权工具。');
    }
  }
  if (def.metadata?.tools !== undefined && (!Array.isArray(def.metadata.tools) || def.metadata.tools.some(t => typeof t !== 'string'))) throw new Error('metadata.tools 须为工具名称数组，空数组表示不使用工具。');
  return input as unknown as SkillContract;
}

function validateParameter(name: string, value: unknown, field: SkillParameter): void {
  if (field.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== field.type || (field.type === 'number' && !Number.isFinite(value))) throw new Error(`参数 ${name} 应为 ${field.type}。`);
  if (field.required && typeof value === 'string' && !value.trim()) throw new Error(`参数 ${name} 不能为空。`);
}

export function skillParameters(contract: SkillContract, values: unknown): Record<string, unknown> {
  if (!object(values)) throw new Error('运行参数须为字段映射。');
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(values)) if (!Object.hasOwn(contract.parameters, key)) throw new Error(`未知参数：${key}`);
  for (const [name, field] of Object.entries(contract.parameters)) {
    const value = values[name] ?? field.default;
    if (value === undefined) { if (field.required) throw new Error(`缺少必填参数：${name}`); else continue; }
    validateParameter(name, value, field); result[name] = value;
  }
  return result;
}
