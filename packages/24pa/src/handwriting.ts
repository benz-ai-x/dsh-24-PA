import { createHash, randomBytes } from 'node:crypto';

// F06 handwriting pure helpers: note document template, review fingerprints,
// line diffs and the review card payload. The registered system-status marker
// is excluded from fingerprints so refreshing the status block itself never
// invalidates a review (P32).

export const SYSTEM_BLOCK_PREFIX = '【24PA·系统】';
export const NOTE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES_PER_NOTE = 50;
export const REVIEW_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

export interface RecognizedNote {
  transcript: string;
  summary: string;
  suggestions: string[];
  unknowns: string[];
  candidates: string[];
  relativeDates: { original: string; interpretation: string }[];
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

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function systemLine(statusText: string): string {
  return `${SYSTEM_BLOCK_PREFIX}审核状态：${statusText}`;
}

export function pendingReviewLine(noteId: string, version: number): string {
  return systemLine(`待本人审核 ${noteId} v${version}（尚未经人工审核）`);
}

/** Build the note document XML (registered template, v1 content). */
export function noteDocumentXml(noteId: string, version: number, recognized: RecognizedNote, pageInfos: { pageNo: number; sha256: string; mediaType: string; byteSize: number }[]): string {
  const status = pendingReviewLine(noteId, version);
  const lines = (items: string[], tag = 'p') => items.map(item => `<${tag}>${xml(item)}</${tag}>`).join('\n');
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
<h1>疑点与未知（须解决或明确保留）</h1>
${recognized.unknowns.length ? lines(recognized.unknowns, 'li') : '<p>（无）</p>'}
<h1>AI 建议（推断，非原文）</h1>
${recognized.suggestions.length ? lines(recognized.suggestions, 'li') : '<p>（无）</p>'}
${relative}
<h1>原稿索引</h1>
${pageInfos.map(p => `<p>第 ${p.pageNo} 页：${p.mediaType}，${p.byteSize} 字节，sha256 ${p.sha256.slice(0, 16)}…（原件已保存，识别内容为派生副本）</p>`).join('\n')}`;
}

/**
 * Normalize fetched document XML to fingerprint-safe text: block texts in
 * document order, image blocks as position markers, registered system lines
 * excluded. Provider-issued ids and remote tokens never enter the value, so
 * equivalent content yields the same fingerprint across fetches (P31).
 */
export function normalizeDocument(docXml: string): string {
  const withoutTitle = docXml.replace(/<title>[\s\S]*?<\/title>/g, '');
  const blockMatches = withoutTitle.match(/<(p|h1|h2|li|img|table|ul|ol)\b[^>]*\/?>/g) ?? [];
  const lines: string[] = [];
  // Split on block-level tags keeps text order; strip all remaining tags per segment.
  const segments = withoutTitle.split(/<\/?(?:p|h1|h2|li|img|table|tr|td|th|ul|ol)\b[^>]*>/);
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
  const imageCount = blockMatches.filter(tag => tag.startsWith('<img')).length;
  lines.push(`[图片 x${imageCount}]`);
  return lines.join('\n');
}

/** Fingerprint covers normalized body text plus the original-resource hashes (P31). */
export function fingerprintOf(normalizedText: string, pageSha256s: readonly string[]): string {
  return sha256Hex(`${normalizedText}\n#原稿\n${pageSha256s.join('\n')}`);
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
        content: `**手写笔记 ${noteId} 待审版本 v${version}**\n摘要：${summary}\n内容指纹：${fingerprintStart}…\n请先打开文档核对完整正文与原稿，再批准这一具体版本；按钮仅对本版本指纹有效。`,
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
