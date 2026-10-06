import { describe, expect, it } from 'vitest';
import {
  detectImageMediaType,
  diffNormalized,
  fingerprintOf,
  normalizeDocument,
  noteDocumentXml,
  pendingReviewLine,
  reviewCard,
  SYSTEM_BLOCK_PREFIX,
} from '../../lib/handwriting.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(1)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

const recognized = {
  transcript: '周一 例会\n讨论 Q4 预算',
  summary: '例会记录，含 Q4 预算讨论',
  suggestions: ['建议先汇总各部门需求'],
  unknowns: ['第二行“预算”二字不确定'],
  candidates: ['周五前交预算初稿'],
  relativeDates: [{ original: '周五前', interpretation: '以收稿日期为基准的本周五' }],
};

describe('handwriting 纯函数（F06）', () => {
  it('魔数判定区分 PNG/JPEG/WebP，未知字节返回 null', () => {
    expect(detectImageMediaType(png)).toBe('image/png');
    expect(detectImageMediaType(jpeg)).toBe('image/jpeg');
    expect(detectImageMediaType(webp)).toBe('image/webp');
    expect(detectImageMediaType(Buffer.from('not an image'))).toBeNull();
  });

  it('文档模板包含系统状态块与分离的转写/摘要/疑点/候选', () => {
    const xml = noteDocumentXml('N-1', 1, recognized, [{ pageNo: 1, sha256: 'a'.repeat(64), mediaType: 'image/png', byteSize: 1024 }]);
    expect(xml).toContain(pendingReviewLine('N-1', 1));
    expect(xml).toContain('整理摘要');
    expect(xml).toContain('整理正文');
    expect(xml).toContain('候选行动（未授权执行）');
    expect(xml).toContain('疑点与未知');
    expect(xml).toContain('AI 建议（推断，非原文）');
    expect(xml).toContain('相对日期依据');
    expect(xml).toContain('原稿索引');
    expect(xml).toContain('sha256 aaaaaaaaaaaaaaaa…');
  });

  it('规范化排除系统状态块：状态块更新不改变指纹（P32）', () => {
    const xml = noteDocumentXml('N-1', 1, recognized, [{ pageNo: 1, sha256: 'a'.repeat(64), mediaType: 'image/png', byteSize: 1024 }]);
    const before = fingerprintOf(normalizeDocument(xml), ['a'.repeat(64)]);
    const updated = xml.replace(pendingReviewLine('N-1', 1), `${SYSTEM_BLOCK_PREFIX}审核状态：本人已审核 N-1 v1`);
    const after = fingerprintOf(normalizeDocument(updated), ['a'.repeat(64)]);
    expect(after).toBe(before);
    // 原稿变化（换页哈希）必须反映到指纹
    const pageChanged = fingerprintOf(normalizeDocument(xml), ['b'.repeat(64)]);
    expect(pageChanged).not.toBe(before);
  });

  it('正文增删、图片块数量变化都会改变规范化文本', () => {
    const xml = noteDocumentXml('N-1', 1, recognized, [{ pageNo: 1, sha256: 'a'.repeat(64), mediaType: 'image/png', byteSize: 1024 }]);
    const base = normalizeDocument(xml);
    const edited = normalizeDocument(`${xml}<p>新增的一段主人修改</p>`);
    expect(edited).not.toBe(base);
    expect(diffNormalized(base, edited).added).toEqual(['新增的一段主人修改']);
    const withImage = normalizeDocument(`${xml}<img src="x"/><img src="y"/>`);
    expect(withImage.endsWith('[图片 x2]')).toBe(true);
    expect(withImage).not.toBe(base);
  });

  it('审核卡携带两个不透明令牌与文档入口', () => {
    const card = reviewCard('N-1', 1, 'https://example.feishu.cn/wiki/docstub-1', '摘要', 'abcdef123456', 'token-approve', 'token-return');
    const actions = JSON.stringify(card);
    expect(actions).toContain('token-approve');
    expect(actions).toContain('token-return');
    expect(actions).toContain('https://example.feishu.cn/wiki/docstub-1');
    expect(actions).toContain('批准 v1');
  });
});
