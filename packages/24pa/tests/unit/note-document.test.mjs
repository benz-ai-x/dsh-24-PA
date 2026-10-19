import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LarkNoteDocumentReader } from '../../lib/note-trust.js';
import { canonicalDocument } from '../../lib/note-document.js';

let root, statePath, reader;
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-document-')); statePath = join(root, 'state.json');
  const bin = join(root, 'lark-cli');
  await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(statePath) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
  reader = new LarkNoteDocumentReader(() => ({ bin, profile: 'test', timeoutMs: 5000 }));
});
afterEach(() => rm(root, { recursive: true, force: true }));
const document = (content, reference_map = {}, mediaOverrides = {}) => writeFile(statePath, JSON.stringify({ documentOverride: { document_id: 'doc', revision_id: 1, content, reference_map }, mediaOverrides }));

it('生产 reader 解析同响应 sidecar，换 token 同图片等价，同 token 换字节 changed', async () => {
  await document('<title>材料</title><p id="a">正文</p><img ref="image-1"/>', { img: { 'image-1': { token: 'first' } } }, { first: image.toString('base64') });
  const first = await reader.read('doc');
  await document('<title>材料</title><p id="b">正文</p><img token="second"/>', {}, { second: image.toString('base64') });
  expect((await reader.read('doc')).normalized).toBe(first.normalized);
  await document('<title>材料</title><p>正文</p><img token="second"/>', {}, { second: Buffer.concat([image, Buffer.from('changed')]).toString('base64') });
  expect((await reader.read('doc')).normalized).not.toBe(first.normalized);
});

it('标题、结构及图片相对位置进入指纹；任意前缀正文不视作系统块', () => {
  const base = '<title>A</title><p>【24PA·系统】审核状态：待本人审核 N-1 v1（尚未经人工审核）</p><p>内容</p><img token="a"/>';
  const normalized = canonicalDocument(base, ['sha']);
  expect(canonicalDocument(base.replace('<title>A', '<title>B'), ['sha'])).not.toBe(normalized);
  expect(canonicalDocument(base.replace('<p>内容</p><img token="a"/>', '<img token="a"/><p>内容</p>'), ['sha'])).not.toBe(normalized);
  expect(canonicalDocument(base.replace('<p>内容</p>', '<ul><li>内容</li></ul>'), ['sha'])).not.toBe(normalized);
  expect(canonicalDocument(base.replace('待本人审核 N-1 v1（尚未经人工审核）', '本人已审核 N-1 v1'), ['sha'])).toBe(normalized);
  expect(canonicalDocument(base + '<p>【24PA·系统】真实业务内容</p>', ['sha'])).not.toBe(normalized);
});

it.each(['<synced_reference src-token="x" src-block-id="y"/>', '<sheet token="x"/>', '<whiteboard token="x"/>', '<fragment><p>部分正文</p></fragment>', '<p>不完整'])('动态/片段/损坏 XML 不形成完整快照：%s', async content => {
  await document('<title>材料</title>' + content);
  await expect(reader.read('doc')).rejects.toThrow(/尚无完整静态快照|unclosed tag/);
});

it('无法下载图片不能退化成仅计数的通过结果', async () => {
  await document('<title>材料</title><img token="missing"/>');
  await expect(reader.read('doc')).rejects.toThrow(/resource token missing/);
});
