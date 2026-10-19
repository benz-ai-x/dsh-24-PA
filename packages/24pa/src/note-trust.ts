import { runLarkCli } from './lark.js';
import { fingerprintOf, normalizeDocument } from './handwriting.js';
import type { NoteRepo, NoteVersionRow } from './repo.js';

/** Internal document seam: production CLI and deterministic test adapter. */
export interface NoteDocumentReader {
  read(docId: string): Promise<{ content: string; revision: string | null }>;
}

export class LarkNoteDocumentReader implements NoteDocumentReader {
  constructor(private readonly options: () => Parameters<typeof runLarkCli>[0]) {}

  async read(docId: string): Promise<{ content: string; revision: string | null }> {
    const result = await runLarkCli(this.options(), ['docs', '+fetch', '--as', 'user', '--doc', docId, '--doc-format', 'xml', '--detail', 'full']);
    const document = result.data?.document;
    if (typeof document?.content !== 'string' || !document.content.trim()) throw new Error('文档回读不完整，不能作为待审内容。');
    return { content: document.content, revision: document.revision_id != null ? String(document.revision_id) : null };
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
      if (!pages.length) throw new Error('原稿依据缺失，不能核验完整版本。');
      const crops = Array.isArray(version.content?.crops) ? version.content.crops : [];
      const readback = await this.reader.read(version.doc_id);
      if (!readback.content.trim()) throw new Error('文档回读为空，不能核验完整版本。');
      fingerprint = fingerprintOf(normalizeDocument(readback.content), pages.map(page => page.sha256), crops.map((crop: { sha256: string }) => crop.sha256));
      // A new candidate or changed decision may arrive while remote I/O runs.
      latest = await notes.latestVersion(noteId);
      version = await notes.getVersion(version.id);
      if (!version || version.note_id !== noteId) throw new Error('核验期间版本记录已变化。');
      if (latest?.id !== version.id) return changed('核验期间已发布新版本，历史批准不覆盖当前版本。');
      if (version.status === 'superseded' || version.status === 'stale') return changed('核验期间版本已失效。');
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
