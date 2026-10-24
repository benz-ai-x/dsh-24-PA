import { runLarkCli } from './lark.js';
import { fingerprintOf, normalizeDocument } from './handwriting.js';
import type { NoteRepo, NoteVersionRow } from './repo.js';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalDocument, parseNoteDocument, type DocumentNode } from './note-document.js';
import { sha256Hex, detectImageMediaType, MAX_PAGE_BYTES } from './handwriting.js';

export interface NoteDocumentSnapshot {
  content: string;
  revision: string | null;
  normalized?: string;
  mediaHashes?: string[];
  referenceMap?: Record<string, any>;
}

/** Internal document seam: production CLI and deterministic test adapter. */
export interface NoteDocumentReader {
  read(docId: string): Promise<NoteDocumentSnapshot>;
}

export class LarkNoteDocumentReader implements NoteDocumentReader {
  constructor(private readonly options: () => Parameters<typeof runLarkCli>[0]) {}

  async read(docId: string): Promise<NoteDocumentSnapshot> {
    const result = await runLarkCli(this.options(), ['docs', '+fetch', '--as', 'user', '--doc', docId, '--doc-format', 'xml', '--detail', 'full']);
    const document = result.data?.document;
    if (typeof document?.content !== 'string' || !document.content.trim()) throw new Error('文档回读不完整，不能作为待审内容。');
    if (document.revision_id == null) throw new Error('文档缺少版本号，不能核验整稿。');
    const tree = parseNoteDocument(document.content), images: DocumentNode[] = [];
    const walk = (node: DocumentNode) => { if (node.name === 'img') images.push(node); for (const child of node.children) if (typeof child !== 'string') walk(child); };
    walk(tree);
    const referenceMap = document.reference_map ?? {}, mediaHashes: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), 'pa24-doc-media-'));
    try {
      for (const [index, image] of images.entries()) {
        const attributes = { ...image.attributes, ...(image.attributes.ref ? referenceMap.img?.[image.attributes.ref] : {}) };
        const token = attributes.token;
        if (typeof token !== 'string' || !token || attributes.url || attributes.src) throw new Error('图片没有可核验的飞书资源 token；外部图片当前无法形成完整快照。');
        const path = join(dir, `image-${index}.bin`);
        await runLarkCli(this.options(), ['docs', '+media-download', '--as', 'user', '--token', token, '--type', 'media', '--output', path]);
        if ((await stat(path)).size > MAX_PAGE_BYTES) throw new Error('图片资源超过单页核验上限。');
        const bytes = await readFile(path);
        if (!detectImageMediaType(bytes)) throw new Error('下载的图片资源格式无法核验。');
        mediaHashes.push(sha256Hex(bytes));
      }
      const confirmed = await runLarkCli(this.options(), ['docs', '+fetch', '--as', 'user', '--doc', docId, '--doc-format', 'xml', '--detail', 'full']);
      if (String(confirmed.data?.document?.revision_id) !== String(document.revision_id)) throw new Error('资源读取期间文档版本变化，本次整稿核验未完成。');
      return { content: document.content, revision: String(document.revision_id), referenceMap, mediaHashes, normalized: canonicalDocument(document.content, mediaHashes) };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
}

export interface NoteTrustResult {
  version: NoteVersionRow;
  current: boolean;
  contentValidity: 'matches' | 'changed' | 'unknown';
  currentValidity: 'matches' | 'changed' | 'unknown' | 'unreviewed';
  fingerprint: string | null;
  reason: string | null;
}

/** Current version + exact content + approval are one business decision.
 * Content approval does not authorize executing any candidate action. */
export class TrustedNotes {
  constructor(private readonly notes: () => NoteRepo, private readonly reader: NoteDocumentReader) {}

  async inspect(noteId: string, versionId?: string): Promise<NoteTrustResult> {
    const notes = this.notes();
    let latest = await notes.latestVersion(noteId);
    let version = versionId ? await notes.getVersion(versionId) : latest;
    if (!version || version.note_id !== noteId) throw new Error('版本不存在或不属于该笔记。');
    const changed = (reason: string): NoteTrustResult => ({ version: version!, current: latest?.id === version!.id, contentValidity: 'changed', currentValidity: 'changed', fingerprint: null, reason });
    if (latest?.id !== version.id) return changed('该版本已被新版本取代，历史批准不覆盖当前版本。');
    if (version.status === 'superseded' || version.status === 'stale') return changed('该版本已标记为失效，需要重新发布和审核。');
    let fingerprint: string;
    try {
      if (!version.doc_id) throw new Error('版本缺少可核验的文档标识。');
      const pages = (await notes.pagesOf(noteId)).filter(page => page.status === 'saved');
      const material = await notes.material(noteId);
      if (!pages.length && !(version.content?.materialSource?.kind === 'qwennote' && material?.source.kind === 'qwennote' && material.source.digest === version.content.materialSource.digest)) throw new Error('原稿依据缺失，不能核验完整版本。');
      if (material && ((version.content?.materialRevision && material.revision !== version.content.materialRevision) || (!version.content?.materialRevision && material.edited_by !== 'recognition'))) return changed('草稿在发布后已修改；旧审核不覆盖新草稿，请单独发布并审核。');
      const originals = Array.isArray(version.content?.originals) ? version.content.originals : pages.map(page => ({ pageNo: page.page_no, sha256: page.sha256 }));
      if (originals.some((original: { pageNo: number; sha256: string }) => !pages.some(page => page.page_no === original.pageNo && page.sha256 === original.sha256))) return changed('保存的原稿依据已变化。');
      const crops = Array.isArray(version.content?.crops) ? version.content.crops : [];
      const readback = await this.reader.read(version.doc_id);
      if (!readback.content.trim()) throw new Error('文档回读为空，不能核验完整版本。');
      fingerprint = fingerprintOf(readback.normalized ?? normalizeDocument(readback.content), originals.map((original: { sha256: string }) => original.sha256), crops.map((crop: { sha256: string }) => crop.sha256));
      // A new candidate or changed decision may arrive while remote I/O runs.
      latest = await notes.latestVersion(noteId);
      version = await notes.getVersion(version.id);
      if (!version || version.note_id !== noteId) throw new Error('核验期间版本记录已变化。');
      if (latest?.id !== version.id) return changed('核验期间已发布新版本，历史批准不覆盖当前版本。');
      if (version.status === 'superseded' || version.status === 'stale') return changed('核验期间版本已失效。');
      const currentMaterial = await notes.material(noteId);
      if (material && currentMaterial?.revision !== material.revision) return changed('核验期间草稿已变化。');
    } catch (error) {
      if (!version) throw error;
      return { version, current: latest?.id === version.id, contentValidity: 'unknown', currentValidity: 'unknown', fingerprint: null, reason: (error as Error).message };
    }
    const contentValidity = fingerprint === version.fingerprint ? 'matches' : 'changed';
    return {
      version,
      current: true,
      contentValidity,
      currentValidity: contentValidity === 'changed' ? 'changed' : version.status === 'approved' ? 'matches' : 'unreviewed',
      fingerprint,
      reason: contentValidity === 'changed' ? '文档内容与已发布版本不一致（已修改）。' : null,
    };
  }
}
