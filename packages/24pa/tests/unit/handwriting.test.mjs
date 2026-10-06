import { describe, expect, it } from 'vitest';
import {
  cropBox,
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

  it('cropBox：归一化区域换算夹紧并标记 estimated', () => {
    const exact = cropBox({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1000, 800);
    expect(exact.box).toEqual({ left: 250, top: 200, width: 500, height: 400 });
    expect(exact.certainty).toBe('reliable');
    const clamped = cropBox({ x: 0.95, y: -0.2, w: 0.2, h: 0.05 }, 1000, 800);
    expect(clamped.certainty).toBe('estimated');
    expect(clamped.box.left + clamped.box.width).toBeLessThanOrEqual(1000);
    expect(clamped.box.top).toBeGreaterThanOrEqual(0);
    const tiny = cropBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, 1000, 800);
    expect(tiny.box.width).toBeGreaterThanOrEqual(16);
    expect(tiny.certainty).toBe('estimated');
  });

  it('文档模板包含系统状态块与分离的转写/摘要/疑点/候选', () => {
    const xml = noteDocumentXml('N-1', 1, recognized, [{ pageNo: 1, sha256: 'a'.repeat(64), mediaType: 'image/png', byteSize: 1024, sourceType: 'image' }]);
    expect(xml).toContain(pendingReviewLine('N-1', 1));
    expect(xml).toContain('整理摘要');
    expect(xml).toContain('整理正文');
    expect(xml).toContain('候选行动（未授权执行）');
    expect(xml).toContain('疑点与定位');
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

describe('F07 多页与集中复核', () => {
  const page = (no, sha) => ({ pageNo: no, sha256: sha.repeat(64), mediaType: 'image/png', byteSize: 1024, sourceType: no === 2 ? 'file' : 'image' });
  const multi = {
    ...recognized,
    pages: [
      { pageNo: 1, transcript: '第一页：预算讨论' },
      { pageNo: 2, transcript: '第二页：联系人' },
      { pageNo: 3, transcript: '第三页：行动项' },
    ],
    doubts: [
      { pageNo: 2, kind: 'name', quote: '王小明', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, certainty: 'reliable' },
      { pageNo: 3, kind: 'number', quote: '12万', certainty: 'page' },
    ],
    diagrams: [{ pageNo: 1, description: '流程图：申请→审批→归档', region: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, certainty: 'reliable' }],
  };

  it('裁片编号只数带区域的条目：无区域疑点在前不占号（与 generateCrops 一致）', () => {
    const fixture = {
      ...recognized,
      doubts: [
        { pageNo: 1, kind: 'number', quote: '12万', certainty: 'page' },
        { pageNo: 2, kind: 'name', quote: '王小明', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, certainty: 'reliable' },
      ],
      diagrams: [{ pageNo: 1, description: '流程图', region: { x: 0.4, y: 0.4, w: 0.4, h: 0.4 }, certainty: 'reliable' }],
    };
    const xml = noteDocumentXml('N-8', 1, fixture, [page(1, 'a'), page(2, 'b')]);
    expect(xml).toContain('第 1 页【数字】“12万”');
    expect(xml).not.toContain('裁片 C1”');
    expect(xml).toContain('第 2 页【人名】“王小明”');
    expect(xml).toMatch(/人名.*裁片 C1/s);
    expect(xml).toMatch(/流程图.*裁片 C2/s);
  });

  it('advanceReminder：单次即止；每日保底间隔且累计 3 次封顶', async () => {
    const { advanceReminder, REMINDER_DAILY_MAX_SENDS } = await import('../../lib/handwriting.js');
    expect(advanceReminder('once', 1, 1000)).toEqual({ status: 'sent', remindAt: null });
    const first = advanceReminder('daily', 1, 1000);
    expect(first.status).toBe('pending');
    expect(first.remindAt.getTime()).toBe(1000 + 6 * 3600 * 1000);
    expect(advanceReminder('daily', REMINDER_DAILY_MAX_SENDS, 1000).status).toBe('done');
  });

  it('多页模板：逐页转写按页序、疑点带页码区域与裁片编号、图示保留原图说明', () => {
    const xml = noteDocumentXml('N-9', 1, multi, [page(1, 'a'), page(2, 'b'), page(3, 'c')]);
    expect(xml).toContain('第 1 页 转写');
    expect(xml).toContain('第一页：预算讨论');
    expect(xml).toContain('第二页：联系人');
    expect(xml).toContain('第 2 页【人名】“王小明”');
    expect(xml).toContain('裁片 C1');
    expect(xml).toContain('第 3 页【数字】“12万”');
    expect(xml).toContain('整页引用');
    expect(xml).toContain('流程图：申请→审批→归档');
    expect(xml).toContain('不做矢量重绘');
    expect(xml).toContain('文件原图');
    expect(xml).toContain('平台图片（可能已压缩）');
  });

  it('指纹覆盖页序、疑点区域与裁片内容（P30 AC6）', () => {
    const pages = [page(1, 'a'), page(2, 'b'), page(3, 'c')];
    const xml = noteDocumentXml('N-9', 1, multi, pages);
    const base = normalizeDocument(xml);
    const fp = (p, c) => fingerprintOf(base, p.map(x => x.sha256), c);
    const crops = ['x'.repeat(64), 'y'.repeat(64)];
    // 页序变化（sha 顺序）改变指纹
    expect(fp([page(1, 'a'), page(3, 'c'), page(2, 'b')], crops)).not.toBe(fp(pages, crops));
    // 裁片内容变化改变指纹
    expect(fp(pages, ['z'.repeat(64)])).not.toBe(fp(pages, crops));
    // 疑点区域文本变化改变指纹
    const moved = { ...multi, doubts: [{ ...multi.doubts[0], region: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 }, certainty: 'reliable' }] };
    expect(normalizeDocument(noteDocumentXml('N-9', 1, moved, pages))).not.toBe(base);
  });
});

