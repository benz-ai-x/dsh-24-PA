import { createHash, randomBytes } from 'node:crypto';

// F06/F07 handwriting pure helpers: note document templates, review
// fingerprints, crop geometry, line diffs and the review card payload. The
// registered system-status marker is excluded from fingerprints so refreshing
// the status block itself never invalidates a review (P32).

export const SYSTEM_BLOCK_PREFIX = '【24PA·系统】';
export const NOTE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES_PER_NOTE = 50;
/** Recognition batch budget: pages per delegated recognition (P30 到限暂停/分批). */
export const RECOGNITION_PAGE_LIMIT = 20;
export const REVIEW_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

/** Doubt categories with high review impact (P30/P73). */
export const DOUBT_KINDS = ['number', 'name', 'abbr', 'date', 'negation', 'checkbox', 'unclear'] as const;
export type DoubtKind = (typeof DOUBT_KINDS)[number];
export const DOUBT_KIND_LABELS: Record<DoubtKind, string> = {
  number: '数字',
  name: '人名',
  abbr: '英文缩写',
  date: '日期',
  negation: '否定词',
  checkbox: '勾选状态',
  unclear: '无法辨认',
};

/** Normalized region relative to the page original (0–1, top-left origin). */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DoubtSpec {
  pageNo: number;
  kind: DoubtKind | string;
  quote: string;
  region?: Region;
  /** reliable = model-provided region; estimated = adjusted/clamped; page = whole-page reference. */
  certainty: 'reliable' | 'estimated' | 'page';
  note?: string;
}

export interface DiagramSpec {
  pageNo: number;
  description: string;
  region?: Region;
}

/** Durable crop derived from a page original (P30): identity, transform, bytes. */
export interface CropSpec {
  id: string;
  pageNo: number;
  kind: 'doubt' | 'diagram';
  region: Region;
  certainty: 'reliable' | 'estimated';
  path: string;
  sha256: string;
}

/** Reminder pacing (P33 限频): once sends immediately; daily keeps a floor
 * interval and stops after the cap without a fresh instruction. */
export const REMINDER_DAILY_MIN_INTERVAL_MS = 6 * 3600 * 1000;
export const REMINDER_DAILY_MAX_SENDS = 3;

export function advanceReminder(kind: 'once' | 'daily', sentCount: number, now: number): { status: 'sent' | 'done' | 'pending'; remindAt: Date | null } {
  if (kind === 'once') return { status: 'sent', remindAt: null };
  if (sentCount >= REMINDER_DAILY_MAX_SENDS) return { status: 'done', remindAt: null };
  return { status: 'pending', remindAt: new Date(now + REMINDER_DAILY_MIN_INTERVAL_MS) };
}

export interface RecognizedNote {
  transcript: string;
  summary: string;
  suggestions: string[];
  unknowns: string[];
  candidates: string[];
  relativeDates: { original: string; interpretation: string }[];
  /** F07 per-page transcripts; page numbers must match saved pages exactly. */
  pages?: { pageNo: number; transcript: string }[];
  doubts?: DoubtSpec[];
  diagrams?: DiagramSpec[];
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Magic-byte sniffing decides the real media type; extensions are hints only. */
export function detectImageMediaType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export function extensionOf(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

/**
 * Pixel crop box from a normalized region against the page's intrinsic
 * dimensions, clamped to the raster and to a workable minimum; the returned
 * certainty records whether anything had to be adjusted (P30 坐标变换).
 */
export function cropBox(region: Region, width: number, height: number): { box: { left: number; top: number; width: number; height: number }; certainty: 'reliable' | 'estimated' } {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const w = Math.min(1 - x, clamp01(region.w));
  const h = Math.min(1 - y, clamp01(region.h));
  let left = Math.round(x * width);
  let top = Math.round(y * height);
  let cw = Math.max(1, Math.round(w * width));
  let ch = Math.max(1, Math.round(h * height));
  let estimated = x !== region.x || y !== region.y || w !== region.w || h !== region.h;
  // Keep a workable minimum so a tiny/uncertain region still yields a legible crop.
  if (cw < 16) {
    const grown = Math.min(16, width);
    left = Math.max(0, Math.min(left - Math.floor((grown - cw) / 2), width - grown));
    cw = grown;
    estimated = true;
  }
  if (ch < 16) {
    const grown = Math.min(16, height);
    top = Math.max(0, Math.min(top - Math.floor((grown - ch) / 2), height - grown));
    ch = grown;
    estimated = true;
  }
  if (left + cw > width) {
    left = Math.max(0, width - cw);
    estimated = true;
  }
  if (top + ch > height) {
    top = Math.max(0, height - ch);
    estimated = true;
  }
  return { box: { left, top, width: cw, height: ch }, certainty: estimated ? 'estimated' : 'reliable' };
}

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function systemLine(statusText: string): string {
  return `${SYSTEM_BLOCK_PREFIX}审核状态：${statusText}`;
}

export function pendingReviewLine(noteId: string, version: number): string {
  return systemLine(`待本人审核 ${noteId} v${version}（尚未经人工审核）`);
}

export function regionText(region: Region): string {
  return `区域 x${region.x.toFixed(3)} y${region.y.toFixed(3)} w${region.w.toFixed(3)} h${region.h.toFixed(3)}`;
}

/** Build the note document XML (registered template; multi-page since F07). */
export function noteDocumentXml(
  noteId: string,
  version: number,
  recognized: RecognizedNote,
  pageInfos: { pageNo: number; sha256: string; mediaType: string; byteSize: number; sourceType: string }[],
): string {
  const status = pendingReviewLine(noteId, version);
  const lines = (items: string[], tag = 'p') => items.map(item => `<${tag}>${xml(item)}</${tag}>`).join('\n');
  const pages = recognized.pages?.length
    ? recognized.pages
        .map(p => `<h2>第 ${p.pageNo} 页 转写</h2>\n<p>${xml(p.transcript)}</p>`)
        .join('\n')
    : `<h2>第 ${pageInfos[0]?.pageNo ?? 1} 页 转写</h2>\n<p>${xml(recognized.transcript)}</p>`;
  // Crop ids number regioned entries only (doubts first, then diagrams), the
  // same rule generateCrops uses, so document citations match stored crops.
  let cropNo = 0;
  const nextCropId = () => `C${(cropNo += 1)}`;
  const CERTAINTY_LABELS: Record<DoubtSpec['certainty'], string> = { reliable: '可靠', estimated: '估计', page: '页级' };
  const doubts = (recognized.doubts ?? []).map(doubt => {
    const kind = DOUBT_KIND_LABELS[doubt.kind as DoubtKind] ?? String(doubt.kind);
    const where = doubt.region
      ? `${regionText(doubt.region)}（${CERTAINTY_LABELS[doubt.certainty] ?? doubt.certainty}，裁片 ${nextCropId()}）`
      : `整页引用（${CERTAINTY_LABELS[doubt.certainty] ?? doubt.certainty}）`;
    return `<li>第 ${doubt.pageNo} 页【${kind}】“${xml(doubt.quote)}”${doubt.note ? `；${xml(doubt.note)}` : ''}；${where}</li>`;
  });
  const diagrams = (recognized.diagrams ?? []).map(diagram => {
    const where = diagram.region ? `${regionText(diagram.region)}（裁片 ${nextCropId()}）` : '见该页原图';
    return `<li>第 ${diagram.pageNo} 页 图示：${xml(diagram.description)}；${where}（保留原图，不做矢量重绘）</li>`;
  });
  const relative = recognized.relativeDates.length
    ? `<h1>相对日期依据</h1>\n${recognized.relativeDates.map(r => `<p>原话：${xml(r.original)}；解释：${xml(r.interpretation)}（以上传日期为准解释，保留原话）</p>`).join('\n')}`
    : '';
  return `<title>${xml(`[24PA] 手写笔记 ${noteId} v${version}`)}</title>
<p>${xml(status)}</p>
<h1>整理摘要</h1>
<p>${xml(recognized.summary)}</p>
<h1>整理正文</h1>
<p>${xml(recognized.transcript)}</p>
<h1>候选行动（未授权执行）</h1>
${recognized.candidates.length ? lines(recognized.candidates, 'li') : '<p>（无）</p>'}
<h1>疑点与定位（重点复核：数字/人名/缩写/日期/否定/勾选/不清）</h1>
${doubts.length ? doubts.join('\n') : (recognized.unknowns.length ? lines(recognized.unknowns, 'li') : '<p>（无）</p>')}
${recognized.unknowns.length && doubts.length ? `<h2>其余未知项</h2>\n${lines(recognized.unknowns, 'li')}` : ''}
<h1>图示说明</h1>
${diagrams.length ? diagrams.join('\n') : '<p>（无）</p>'}
<h1>AI 建议（推断，非原文）</h1>
${recognized.suggestions.length ? lines(recognized.suggestions, 'li') : '<p>（无）</p>'}
${relative}
<h1>逐页转写</h1>
${pages}
<h1>原稿索引</h1>
${pageInfos.map(p => `<p>第 ${p.pageNo} 页：${p.mediaType}，${p.byteSize} 字节，sha256 ${p.sha256.slice(0, 16)}…，${p.sourceType === 'file' ? '文件原图' : '平台图片（可能已压缩）'}（原件已保存，识别内容为派生副本）</p>`).join('\n')}
<h1>发布说明</h1>
<p>本候选版本尚未经人工审核；批准/退回请使用24私助发送的审核卡按钮，按钮仅对本版本内容指纹有效。模型自报的置信度不作为概率使用；无法辨认的内容保持未知。</p>`;
}

/**
 * Normalize fetched document XML to fingerprint-safe text: block texts in
 * document order, image blocks as position markers, registered system lines
 * excluded. Provider-issued ids and remote tokens never enter the value, so
 * equivalent content yields the same fingerprint across fetches (P31).
 */
export function normalizeDocument(docXml: string): string {
  const withoutTitle = docXml.replace(/<title>[\s\S]*?<\/title>/g, '');
  const segments = withoutTitle.split(/<\/?(?:p|h1|h2|li|img|table|tr|td|th|ul|ol)\b[^>]*>/);
  const lines: string[] = [];
  for (const segment of segments) {
    const text = segment
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (text.startsWith(SYSTEM_BLOCK_PREFIX)) continue;
    lines.push(text);
  }
  const imageCount = (withoutTitle.match(/<img\b/g) ?? []).length;
  lines.push(`[图片 x${imageCount}]`);
  return lines.join('\n');
}

/** Fingerprint covers normalized body text plus original and crop resource hashes (P31/P30). */
export function fingerprintOf(normalizedText: string, pageSha256s: readonly string[], cropSha256s: readonly string[] = []): string {
  return sha256Hex(`${normalizedText}\n#原稿\n${pageSha256s.join('\n')}\n#裁片\n${cropSha256s.join('\n')}`);
}

export interface NoteDiff {
  added: string[];
  removed: string[];
}

export function diffNormalized(oldText: string, newText: string): NoteDiff {
  const count = (lines: string[]) => {
    const map = new Map<string, number>();
    for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const oldMap = count(oldText.split('\n'));
  const newMap = count(newText.split('\n'));
  const added: string[] = [];
  const removed: string[] = [];
  for (const [line, n] of newMap) {
    const delta = n - (oldMap.get(line) ?? 0);
    for (let i = 0; i < delta; i++) added.push(line);
  }
  for (const [line, n] of oldMap) {
    const delta = n - (newMap.get(line) ?? 0);
    for (let i = 0; i < delta; i++) removed.push(line);
  }
  return { added, removed };
}

export function newReviewToken(): string {
  return randomBytes(24).toString('hex');
}

/** Feishu interactive card for a pending review version (P31). */
export function reviewCard(noteId: string, version: number, docUrl: string | null, summary: string, fingerprintStart: string, approveToken: string, returnToken: string): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**手写笔记 ${noteId} 待审版本 v${version}**\n摘要：${summary}\n内容指纹：${fingerprintStart}…\n请先打开文档核对完整正文、疑点定位与原稿，再批准这一具体版本；按钮仅对本版本指纹有效。`,
      },
    },
  ];
  if (docUrl) {
    elements.push({
      tag: 'action',
      actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开待审文档' }, type: 'default', url: docUrl, value: { pa24: 'noop' } }],
    });
  }
  elements.push({
    tag: 'action',
    actions: [
      { tag: 'button', text: { tag: 'plain_text', content: `批准 v${version}` }, type: 'primary', value: { pa24: 'review', token: approveToken } },
      { tag: 'button', text: { tag: 'plain_text', content: '退回修改' }, type: 'danger', value: { pa24: 'review', token: returnToken } },
    ],
  });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `24私助手写审核 ${noteId} v${version}` }, template: 'orange' },
    elements,
  };
}
