// Handwriting note pipeline (F29): the whole submit→crops→transcribe→publish
// →review-card→process→verify→republish flow behind one deep module. The
// runtime keeps only worker-role bindings and the scheduling ticks; every
// domain concept (原稿/待审版本/人工审核凭证) lives here. See GLOSSARY.

import { randomUUID } from 'node:crypto';
import { parseNoteDocument, registeredStatus, documentText } from './note-document.js';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DshAgent } from './host.js';
import { noteParentToken, type PaConfig } from './config.js';
import type { ChannelContextDeps } from './channel-deps.js';
import { runLarkCli } from './lark.js';
import { cliOptions, type FeishuTransport, type InboundEvent } from './feishu.js';
import {
  candidateUnknowns, extensionOf, fingerprintOf, normalizeDocument, diffNormalized, sha256Hex,
  cropBox, noteDocumentXml, newReviewToken, reviewCard, systemLine, pendingReviewLine,
  detectImageMediaType, MAX_PAGE_BYTES, MAX_PAGES_PER_NOTE, REVIEW_TOKEN_TTL_MS,
  type CropSpec, type DoubtSpec, type DiagramSpec, type RecognizedNote, type Region,
} from './handwriting.js';
import type { PaDb } from './db.js';
import type { Repos, NoteRow, NotePageRow, NoteVersionRow, WorkItemRow, ActionOperationRow, ReviewReminderRow } from './repo.js';
import { text, nowIso, isoDate, hash } from './util.js';
import type { RuntimeRole } from './runtime.js';
import { LarkNoteDocumentReader, TrustedNotes, type NoteDocumentReader, type NoteTrustResult, type NoteDocumentSnapshot } from './note-trust.js';

export interface HandwritingDeps extends ChannelContextDeps {
  /** F44：工作流口径参数（handwriting-review-flow 的 frontmatter params）。 */
  skillParams(name: string): Promise<Record<string, unknown>>;
  transport(): FeishuTransport | null;
  assertLive(context: string): void;
  trackWorkItem(item: WorkItemRow): void;
  roleFor(agent: DshAgent | undefined): RuntimeRole;
  reviewQueue(): Promise<unknown>;
  usage: { modelRequests: number; notePagesInput: number; noteCrops: number };
  dbRef(): PaDb;
}

export class HandwritingPipeline {
  private readonly reader: NoteDocumentReader;
  private readonly trust: TrustedNotes;

  constructor(private readonly deps: HandwritingDeps, reader?: NoteDocumentReader) {
    this.reader = reader ?? new LarkNoteDocumentReader(() => this.cli());
    this.trust = new TrustedNotes(() => this.deps.repos().notes, this.reader);
  }

  private readonly pending = new Map<string, Promise<unknown>>();
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    this.pending.set(key, next);
    void next.finally(() => { if (this.pending.get(key) === next) this.pending.delete(key); }).catch(() => {});
    return next;
  }

  inspectTrust(noteId: string, versionId?: string): Promise<NoteTrustResult> {
    return this.trust.inspect(noteId, versionId);
  }

  /** CLI invocation options resolved once per call (config may reload). */
  private cli() {
    return cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs);
  }

  private async externalWrite<T>(item: WorkItemRow, id: string, kind: string, params: Record<string, unknown>, invoke: () => Promise<T>): Promise<T> {
    const staged = await this.deps.stagedOperationWithId(id, item, kind, params);
    if (!staged.created && staged.row.status === 'succeeded') return staged.row.receipt?.result as T;
    try {
      const result = await this.deps.performExternal(id, invoke);
      await this.deps.repos().operations.update(id, { status: 'succeeded', receipt: { result } });
      return result;
    } catch (error) {
      await this.deps.failStaged(id, error);
      throw error;
    }
  }

  // ---- handwriting notes (F06) ----------------------------------------------

  isImageFileMessage(event: InboundEvent): boolean {
    if (event.messageType !== 'file') return false;
    return /\.(jpe?g|png|webp)$/i.test(String(event.fileName ?? ''));
  }

  /**
   * Collect one inbound photo/file as a note page (P28): durable original
   * bytes + hash under the workspace, page order tracked in PG, owner ack
   * message routed back to the note so replies append pages to it.
   */
  collectNotePage(inboxEventId: string, event: InboundEvent, noteId: string | null): Promise<void> {
    return this.serial(`message:${event.messageId ?? event.eventId}`, () =>
      noteId ? this.serial(`note:${noteId}`, () => this.collectPage(inboxEventId, event, noteId)) : this.collectPage(inboxEventId, event, noteId));
  }

  private async acknowledgePage(inboxEventId: string, page: NotePageRow): Promise<void> {
    await this.deps.notifyOwner(`noteack:${page.note_id}:p${page.page_no}:${page.message_id}`,
      `已收到笔记 ${page.note_id} 第 ${page.page_no} 页原稿（${page.media_type}，${page.byte_size} 字节，sha256 ${page.sha256.slice(0, 16)}…，${page.source_type === 'file' ? '文件原图' : '平台图片，可能已压缩'}）。收集中可回复本条消息追加图片；整理识别请回复“整理这份笔记”，或说“结束这批笔记”。`);
    await this.deps.repos().inbox.mark(inboxEventId, { status: 'delivered', requestId: `note:${page.note_id}:p${page.page_no}` });
  }

  private async collectPage(inboxEventId: string, event: InboundEvent, noteId: string | null): Promise<void> {
    const config = this.deps.config();
    if (config.mode !== 'feishu' || !this.deps.transport()) {
      await this.deps.notifyOwner(`noteinfo:${event.eventId}`, '手写笔记收集需要 feishu 模式与已启动的飞书连接。');
      await this.deps.repos().inbox.mark(inboxEventId, { status: 'rejected', error: '手写收集未启用' });
      return;
    }
    // (kept inline: this branch reports to the owner instead of throwing)
    const resourceKey = event.imageKey || event.fileKey || '';
    const resourceType: 'image' | 'file' = event.messageType === 'image' ? 'image' : 'file';
    if (!resourceKey || !event.messageId) {
      await this.deps.notifyOwner(`noteinfo:${event.eventId}`, '这条消息缺少可下载的图片资源；请重新发送照片或图片文件。');
      await this.deps.repos().inbox.mark(inboxEventId, { status: 'rejected', error: '缺少图片资源' });
      return;
    }
    const rejectPage = async (note: NoteRow, pageNo: number, reason: string, notifyText: string) => {
      await this.deps.repos().notes.insertPage({
        note_id: note.id,
        page_no: pageNo,
        message_id: String(event.messageId),
        image_key: resourceKey,
        media_type: 'unknown',
        byte_size: 0,
        sha256: '',
        storage_path: '',
        source_type: resourceType,
        quality: reason,
        status: 'rejected',
      });
      await this.deps.notifyOwner(`noteinfo:${event.eventId}`, notifyText);
      await this.deps.repos().inbox.mark(inboxEventId, { status: 'rejected', error: reason });
    };
    let savedPage: NotePageRow | null = null;
    try {
      savedPage = await this.deps.repos().notes.savedPageForMessage(event.messageId);
      if (savedPage) { await this.acknowledgePage(inboxEventId, savedPage); return; }
      if (noteId) {
        const current = await this.deps.repos().notes.getNote(noteId);
        if (current && current.status !== 'collecting') {
          await this.deps.notifyOwner(`noteinfo:${event.eventId}`, `笔记 ${noteId} 的批次已结束，不再追加页；如需补充请发新笔记。`);
          await this.deps.repos().inbox.mark(inboxEventId, { status: 'rejected', error: '批次已结束' });
          return;
        }
      }
      const bytes = await this.deps.transport()!.downloadImage(event.messageId, resourceKey, resourceType);
      const mediaType = detectImageMediaType(bytes);
      const pages = noteId ? await this.deps.repos().notes.pagesOf(noteId) : [];
      const savedCount = pages.filter(p => p.status === 'saved').length;
      const nextNo = pages.length + 1;
      let note: NoteRow;
      if (noteId) {
        const found = await this.deps.repos().notes.getNote(noteId);
        if (!found) {
          await this.deps.notifyOwner(`noteinfo:${event.eventId}`, '引用的笔记已不存在；请直接发送照片开始新笔记。');
          await this.deps.repos().inbox.mark(inboxEventId, { status: 'rejected', error: '引用笔记不存在' });
          return;
        }
        note = found;
      } else {
        const id = await this.deps.repos().notes.nextNoteId();
        note = await this.deps.repos().notes.insertNote({ id, title: `手写笔记 ${id}`, origin: 'feishu' });
      }
      if (!mediaType) {
        await rejectPage(note, nextNo, '无法识别的图片格式（需 JPEG/PNG/WebP）', `笔记 ${note.id} 第 ${nextNo} 页不是可识别的图片（需 JPEG/PNG/WebP 原图或图片文件），已记录为缺页；请重发该页。`);
        return;
      }
      if (bytes.length > MAX_PAGE_BYTES) {
        await rejectPage(note, nextNo, `图片超过 ${MAX_PAGE_BYTES} 字节上限`, `笔记 ${note.id} 第 ${nextNo} 页超过 10 MiB 上限；请发送压缩后的图片或改用文件发送。`);
        return;
      }
      if (savedCount >= MAX_PAGES_PER_NOTE) {
        await rejectPage(note, nextNo, `笔记页数超过 ${MAX_PAGES_PER_NOTE} 上限`, `笔记 ${note.id} 已达 ${MAX_PAGES_PER_NOTE} 页上限；请先整理当前批次，或另发新笔记。`);
        return;
      }
      const sha = sha256Hex(bytes);
      const duplicate = pages.find(p => p.status === 'saved' && p.sha256 === sha);
      if (duplicate) {
        await this.deps.notifyOwner(
          `noteinfo:${event.eventId}`,
          `这与笔记 ${note.id} 第 ${duplicate.page_no} 页是同一张原稿（sha256 ${sha.slice(0, 16)}…），未重复保存；如需替换该页请先说明。`,
        );
        await this.deps.repos().inbox.mark(inboxEventId, { status: 'duplicate', error: '重复页' });
        return;
      }
      const dir = join(this.deps.workspace()!.statePath, '.24pa', 'originals', note.id);
      await mkdir(dir, { recursive: true });
      const storagePath = join(dir, `p${nextNo}-${sha.slice(0, 12)}.${extensionOf(mediaType)}`);
      await (await import('node:fs/promises')).writeFile(storagePath, bytes, { mode: 0o600 });
      this.deps.usage.notePagesInput += 1;
      savedPage = (await this.deps.repos().notes.insertPage({
        note_id: note.id,
        page_no: nextNo,
        message_id: String(event.messageId),
        image_key: resourceKey,
        media_type: mediaType,
        byte_size: bytes.length,
        sha256: sha,
        storage_path: storagePath,
        source_type: resourceType,
        quality: null,
        status: 'saved',
      })).row;
      await this.acknowledgePage(inboxEventId, savedPage);
    } catch (error) {
      if (savedPage) {
        throw new Error(`原稿已保存为 ${savedPage.note_id} 第 ${savedPage.page_no} 页，但回执登记未完成：${(error as Error).message}；重试只补回执，不会重复保存。`);
      }
      // No page was committed; report the actual collection failure.
      await this.deps.notifyOwner(
        `noteinfo:${event.eventId}`,
        `原稿收集未完成（${(error as Error).message}）；笔记记录未保存该页，请重新发送这张图片。`,
      );
      await this.deps.repos().inbox.mark(inboxEventId, { status: 'rejected', error: `原稿下载失败：${(error as Error).message}` });
    }
  }

  /** Worker-side structured recognition result → publish the pending version (P29/P30). */
  async noteSubmit(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const note = await this.deps.repos().notes.noteByWorkItem(item.id);
    if (!note) throw new Error('本事项未绑定手写笔记；请核对 noteId。');
    return this.serial(`note:${note.id}`, () => this.submitNote(item, args));
  }

  private async submitNote(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const notes = this.deps.repos().notes;
    const note = await notes.noteByWorkItem(item.id);
    if (!note) throw new Error('本事项未绑定手写笔记；请核对 noteId。');
    const boundedStringList = (value: unknown, max: number, limit: number): string[] => {
      const list = Array.isArray(value) ? value.map(v => text(v, max)) : [];
      if (list.length > limit) throw new Error(`列表条目超过 ${limit} 条上限。`);
      return list;
    };
    const savedPages = (await notes.pagesOf(note.id)).filter(p => p.status === 'saved');
    const savedPageNos = new Set(savedPages.map(p => p.page_no));
    const region = (value: unknown): Region | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      const r = value as Record<string, unknown>;
      const parsed = { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) };
      if (Object.values(parsed).some(v => !Number.isFinite(v) || v < 0 || v > 1)) {
        throw new Error('疑点/图示区域必须是 0–1 的归一化坐标（x/y/w/h）。');
      }
      return parsed;
    };
    const pages = (Array.isArray(args.pages) ? args.pages : []).slice(0, MAX_PAGES_PER_NOTE).map((entry: Record<string, unknown>, index: number) => {
      const pageNo = Number(entry.pageNo);
      if (!Number.isInteger(pageNo) || !savedPageNos.has(pageNo)) {
        throw new Error(`逐页转写第 ${index + 1} 项的页号 ${String(entry.pageNo)} 不在已保存页中（已保存：${[...savedPageNos].sort((a, b) => a - b).join(', ')}）；缺页如实留空，不要臆造。`);
      }
      return { pageNo, transcript: text(entry.transcript, 20000) };
    });
    if (new Set(pages.map(p => p.pageNo)).size !== pages.length) throw new Error('逐页转写存在重复页号。');
    for (let i = 1; i < pages.length; i++) {
      if (pages[i]!.pageNo <= pages[i - 1]!.pageNo) throw new Error(`逐页转写必须按页号升序提交（第 ${i + 1} 项 ${pages[i]!.pageNo} ≤ 前项 ${pages[i - 1]!.pageNo}）；段落顺序以页序为准。`);
    }
    if (pages.length > 0 && pages.length !== savedPages.length) {
      throw new Error(`逐页转写需覆盖全部已保存页（已保存 ${savedPages.length} 页，收到 ${pages.length} 页）；缺失页请明确标注无法辨认。`);
    }
    const doubts: DoubtSpec[] = (Array.isArray(args.doubts) ? args.doubts : []).slice(0, 100).map((entry: Record<string, unknown>, index: number) => {
      const pageNo = Number(entry.pageNo);
      if (!savedPageNos.has(pageNo)) throw new Error(`疑点第 ${index + 1} 项引用了未保存的页号 ${String(entry.pageNo)}。`);
      const specifiedRegion = region(entry.region);
      return {
        pageNo,
        kind: String(entry.kind ?? 'unclear'),
        quote: text(entry.quote, 300),
        region: specifiedRegion,
        certainty: (specifiedRegion ? 'reliable' : 'page') as DoubtSpec['certainty'],
        note: entry.note ? text(entry.note, 300) : undefined,
      };
    });
    const diagrams: DiagramSpec[] = (Array.isArray(args.diagrams) ? args.diagrams : []).slice(0, 50).map((entry: Record<string, unknown>) => {
      const pageNo = Number(entry.pageNo);
      if (!savedPageNos.has(pageNo)) throw new Error(`图示引用了未保存的页号 ${String(entry.pageNo)}。`);
      return { pageNo, description: text(entry.description, 1000), region: region(entry.region) };
    });
    // Candidate actions keep their provenance: source quote and the raw date
    // phrase travel with the parsed summary into the version content (P34).
    const noteCandidates = (Array.isArray(args.candidates) ? args.candidates : []).slice(0, 50).map((entry: unknown) => {
      if (typeof entry === 'string') return { summary: text(entry, 500) };
      const record = entry as Record<string, unknown>;
      return {
        summary: text(String(record.summary ?? ''), 500),
        ...(record.sourceQuote ? { sourceQuote: text(record.sourceQuote, 300) } : {}),
        ...(record.due != null && record.due !== '' ? { due: String(record.due) } : {}),
        ...(record.start ? { start: String(record.start) } : {}),
        ...(record.end ? { end: String(record.end) } : {}),
        ...((Array.isArray(record.unknowns) && record.unknowns.length) || record.unknown ? { unknowns: boundedStringList([...(Array.isArray(record.unknowns) ? record.unknowns : []), ...(record.unknown ? [record.unknown] : [])], 300, 20) } : {}),
      };
    }).filter(c => c.summary);
    const unknowns = boundedStringList(args.unknowns, 500, 50);
    const recognized: RecognizedNote = {
      transcript: text(args.transcript, 20000),
      summary: text(args.summary ?? '（无摘要）', 2000),
      suggestions: boundedStringList(args.suggestions, 500, 50),
      unknowns,
      candidates: noteCandidates.map((candidate, index) => {
        const linked = candidateUnknowns(candidate, index, unknowns);
        return linked.length ? { ...candidate, unknowns: linked } : candidate;
      }),
      relativeDates: (Array.isArray(args.relativeDates) ? args.relativeDates : []).slice(0, 20).map((entry: Record<string, unknown>) => ({
        original: text(entry.original, 200),
        interpretation: text(entry.interpretation, 500),
      })),
      ...(pages.length ? { pages } : {}),
      ...(doubts.length ? { doubts } : {}),
      ...(diagrams.length ? { diagrams } : {}),
    };
    // Regioned doubts/diagrams become durable crops before publishing (P30).
    const crops = await this.generateCrops(note.id, savedPages, doubts, diagrams);
    return this.publishNoteVersion(item, note, recognized, null, crops);
  }

  /**
   * Produce zoom crops for regioned doubts/diagrams from the saved originals
   * (P30): normalized regions map through the page's intrinsic size with
   * clamping; each crop keeps its transform record and sha256.
   */
  private async generateCrops(noteId: string, pages: NotePageRow[], doubts: DoubtSpec[], diagrams: DiagramSpec[]): Promise<CropSpec[]> {
    const entries: { kind: 'doubt' | 'diagram'; pageNo: number; region: Region }[] = [];
    for (const doubt of doubts) if (doubt.region) entries.push({ kind: 'doubt', pageNo: doubt.pageNo, region: doubt.region });
    for (const diagram of diagrams) if (diagram.region) entries.push({ kind: 'diagram', pageNo: diagram.pageNo, region: diagram.region });
    if (entries.length === 0) return [];
    let sharp: any;
    try {
      sharp = (await import('sharp')).default;
    } catch (error) {
      throw new Error(`生成疑点裁片需要 sharp（${(error as Error).message}）；请先不带区域提交，区域定位随后补充。`);
    }
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(this.deps.workspace()!.statePath, '.24pa', 'crops', noteId);
    await mkdir(dir, { recursive: true });
    const crops: CropSpec[] = [];
    for (const [index, entry] of entries.entries()) {
      const page = pages.find(p => p.page_no === entry.pageNo);
      if (!page) continue;
      const meta = await sharp(page.storage_path).metadata();
      if (!meta.width || !meta.height) throw new Error(`无法读取第 ${entry.pageNo} 页原稿尺寸，不能生成裁片。`);
      const { box, certainty } = cropBox(entry.region, meta.width, meta.height);
      const png = await sharp(page.storage_path).extract(box).png().toBuffer();
      const sha = sha256Hex(png);
      const id = `C${index + 1}`;
      const path = join(dir, `p${entry.pageNo}-${id}-${sha.slice(0, 12)}.png`);
      await writeFile(path, png, { mode: 0o600 });
      crops.push({ id, pageNo: entry.pageNo, kind: entry.kind, region: entry.region, certainty, path, sha256: sha });
      this.deps.usage.noteCrops += 1;
      // Feed the real clamp verdict back: an adjusted region is published as
      // 估计, never 可靠 (P30 AC2).
      if (certainty === 'estimated' && entry.kind === 'doubt') {
        const target = doubts.find(d => d.pageNo === entry.pageNo && d.region === entry.region);
        if (target) target.certainty = 'estimated';
      }
    }
    return crops;
  }

  /**
   * Publish a pending review version. Stage-resumable: the created document id
   * is persisted on the staged operation before anything else can fail, so a
   * retry resumes from the read-back instead of creating a second document.
   * `republishFromDoc` (P32) skips creation and captures the current document
   * as the next candidate instead.
   */
  private async publishNoteVersion(
    item: WorkItemRow,
    note: NoteRow,
    recognized: RecognizedNote | null,
    republishFromDoc: { docId: string; docUrl: string | null; normalized: string; snapshot: string; revision: string | null; mediaHashes?: string[]; referenceMap?: Record<string, any> } | null,
    crops: CropSpec[] = [],
  ): Promise<unknown> {
    const notes = this.deps.repos().notes;
    const pages = (await notes.pagesOf(note.id)).filter(p => p.status === 'saved');
    if (pages.length === 0) throw new Error('这份笔记还没有已保存的原稿页。');
    this.deps.assertLive('手写笔记发布需要 feishu 模式与飞书连接');
    const visionRoute = this.deps.config().workerModels.handwriting;
    const paramsKey = republishFromDoc ? `republish:${republishFromDoc.docId}:${sha256Hex(republishFromDoc.normalized)}` : sha256Hex(JSON.stringify(recognized));
    // The aggregate only coordinates local stages; each remote write owns a
    // separate durable key and result, so partial media insertion is resumable.
    const operation = await notes.beginPublication({
      noteId: note.id,
      workItemId: item.id,
      contentKey: hash(JSON.stringify([note.id, paramsKey, pages.map(p => [p.page_no, p.sha256]), crops.map(c => c.sha256)])),
      legacyParamsKey: paramsKey,
      republish: !!republishFromDoc,
    });
    const version = Number(operation.params.version);
    const versionId = `${note.id}:v${version}`;
    const existing = await notes.getVersion(versionId);
    if (operation.status === 'succeeded') {
      return { noteId: note.id, version, versionId, reused: true, docUrl: existing?.doc_url ?? operation.receipt?.docUrl ?? null, message: '该版本此前已发布，未重复创建文档。' };
    }
    try {
      // A stored version is the read-back receipt. Finish only its local
      // projections even if the aggregate completion failed after insertion.
      if (existing) return await this.finishPublication(item, operation, existing);
      if (operation.status === 'unknown' || (operation.status === 'running' && !operation.receipt?.docId)) {
        throw Object.assign(new Error('先前发布结果未知；请先核对是否已生成待审文档，不会自动重试。'), { outcome: 'unknown' });
      }
      const latest = (await notes.versionsOf(note.id)).filter(row => row.version < version).at(-1) ?? null;
      let docId = (operation.receipt?.docId as string | undefined) ?? republishFromDoc?.docId ?? null;
      let docUrl = (operation.receipt?.docUrl as string | undefined) ?? republishFromDoc?.docUrl ?? null;
      if (!docId) {
        if (!recognized) throw new Error('发布新版本需要结构化识别结果。');
        const xmlBody = noteDocumentXml(note.id, version, recognized, pages.map(p => ({ pageNo: p.page_no, sha256: p.sha256, mediaType: p.media_type, byteSize: p.byte_size, sourceType: p.source_type })));
        // F22：待审文档同样落在知识库节点（wiki 优先、folder 回退）。
        const parentToken = noteParentToken(this.deps.config());
        const { data } = await this.externalWrite(item, `${operation.id}:create`, 'note.document.create', { noteId: note.id, version }, () => runLarkCli(this.cli(), [
          'docs', '+create', '--as', 'user', '--doc-format', 'xml', '--parent-token', parentToken, '--content', '-',
        ], xmlBody));
        const doc = data?.document;
        if (!doc?.document_id || !doc?.url) throw new Error('文档创建未返回标识；请先核对配置的目录或知识库，不要盲目重试。');
        docId = String(doc.document_id);
        docUrl = String(doc.url);
        await this.deps.repos().operations.update(operation.id, { status: 'running', receipt: { docId, docUrl, stage: 'created' } });
      }
      // Original images ride into the doc from the saved originals; a failure
      // here leaves the operation resumable at the read-back stage.
      const insertedMedia = operation.receipt?.mediaInserted === true;
      if (!republishFromDoc && !insertedMedia) {
        const mediaFiles = [...pages.map(p => p.storage_path), ...crops.map(c => c.path)];
        for (const [index, file] of mediaFiles.entries()) {
          await this.externalWrite(item, `${operation.id}:media:${index}`, 'note.document.media', { docId, index, file }, () => runLarkCli(this.cli(), [
            'docs', '+media-insert', '--as', 'user', '--doc', docId, '--type', 'image', '--file', file,
          ]));
        }
        await this.deps.repos().operations.update(operation.id, { status: 'running', receipt: { docId, docUrl, stage: 'media', mediaInserted: true } });
      }
      const readback: NoteDocumentSnapshot = republishFromDoc
        ? { content: republishFromDoc.snapshot, revision: republishFromDoc.revision, normalized: republishFromDoc.normalized, mediaHashes: republishFromDoc.mediaHashes, referenceMap: republishFromDoc.referenceMap }
        : await this.fetchNoteDocument(docId);
      // Resource completeness: every saved page's original and every crop must
      // be present in the read-back before the review link may go out (P29/P30).
      const imageCount = (readback.content.match(/<img\b/g) ?? []).length;
      if (imageCount < pages.length + crops.length) {
        throw new Error(`文档回读不完整：仅见到 ${imageCount} 张图片（应有 ${pages.length} 页原稿 + ${crops.length} 张裁片）；不发送待审链接，请核对文档。`);
      }
      if (readback.mediaHashes) {
        const available = [...readback.mediaHashes];
        for (const sha of [...pages.map(p => p.sha256), ...crops.map(c => c.sha256)]) {
          const index = available.indexOf(sha);
          if (index < 0) throw new Error('文档资源摘要未包含全部原稿/裁片，不能发布完整待审版本。');
          available.splice(index, 1);
        }
      }
      const normalized = readback.normalized ?? normalizeDocument(readback.content);
      const fingerprint = fingerprintOf(normalized, pages.map(p => p.sha256), crops.map(c => c.sha256));
      const snapshot = republishFromDoc?.snapshot ?? readback.content;
      const finalRecognized = republishFromDoc
        ? { transcript: '', summary: '', candidates: [], unknowns: [], derivedStatus: 'needs_rebuild', crops, republishedFromDoc: true, previousVersion: latest?.version ?? null }
        : { ...recognized, model: visionRoute ? { provider: visionRoute.provider, model: visionRoute.model } : null, crops };
      const published = await notes.insertVersion({
        id: versionId,
        note_id: note.id,
        version,
        doc_id: docId,
        doc_url: docUrl,
        doc_revision: readback.revision,
        fingerprint,
        normalized_text: normalized,
        content: { ...finalRecognized, documentResources: { hashes: readback.mediaHashes ?? [], references: readback.referenceMap ?? {} } },
        doc_snapshot: snapshot,
        status: 'pending_review',
      });
      return await this.finishPublication(item, operation, published);
    } catch (error) {
      await this.deps.failStaged(operation.id, error);
      throw error;
    }
  }

  private async finishPublication(item: WorkItemRow, operation: ActionOperationRow, published: NoteVersionRow): Promise<unknown> {
    const notes = this.deps.repos().notes;
    const { note_id: noteId, version, id: versionId, doc_id: docId, doc_url: docUrl, fingerprint, normalized_text: normalized } = published;
    const latest = (await notes.versionsOf(noteId)).filter(row => row.version < version).at(-1) ?? null;
    await notes.supersedeOlder(noteId, version);
    // A new candidate supersedes the old version: its nags must stop (P33).
    if (latest) {
      await this.deps.repos().reviewReminders.cancelForVersion(latest.id).catch(error => {
        console.warn(`[pa24] 取消旧版本催办失败（派发时会再核对版本状态）：${(error as Error).message}`);
      });
    }
    const current = await notes.latestVersion(noteId);
    if (current?.id === versionId && current.status === 'pending_review') await notes.updateNote(noteId, { status: 'awaiting_review' });
    await this.deps.repos().workItems.update(item.id, {
      result_ref: { operationId: operation.id, docId, docUrl, noteId, versionId },
    });
    if (current?.id === versionId && current.status === 'pending_review') {
      await this.synchronizeStatus(published, pendingReviewLine(noteId, version));
      await this.sendReviewCard(noteId, versionId);
    }
    // Revision impact (P34): objects created from older versions get a change
    // suggestion — never silent deletion or overwrite; one notice per new version.
    if (latest) {
      const affected = (await this.deps.repos().operations.succeededWithIdPrefix(`note.action:${noteId}:v%`).catch(() => [] as Array<{ id: string; params: any; status: string }>))
        .filter(op => !op.id.startsWith(`note.action:${noteId}:v${version}:`));
      if (affected.length > 0 && this.deps.config()?.ownerOpenId) {
        const diff = diffNormalized(String(latest.normalized_text ?? ''), normalized);
        const diffNote = diff.added.length || diff.removed.length
          ? `主要差异：新增 ${diff.added.length} 行${diff.added.length ? `（如「${diff.added[0]!.slice(0, 40)}」）` : ''}，删除 ${diff.removed.length} 行${diff.removed.length ? `（如「${diff.removed[0]!.slice(0, 40)}」）` : ''}。`
          : '两版本正文无文本差异（可能仅原稿/结构变化）。';
        await this.deps.notifyOwner(
          `noteimpact:${noteId}:v${version}`,
          `笔记 ${noteId} 已发布 v${version} 候选。${diffNote}此前按旧版本创建的 ${affected.length} 个行动对象可能需要调整：${affected.map(op => String(op.params?.summary ?? op.id)).join('、')}。是否修改由你决定，助理不会静默删除或覆盖。`,
        );
      }
    }
    await this.deps.repos().operations.update(operation.id, {
      status: 'succeeded', receipt: { docId, docUrl, versionId, fingerprint, revision: published.doc_revision },
    });
    return {
      noteId,
      version,
      versionId,
      docUrl,
      fingerprint,
      message: `已生成待审版本 v${version} 并回读确认；等待本人在飞书审核卡上批准或退回。`,
    };
  }

  private async fetchNoteDocument(docId: string): Promise<NoteDocumentSnapshot> {
    return this.reader.read(docId);
  }

  /** Enqueue the durable review card with opaque, server-verified tokens (P31). */
  private async sendReviewCard(noteId: string, versionId: string): Promise<void> {
    const notes = this.deps.repos().notes;
    const version = await notes.getVersion(versionId);
    if (!version) throw new Error('版本不存在，无法发送审核卡。');
    const existing = await notes.tokensOf(versionId);
    const usable = existing.filter(row => row.owner_open_id === this.deps.config().ownerOpenId && row.fingerprint === version.fingerprint && !row.used_at && !row.result && row.expires_at.getTime() > Date.now());
    let approveToken = usable.find(row => row.action === 'approve')?.token;
    let returnToken = usable.find(row => row.action === 'return')?.token;
    if (!approveToken || !returnToken) {
      approveToken = newReviewToken(); returnToken = newReviewToken();
      const expires = new Date(Date.now() + REVIEW_TOKEN_TTL_MS);
      await notes.insertToken({ token: approveToken, note_id: noteId, version_id: versionId, action: 'approve', owner_open_id: this.deps.config().ownerOpenId, fingerprint: version.fingerprint, expires_at: expires });
      await notes.insertToken({ token: returnToken, note_id: noteId, version_id: versionId, action: 'return', owner_open_id: this.deps.config().ownerOpenId, fingerprint: version.fingerprint, expires_at: expires });
    }
    const summary = String(version.content?.summary ?? '（见文档）');
    const flowParams = await this.deps.skillParams('handwriting-review-flow');
    const card = reviewCard(noteId, version.version, version.doc_url, summary, version.fingerprint.slice(0, 12), approveToken, returnToken,
      typeof flowParams.cardHeader === 'string' ? flowParams.cardHeader : undefined);
    await this.deps.repos().outbox.enqueue({
      dedupKey: `notereview:${noteId}:v${version.version}:${hash(approveToken)}`,
      channel: 'feishu',
      target: this.deps.config().ownerOpenId,
      kind: 'card',
      content: card,
    });
  }

  /**
   * Card click → server-side verification and transactional decision (P31).
   * The button only carries an opaque token; every binding is re-checked here.
   */
  async processReviewCard(inboxEventId: string, event: InboundEvent): Promise<void> {
    const token = await this.deps.repos().notes.getToken(String(event.cardAction?.value?.token ?? ''));
    return this.serial(`note:${token?.note_id ?? 'invalid'}`, () => this.reviewCard(inboxEventId, event));
  }

  private async reviewCard(inboxEventId: string, event: InboundEvent): Promise<void> {
    const value = (event.cardAction?.value ?? {}) as Record<string, unknown>;
    const finish = async (status: 'delivered' | 'rejected' | 'duplicate', error?: string, requestId?: string) => {
      await this.deps.repos().inbox.mark(inboxEventId, { status, error, requestId });
    };
    if (value.pa24 !== 'review' || !value.token) {
      await finish('rejected', '未支持的卡片动作');
      return;
    }
    const token = String(value.token);
    const notes = this.deps.repos().notes;
    const row = await notes.getToken(token);
    const notify = (text: string) => this.deps.notifyOwner(`review:${token.slice(0, 12)}:${inboxEventId}`, text);
    if (!row) {
      await notify('这个审核按钮不属于当前工作区或已失效；请以最新审核卡为准。');
      await finish('rejected', '未知审核令牌');
      return;
    }
    if (row.used_at || row.result) {
      await notify(`该按钮此前已处理：${typeof row.result?.message === 'string' ? row.result.message : '结果见此前通知'}；重复点击不产生新裁决。`);
      await finish('duplicate', '重复卡片动作');
      return;
    }
    if (row.expires_at.getTime() < Date.now()) {
      await notify('这个审核按钮已过期（7 天）；如需审核请要求重新发送审核卡。');
      await finish('rejected', '审核令牌过期');
      return;
    }
    if (this.deps.config().ownerOpenId && event.senderOpenId !== row.owner_open_id) {
      await notify('审核按钮只对绑定的主人有效；其他成员的操作已被拒绝。');
      await finish('rejected', '非主人操作');
      return;
    }
    const version = await notes.getVersion(row.version_id);
    if (!version || version.note_id !== row.note_id || version.status !== 'pending_review') {
      await notify(`该版本当前不是待审状态（${version?.status ?? '不存在'}）；请核对最新版本后操作。`);
      await finish('rejected', '版本状态不符');
      return;
    }
    // Re-verify the document matches the fingerprint this button was bound to.
    let trust: NoteTrustResult;
    try {
      trust = await this.inspectTrust(row.note_id, version.id);
      if (trust.contentValidity === 'unknown') throw new Error(trust.reason ?? '核验结果未知');
    } catch (error) {
      await notify(`暂时无法核验文档当前内容（${(error as Error).message}）；本次点击未产生裁决，请稍后再试。`);
      await finish('rejected', '文档核验失败（unknown）');
      return;
    }
    if (!trust.current || trust.contentValidity !== 'matches' || trust.fingerprint !== row.fingerprint) {
      if (trust.current) {
        await notes.updateVersion(version.id, { status: 'stale' });
        await notes.updateNote(row.note_id, { status: 'needs_rereview' });
      }
      await notify('文档内容与待审版本不一致（已修改），本按钮不能批准当前内容；旧批准只覆盖旧快照。可要求重新发布候选版本。');
      await finish('rejected', '内容已变化');
      return;
    }
    const decision = row.action === 'approve' ? 'approve' : 'return';
    const decisionId = `rvw-${randomUUID().slice(0, 16)}`;
    // Credential, statuses and the owner-notification intent commit together.
    let decided: boolean;
    try {
      decided = await this.deps.dbRef().withTransaction(client =>
        this.deps.repos().notes.decideVersion(client, {
          decisionId,
          noteId: row.note_id,
          versionId: row.version_id,
          versionStatus: decision === 'approve' ? 'approved' : 'returned',
          noteStatus: decision === 'approve' ? 'approved' : 'returned',
          decision,
          reviewerOpenId: event.senderOpenId,
          token,
          fingerprint: row.fingerprint,
          notifyDedupKey: `review:${token.slice(0, 12)}:${inboxEventId}`,
          notifyTarget: this.deps.config().ownerOpenId,
          notifyText: decision === 'approve'
            ? `已批准 ${row.note_id} v${version.version}（覆盖指纹 ${row.fingerprint.slice(0, 12)}…，审核人 ${event.senderOpenId}）。`
            : `已退回 ${row.note_id} v${version.version}；修改草稿后可要求重新发布候选版本。`,
        }),
      );
    } catch (error) {
      await notify(`本次审核未保存（${(error as Error).message}）；请核对当前版本后重试。`);
      await finish('rejected', '审核事务未完成');
      return;
    }
    if (!decided) {
      await notify('该按钮已被处理或失效，不产生重复裁决。');
      await finish('duplicate', '审核令牌未认领');
      return;
    }
    // Document status refresh runs after the ledger commit; a failure here
    // keeps the credential and reports "saved / syncing" (P32).
    let syncMessage: string;
    if (this.deps.config().mode === 'feishu') {
      await this.repairDecisionSync(row.note_id);
      const decisionRow = (await notes.decisionsOf(row.note_id)).find(saved => saved.id === decisionId);
      syncMessage = decisionRow?.doc_sync_status === 'synced' ? '文档审核状态已同步。'
        : `审核凭证已保存，但文档状态同步失败（${decisionRow?.doc_sync_error ?? '等待恢复'}）；标识同步中，可稍后重试核验。`;
    } else {
      syncMessage = 'demo 模式：凭证已入账本，未同步文档状态。';
    }
    const result = {
      decision,
      noteId: row.note_id,
      version: version.version,
      fingerprint: row.fingerprint,
      message:
        decision === 'approve'
          ? `已批准 ${row.note_id} v${version.version}（覆盖指纹 ${row.fingerprint.slice(0, 12)}…，审核人 ${event.senderOpenId}）。${syncMessage}`
          : `已退回 ${row.note_id} v${version.version}；修改草稿后可要求重新发布候选版本。${syncMessage}`,
    };
    await notes.markTokenResult(token, result);
    if (syncMessage) {
      // The decision itself was notified transactionally; only the sync status
      // needs a follow-up when it differs from the happy path. Distinct dedup
      // key so it is never swallowed by the decision notification.
      await this.deps.notifyOwner(`reviewsync:${token.slice(0, 12)}:${inboxEventId}`, `笔记 ${row.note_id} v${version.version}：${syncMessage}`);
    }
    await finish('delivered', undefined, `review:${decisionId}`);
  }

  private async synchronizeStatus(version: NoteVersionRow, line: string): Promise<void> {
    const notes = this.deps.repos().notes;
    if ((await notes.latestVersion(version.note_id))?.id !== version.id) return;
    if (!version.doc_id) throw new Error('版本缺少文档。');
    const before = await this.fetchNoteDocument(version.doc_id);
    const block = registeredStatus(parseNoteDocument(before.content));
    if (!block) throw new Error('未找到已登记的审核状态块，需修复文档状态后重试。');
    const oldLine = documentText(block);
    if (!oldLine.includes(` ${version.note_id} v`)) throw new Error('审核状态块不属于本笔记。');
    if (oldLine === line) return;
    if ((await notes.latestVersion(version.note_id))?.id !== version.id) return;
    await runLarkCli(this.cli(), ['docs', '+update', '--as', 'user', '--doc', version.doc_id,
      '--command', 'str_replace', '--pattern', oldLine, '--content', line]);
    const after = await this.fetchNoteDocument(version.doc_id);
    const fresh = registeredStatus(parseNoteDocument(after.content));
    if (!fresh || documentText(fresh) !== line) throw new Error('审核状态更新尚未读回确认。');
  }

  /**
   * Retry document status-block sync for decisions whose refresh failed: the
   * credential is durable, only the projection lags (P32 恢复).
   */
  private async repairDecisionSync(noteId: string): Promise<number> {
    const notes = this.deps.repos().notes;
    const failed = await notes.failedSyncDecisions(noteId);
    let repaired = 0;
    for (const decision of failed) {
      const version = await notes.getVersion(decision.version_id);
      if (!version?.doc_id) continue;
      if ((await notes.latestVersion(noteId))?.id !== version.id) {
        await notes.updateDecisionSync(decision.id, { docSyncStatus: 'superseded', error: '更新版本已接管文档状态，不再回写旧裁决。' });
        continue;
      }
      try {
        const newLine = decision.decision === 'approve'
          ? systemLine(`本人已审核 ${noteId} v${version.version}（${new Date(decision.decided_at).toISOString()}；覆盖指纹 ${decision.fingerprint.slice(0, 12)}…）`)
          : systemLine(`本人退回 ${noteId} v${version.version}（${new Date(decision.decided_at).toISOString()}）；修改后可要求重新发布候选`);
        await this.synchronizeStatus(version, newLine);
        await notes.updateDecisionSync(decision.id, { docSyncStatus: 'synced' });
        repaired += 1;
      } catch (error) {
        await notes.updateDecisionSync(decision.id, { docSyncStatus: 'failed', error: (error as Error).message });
      }
    }
    return repaired;
  }

  /** Bounded verification of a published version against the live document (P32). */
  verifyNote(noteId: string, options: { persist?: boolean } = {}): Promise<unknown> {
    return this.serial(`note:${noteId}`, () => this.verifyCurrentNote(noteId, options));
  }

  private async verifyCurrentNote(noteId: string, options: { persist?: boolean }): Promise<unknown> {
    const notes = this.deps.repos().notes;
    const note = await notes.getNote(noteId);
    if (!note) throw new Error('笔记不存在。');
    const latest = await notes.latestVersion(noteId);
    if (!latest) return { noteId, result: 'none', message: '这份笔记还没有已发布版本。' };
    let outcome: 'matches' | 'changed' | 'unknown';
    let fingerprint: string | null = null;
    let reason: string | null = null;
    let stillCurrent = true;
    try {
      const trust = await this.inspectTrust(noteId, latest.id);
      fingerprint = trust.fingerprint;
      outcome = trust.contentValidity;
      reason = trust.reason;
      stillCurrent = trust.current;
    } catch (error) {
      outcome = 'unknown';
      reason = (error as Error).message;
    }
    if (options.persist !== false) {
      await notes.updateVersion(latest.id, {
        verified_at: new Date(),
        verify_result: outcome,
        verify_fingerprint: fingerprint,
      });
    }
    let repaired = 0;
    if (outcome === 'changed' && stillCurrent) {
      if (latest.status !== 'stale') {
        await notes.updateVersion(latest.id, { status: 'stale' });
        await notes.updateNote(noteId, { status: 'needs_rereview' });
        await this.deps.notifyOwner(
          `notechange:${latest.id}`,
          `笔记 ${noteId} 的文档在发布 v${latest.version} 后被修改；待审/批准状态已标记需重新审核（旧批准仅覆盖旧快照）。可让助理“重新发布候选”。`,
        );
      }
    } else if (outcome === 'matches') {
      repaired = await this.repairDecisionSync(noteId);
    }
    return {
      noteId,
      latestVersion: latest.version,
      latestStatus: latest.status,
      result: outcome,
      ...(fingerprint ? { fingerprint } : {}),
      ...(reason ? { reason } : {}),
      ...(repaired > 0 ? { repairedDecisionSync: repaired } : {}),
      message:
        outcome === 'matches'
          ? `文档与 v${latest.version} 的指纹一致。${repaired > 0 ? `并补同步了 ${repaired} 条文档审核状态。` : ''}`
          : outcome === 'changed'
            ? `文档与 v${latest.version} 不一致（changed）；状态已转为需重新审核。`
            : `本次无法核验文档（${reason}）；不能据此宣称一致或已审。`,
    };
  }

  /** Refresh the candidate: current document content becomes v(n+1) (P32). */
  republishNote(item: WorkItemRow, noteId: string): Promise<unknown> {
    return this.serial(`note:${noteId}`, () => this.refreshCandidate(item, noteId));
  }

  private async refreshCandidate(item: WorkItemRow, noteId: string): Promise<unknown> {
    const notes = this.deps.repos().notes;
    const note = await notes.getNote(noteId);
    if (!note) throw new Error('笔记不存在。');
    const latest = await notes.latestVersion(noteId);
    if (!latest) throw new Error('这份笔记还没有已发布版本，无候选可刷新；请先识别整理。');
    const readback = await this.fetchNoteDocument(latest.doc_id!);
    const normalized = readback.normalized ?? normalizeDocument(readback.content);
    const carriedCrops = (Array.isArray(latest.content?.crops) ? latest.content.crops : []) as CropSpec[];
    if (normalized === latest.normalized_text) {
      const operation = await notes.unfinishedPublicationForVersion(noteId, latest.version);
      if (operation) return this.finishPublication(item, operation, latest);
      if (latest.status === 'pending_review') await this.sendReviewCard(noteId, latest.id);
      return { noteId, result: 'unchanged', message: `当前文档与 v${latest.version} 一致；仍待审时已确保可用审核卡，不新建内容版本。` };
    }
    const diff = diffNormalized(latest.normalized_text, normalized);
    const result = (await this.publishNoteVersion(item, note, null, {
      docId: latest.doc_id!,
      docUrl: latest.doc_url,
      normalized,
      snapshot: readback.content,
      revision: readback.revision,
      mediaHashes: readback.mediaHashes, referenceMap: readback.referenceMap,
    }, carriedCrops)) as Record<string, unknown>;
    return {
      ...result,
      diff: {
        addedLines: diff.added.length,
        removedLines: diff.removed.length,
        addedSamples: diff.added.slice(0, 5),
        removedSamples: diff.removed.slice(0, 5),
      },
      message: `已以当前文档内容发布 v${result.version} 待审候选（新增 ${diff.added.length} 行、删除 ${diff.removed.length} 行）；在本人批准前不继承旧结论。`,
    };
  }

  /** Lead-facing note inspection/control (pa24_notes). */
  async notesTool(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    const role = this.deps.roleFor(agent);
    if (role !== 'feishu-access' && role !== 'local-robot') throw new Error('笔记查询与核验由24私助会话负责。');
    const notes = this.deps.repos().notes;
    const action = String(args.action ?? 'list');
    const noteId = args.noteId ? String(args.noteId) : '';
    if (action === 'queue') {
      return this.deps.reviewQueue();
    }
    if (action === 'list') {
      const rows = await notes.listNotes(args.status ? String(args.status) : undefined, 20);
      const view = [];
      for (const row of rows) {
        const pages = await notes.pagesOf(row.id);
        const latest = await notes.latestVersion(row.id);
        view.push({
          noteId: row.id,
          title: row.title,
          status: row.status,
          pages: pages.length,
          savedPages: pages.filter(p => p.status === 'saved').length,
          latestVersion: latest ? { version: latest.version, status: latest.status, docUrl: latest.doc_url } : null,
        });
      }
      return { notes: view };
    }
    if (action === 'inspect') {
      if (!noteId) throw new Error('需要 noteId。');
      const note = await notes.getNote(noteId);
      if (!note) throw new Error('笔记不存在。');
      const pages = await notes.pagesOf(noteId);
      const versions = await notes.versionsOf(noteId);
      const decisions = await notes.decisionsOf(noteId);
      return {
        noteId: note.id,
        title: note.title,
        status: note.status,
        pages: pages.map(p => ({ pageNo: p.page_no, mediaType: p.media_type, bytes: p.byte_size, sha256: p.sha256.slice(0, 16) + '…', status: p.status, quality: p.quality })),
        versions: versions.map(v => ({ version: v.version, status: v.status, fingerprint: v.fingerprint.slice(0, 16) + '…', docUrl: v.doc_url, decidedAt: isoDate(v.decided_at) })),
        decisions: decisions.map(d => ({ decision: d.decision, versionId: d.version_id, reviewer: d.reviewer_open_id, decidedAt: isoDate(d.decided_at), docSync: d.doc_sync_status })),
      };
    }
    if (action === 'verify') {
      if (!noteId) throw new Error('需要 noteId。');
      return this.verifyNote(noteId);
    }
    if (action === 'finish') return this.serial(`note:${noteId}`, async () => {
      if (!noteId) throw new Error('需要 noteId。');
      const note = await notes.getNote(noteId);
      if (!note) throw new Error('笔记不存在。');
      if (note.status !== 'collecting') throw new Error(`该笔记不在收集阶段（${note.status}），无需结束批次。`);
      const pages = (await notes.pagesOf(noteId)).filter(p => p.status === 'saved');
      if (pages.length === 0) throw new Error('该笔记还没有已保存原稿，不能结束为可整理批次。');
      await notes.updateNote(noteId, { status: 'collected' });
      return { noteId, status: 'collected', pages: pages.length, message: `批次已结束（共 ${pages.length} 页）；现在可以委派 handwriting 整理，之后不再追加页。` };
    });
    if (action === 'remind') {
      if (!noteId) throw new Error('需要 noteId。');
      const latest = await notes.latestVersion(noteId);
      if (!latest || latest.status !== 'pending_review') {
        throw new Error(`笔记 ${noteId} 当前没有待审版本（${latest ? latest.status : '尚无版本'}），提醒绑定待审版本；请先发布候选。`);
      }
      const kind = args.kind === 'daily' ? 'daily' : 'once';
      let remindAt: Date;
      if (args.at) {
        remindAt = new Date(String(args.at));
        if (Number.isNaN(remindAt.getTime())) throw new Error('at 需为可解析的 ISO 时间。');
      } else {
        const seconds = Number(args.inSeconds ?? 0);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 24 * 3600) throw new Error('remind 需要 inSeconds（1 秒–365 天）或绝对时间 at。');
        remindAt = new Date(Date.now() + seconds * 1000);
      }
      const id = `nrm-${randomUUID().slice(0, 12)}`;
      await this.deps.repos().reviewReminders.insert({ id, noteId, versionId: latest.id, kind, remindAt, reason: args.reason ? text(args.reason, 300) : undefined });
      return { reminderId: id, noteId, versionId: latest.id, kind, remindAt: remindAt.toISOString(), message: `已为 ${noteId} v${latest.version} 设置审核提醒（${kind}）；版本完成审核后自动取消。` };
    }
    if (action === 'remind_control') {
      const op = String(args.op ?? '');
      const byId = args.reminderId ? String(args.reminderId) : '';
      let targets: ReviewReminderRow[];
      if (byId) {
        const row = await this.deps.repos().reviewReminders.get(byId);
        if (!row) throw new Error('提醒不存在。');
        targets = [row];
      } else {
        if (!noteId) throw new Error('需要 reminderId 或 noteId。');
        targets = await this.deps.repos().reviewReminders.activeForNote(noteId);
        if (targets.length === 0) throw new Error(`笔记 ${noteId} 没有在途提醒。`);
      }
      const results = [];
      for (const reminder of targets) {
        if (!['pending', 'paused'].includes(reminder.status)) {
          results.push({ id: reminder.id, status: reminder.status, message: '该提醒已结束，操作无效。' });
          continue;
        }
        if (op === 'snooze') {
          const seconds = Number(args.inSeconds ?? 0);
          if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7 * 24 * 3600) throw new Error('snooze 需要 inSeconds（1 秒–7 天）。');
          const next = new Date(Date.now() + seconds * 1000);
          await this.deps.repos().reviewReminders.update(reminder.id, { status: 'pending', remind_at: next });
          results.push({ id: reminder.id, status: 'pending', remindAt: next.toISOString(), message: `已稍后 ${seconds} 秒提醒（仍绑定原版本）。` });
        } else if (op === 'pause') {
          await this.deps.repos().reviewReminders.update(reminder.id, { status: 'paused' });
          results.push({ id: reminder.id, status: 'paused', message: '提醒已暂停；审核状态未变。' });
        } else if (op === 'resume') {
          await this.deps.repos().reviewReminders.update(reminder.id, { status: 'pending' });
          results.push({ id: reminder.id, status: 'pending', message: '提醒已恢复。' });
        } else if (op === 'cancel') {
          await this.deps.repos().reviewReminders.update(reminder.id, { status: 'canceled' });
          results.push({ id: reminder.id, status: 'canceled', message: '提醒已取消；审核状态未变。' });
        } else {
          throw new Error('未知提醒操作（snooze/pause/resume/cancel）。');
        }
      }
      return { results };
    }
    if (action === 'republish') {
      if (!noteId) throw new Error('需要 noteId。');
      // Each invocation has its own work item; the saved candidate owns any
      // unfinished publication that a later invocation needs to complete.
      const id = `pa24-work-notes-${randomUUID()}`;
      const republishItem = await this.deps.repos().workItems.insert({
        id,
        title: `刷新笔记候选 ${noteId}`,
        role: 'handwriting',
        instruction: `刷新 ${noteId} 的待审候选`,
        origin: agent.id === this.deps.accessSessionId() ? 'feishu' : 'local',
        parent_session_id: agent.id,
        child_session_id: id,
        delivery: agent.id === this.deps.accessSessionId() ? `feishu:${this.deps.config().ownerOpenId}` : `local:${agent.id}`,
        status: 'running',
      });
      this.deps.trackWorkItem(republishItem);
      try {
        const result = await this.republishNote(republishItem, noteId);
        await this.deps.repos().workItems.update(id, { status: 'completed', progress: '候选刷新完成' });
        return result;
      } catch (error) {
        await this.deps.repos().workItems.update(id, { status: 'failed', progress: `候选刷新未完成：${(error as Error).message}` });
        throw error;
      }
    }
    throw new Error('未知笔记操作。');
  }
}
