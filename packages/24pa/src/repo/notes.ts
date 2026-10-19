// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb, PaQueryer } from '../db.js';
import type { ActionOperationRow } from './work.js';
import { hash } from '../util.js';

export type NoteStatus = 'collecting' | 'awaiting_review' | 'approved' | 'returned' | 'needs_rereview';
export type NoteVersionStatus = 'pending_review' | 'approved' | 'returned' | 'stale' | 'superseded';

export interface NoteRow {
  id: string;
  title: string;
  status: NoteStatus | string;
  origin: string;
  work_item_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotePageRow {
  id: string;
  note_id: string;
  page_no: number;
  message_id: string;
  image_key: string | null;
  media_type: string;
  byte_size: number;
  sha256: string;
  storage_path: string;
  /** 'image' = platform-compressed photo, 'file' = uploaded file original (P28). */
  source_type: 'image' | 'file' | string;
  quality: string | null;
  status: 'saved' | 'rejected' | string;
  created_at: Date;
}

export interface NoteVersionRow {
  id: string;
  note_id: string;
  version: number;
  doc_id: string | null;
  doc_url: string | null;
  doc_revision: string | null;
  fingerprint: string;
  normalized_text: string;
  content: any;
  doc_snapshot: string;
  status: NoteVersionStatus | string;
  /** Last bounded verification of the live document (P32: matches/changed/unknown + when). */
  verified_at: Date | null;
  verify_result: 'matches' | 'changed' | 'unknown' | null;
  verify_fingerprint: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface ReviewTokenRow {
  token: string;
  note_id: string;
  version_id: string;
  action: 'approve' | 'return' | string;
  owner_open_id: string;
  fingerprint: string;
  expires_at: Date;
  used_at: Date | null;
  result: any;
}

export interface ReviewDecisionRow {
  id: string;
  note_id: string;
  version_id: string;
  decision: 'approve' | 'return' | string;
  reviewer_open_id: string;
  token: string;
  fingerprint: string;
  decided_at: Date;
  doc_sync_status: 'pending' | 'synced' | 'failed' | string;
  doc_sync_error: string | null;
}

export class NoteRepo {
  constructor(private readonly db: PaDb) {}

  async nextNoteId(): Promise<string> {
    return `N-${await this.db.nextNoteSeq()}`;
  }

  async insertNote(row: { id: string; title: string; origin: string; workItemId?: string | null }): Promise<NoteRow> {
    const result = await this.db.query<NoteRow>(
      `insert into pa24.note (id, title, status, origin, work_item_id) values ($1, $2, 'collecting', $3, $4) returning *`,
      [row.id, row.title, row.origin, row.workItemId ?? null],
    );
    return result.rows[0]!;
  }

  async getNote(id: string): Promise<NoteRow | null> {
    const result = await this.db.query<NoteRow>('select * from pa24.note where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async noteByWorkItem(workItemId: string): Promise<NoteRow | null> {
    const result = await this.db.query<NoteRow>(
      'select * from pa24.note where work_item_id = $1 order by created_at desc limit 1',
      [workItemId],
    );
    return result.rows[0] ?? null;
  }

  async updateNote(id: string, patch: Partial<Pick<NoteRow, 'status' | 'title' | 'work_item_id'>>): Promise<NoteRow | null> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    const result = await this.db.query<NoteRow>(`update pa24.note set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async listNotes(status?: string, limit = 50): Promise<NoteRow[]> {
    const result = status
      ? await this.db.query<NoteRow>('select * from pa24.note where status = $1 order by created_at desc limit $2', [status, limit])
      : await this.db.query<NoteRow>('select * from pa24.note order by created_at desc limit $1', [limit]);
    return result.rows;
  }

  async insertPage(row: Omit<NotePageRow, 'id' | 'created_at'>): Promise<{ inserted: boolean; row: NotePageRow }> {
    const id = `${row.note_id}:p${row.page_no}`;
    const result = await this.db.query<NotePageRow>(
      `insert into pa24.note_page (id, note_id, page_no, message_id, image_key, media_type, byte_size, sha256, storage_path, source_type, quality, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (note_id, page_no) do update set
         message_id = excluded.message_id,
         image_key = excluded.image_key,
         media_type = excluded.media_type,
         byte_size = excluded.byte_size,
         sha256 = excluded.sha256,
         storage_path = excluded.storage_path,
         source_type = excluded.source_type,
         quality = excluded.quality,
         status = excluded.status
       returning *`,
      [id, row.note_id, row.page_no, row.message_id, row.image_key, row.media_type, row.byte_size, row.sha256, row.storage_path, row.source_type ?? 'image', row.quality, row.status],
    );
    return { inserted: true, row: result.rows[0]! };
  }

  async savedPageForMessage(messageId: string): Promise<NotePageRow | null> {
    return (await this.db.query<NotePageRow>("select * from pa24.note_page where message_id = $1 and status = 'saved' order by created_at limit 1", [messageId])).rows[0] ?? null;
  }

  async getPage(noteId: string, pageNo: number): Promise<NotePageRow | null> {
    const result = await this.db.query<NotePageRow>('select * from pa24.note_page where note_id = $1 and page_no = $2', [noteId, pageNo]);
    return result.rows[0] ?? null;
  }

  async pagesOf(noteId: string): Promise<NotePageRow[]> {
    const result = await this.db.query<NotePageRow>('select * from pa24.note_page where note_id = $1 order by page_no', [noteId]);
    return result.rows;
  }

  async latestVersion(noteId: string): Promise<NoteVersionRow | null> {
    const result = await this.db.query<NoteVersionRow>('select * from pa24.note_version where note_id = $1 order by version desc limit 1', [noteId]);
    return result.rows[0] ?? null;
  }

  async getVersion(id: string): Promise<NoteVersionRow | null> {
    const result = await this.db.query<NoteVersionRow>('select * from pa24.note_version where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async versionsOf(noteId: string): Promise<NoteVersionRow[]> {
    const result = await this.db.query<NoteVersionRow>('select * from pa24.note_version where note_id = $1 order by version', [noteId]);
    return result.rows;
  }

  /** Reserve the candidate number once, before any document write. The input
   * identity survives version insertion and a restarted publication attempt. */
  async beginPublication(input: { noteId: string; workItemId: string; contentKey: string; legacyParamsKey: string; republish: boolean }): Promise<ActionOperationRow> {
    return this.db.withTransaction(async client => {
      await client.query('select id from pa24.note where id = $1 for update', [input.noteId]);
      const attempts = (await client.query<ActionOperationRow>(
        "select * from pa24.action_operation where action = 'note.publish' and params->>'noteId' = $1", [input.noteId],
      )).rows.sort((a, b) => Number(a.params?.version) - Number(b.params?.version));
      const id = `note.publish:${input.workItemId}:content:${input.contentKey}`;
      const existing = attempts.find(row => row.id === id) ?? attempts.find(row =>
        row.work_item_id === input.workItemId && Number.isInteger(row.params?.version) &&
        row.id === `note.publish:${input.workItemId}:${hash(`${input.noteId}:v${row.params.version}\n${input.legacyParamsKey}`)}`,
      );
      if (existing) return existing;
      const latest = (await client.query<{ version: number }>('select version from pa24.note_version where note_id = $1 order by version desc limit 1', [input.noteId])).rows[0];
      const version = Math.max(latest?.version ?? 0, ...attempts.map(row => Number(row.params?.version) || 0)) + 1;
      const params = { noteId: input.noteId, version, republish: input.republish, contentKey: input.contentKey };
      return (await client.query<ActionOperationRow>(
        `insert into pa24.action_operation (id, work_item_id, action, params, status)
         values ($1, $2, 'note.publish', $3, 'pending') returning *`,
        [id, input.workItemId, JSON.stringify(params)],
      )).rows[0]!;
    });
  }

  /** A saved candidate owns its unfinished publication, including when a new
   * tool invocation has a different WorkItem or the operation uses a legacy key. */
  async unfinishedPublicationForVersion(noteId: string, version: number): Promise<ActionOperationRow | null> {
    const result = await this.db.query<ActionOperationRow>(
      "select * from pa24.action_operation where action = 'note.publish' and params->>'noteId' = $1 and status <> 'succeeded'", [noteId],
    );
    return result.rows.find(row => row.params?.republish === true && row.params?.version === version) ?? null;
  }

  async insertVersion(row: Omit<NoteVersionRow, 'created_at' | 'decided_at' | 'verified_at' | 'verify_result' | 'verify_fingerprint'>): Promise<NoteVersionRow> {
    return this.db.withTransaction(async client => {
      await client.query('select id from pa24.note where id = $1 for update', [row.note_id]);
      const result = await client.query<NoteVersionRow>(
        `insert into pa24.note_version (id, note_id, version, doc_id, doc_url, doc_revision, fingerprint, normalized_text, content, doc_snapshot, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [row.id, row.note_id, row.version, row.doc_id, row.doc_url, row.doc_revision, row.fingerprint, row.normalized_text,
         JSON.stringify(row.content), row.doc_snapshot, row.status],
      );
      return result.rows[0]!;
    });
  }

  async updateVersion(id: string, patch: Partial<Pick<NoteVersionRow, 'status' | 'decided_at' | 'doc_revision' | 'verified_at' | 'verify_result' | 'verify_fingerprint'>>): Promise<NoteVersionRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    if (sets.length === 0) return this.getVersion(id);
    const result = await this.db.query<NoteVersionRow>(`update pa24.note_version set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  /** Mark older versions superseded when a newer one is published; approvals keep their own historical status. */
  async supersedeOlder(noteId: string, beforeVersion: number): Promise<void> {
    await this.db.query(
      `update pa24.note_version set status = 'superseded' where note_id = $1 and version < $2 and status in ('pending_review', 'stale')`,
      [noteId, beforeVersion],
    );
  }

  async insertToken(row: Omit<ReviewTokenRow, 'used_at' | 'result'>): Promise<ReviewTokenRow> {
    const result = await this.db.query<ReviewTokenRow>(
      `insert into pa24.review_token (token, note_id, version_id, action, owner_open_id, fingerprint, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [row.token, row.note_id, row.version_id, row.action, row.owner_open_id, row.fingerprint, row.expires_at],
    );
    return result.rows[0]!;
  }

  async getToken(token: string): Promise<ReviewTokenRow | null> {
    const result = await this.db.query<ReviewTokenRow>('select * from pa24.review_token where token = $1', [token]);
    return result.rows[0] ?? null;
  }

  async markTokenResult(token: string, result: unknown): Promise<void> {
    await this.db.query(`update pa24.review_token set result = $2 where token = $1`, [token, JSON.stringify(result)]);
  }

  async decisionsOf(noteId: string): Promise<ReviewDecisionRow[]> {
    const result = await this.db.query<ReviewDecisionRow>('select * from pa24.review_decision where note_id = $1 order by decided_at', [noteId]);
    return result.rows;
  }

  async updateDecisionSync(id: string, patch: { docSyncStatus: 'synced' | 'failed'; error?: string }): Promise<void> {
    await this.db.query(
      `update pa24.review_decision set doc_sync_status = $2, doc_sync_error = $3 where id = $1`,
      [id, patch.docSyncStatus, patch.error ?? null],
    );
  }

  async failedSyncDecisions(noteId: string): Promise<ReviewDecisionRow[]> {
    const result = await this.db.query<ReviewDecisionRow>(
      `select * from pa24.review_decision where note_id = $1 and doc_sync_status = 'failed' order by decided_at`,
      [noteId],
    );
    return result.rows;
  }

  /**
   * Transactional review decision (P31): credential, version state, note state
   * and the owner-notification intent commit together on one client.
   */
  async decideVersion(client: PaQueryer, row: {
    decisionId: string;
    noteId: string;
    versionId: string;
    versionStatus: 'approved' | 'returned';
    noteStatus: 'approved' | 'returned';
    decision: 'approve' | 'return';
    reviewerOpenId: string;
    token: string;
    fingerprint: string;
    notifyDedupKey: string;
    notifyTarget: string;
    notifyText: string;
  }): Promise<boolean> {
    // Serialize publication and decisions for this note. The document was
    // checked outside the transaction; local identity must still be current.
    await client.query('select id from pa24.note where id = $1 for update', [row.noteId]);
    const latest = (await client.query<NoteVersionRow>('select * from pa24.note_version where note_id = $1 order by version desc limit 1', [row.noteId])).rows[0];
    if (!latest || latest.id !== row.versionId || latest.status !== 'pending_review' || latest.fingerprint !== row.fingerprint) {
      throw new Error('待审版本已变化，本次点击未产生裁决；请核对最新审核卡。');
    }
    const token = await client.query(
      `update pa24.review_token set used_at = now() where token = $1 and used_at is null and version_id = $2 and owner_open_id = $3 and fingerprint = $4 and expires_at > now() returning token`,
      [row.token, row.versionId, row.reviewerOpenId, row.fingerprint],
    );
    if (!token.rowCount) return false;
    await client.query(
      `insert into pa24.review_decision (id, note_id, version_id, decision, reviewer_open_id, token, fingerprint)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [row.decisionId, row.noteId, row.versionId, row.decision, row.reviewerOpenId, row.token, row.fingerprint],
    );
    await client.query(`update pa24.note_version set status = $2, decided_at = now() where id = $1`, [row.versionId, row.versionStatus]);
    await client.query(`update pa24.note set status = $2, updated_at = now() where id = $1`, [row.noteId, row.noteStatus]);
    await client.query(
      `insert into pa24.outbox (dedup_key, channel, target, kind, content, status)
       values ($1, 'feishu', $2, 'text', $3::jsonb, 'pending') on conflict (dedup_key) do nothing`,
      [row.notifyDedupKey, row.notifyTarget, JSON.stringify({ text: row.notifyText })],
    );
    // Decided versions stop nagging immediately, in the same transaction (P33).
    await client.query(new ReviewReminderRepo(this.db).cancelForVersionSql, [row.versionId]);
    return true;
  }

  /** Review queue: notes awaiting action with their latest version state (P33). */
  async reviewQueue(limit = 50): Promise<(NoteRow & { latest: NoteVersionRow | null; pages: number })[]> {
    const result = await this.db.query<NoteRow>(
      `select * from pa24.note where status in ('awaiting_review', 'needs_rereview', 'returned') order by updated_at desc limit $1`,
      [limit],
    );
    const rows = [] as (NoteRow & { latest: NoteVersionRow | null; pages: number })[];
    for (const note of result.rows) {
      const latest = await this.latestVersion(note.id);
      const pages = await this.db.query<{ count: string }>(
        `select count(*) as count from pa24.note_page where note_id = $1 and status = 'saved'`,
        [note.id],
      );
      rows.push({ ...note, latest, pages: Number(pages.rows[0]!.count) });
    }
    return rows;
  }

  /** Pending-review versions for the bounded polling loop (P32). */
  async pendingReviewVersions(limit: number): Promise<NoteVersionRow[]> {
    const result = await this.db.query<NoteVersionRow>(
      `select * from pa24.note_version where status = 'pending_review' order by created_at limit $1`,
      [limit],
    );
    return result.rows;
  }

  /** Recently approved versions for today's overview (F28); live documents
   *  are re-verified by the caller so stale approvals drop out (P35). */
  async recentApproved(limit: number): Promise<NoteVersionRow[]> {
    const result = await this.db.query<NoteVersionRow>(
      `select * from pa24.note_version where status = 'approved' order by decided_at desc nulls last limit $1`,
      [limit],
    );
    return result.rows;
  }

  /** Versions with their review decisions for notes search (F28): unreviewed
   *  states are labeled from the decision join, never inherited. */
  async versionsWithDecisions(limit: number): Promise<Array<Record<string, any>>> {
    const result = await this.db.query<Record<string, any>>(
      `select v.id, v.note_id, v.version, v.status, v.fingerprint, v.doc_id, v.doc_url, v.content, v.decided_at,
              v.verified_at, v.verify_result, v.created_at, n.title,
              d.decision, d.reviewer_open_id, d.decided_at as decision_at
       from pa24.note_version v
       left join pa24.note n on n.id = v.note_id
       left join pa24.review_decision d on d.version_id = v.id
       order by v.created_at desc limit $1`,
      [limit],
    );
    return result.rows;
  }
}

export interface ReviewReminderRow {
  id: string;
  note_id: string;
  version_id: string;
  kind: 'once' | 'daily' | string;
  remind_at: Date;
  status: 'pending' | 'paused' | 'sent' | 'done' | 'canceled' | string;
  sent_count: number;
  last_sent_at: Date | null;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ReviewReminderRepo {
  constructor(private readonly db: PaDb) {}

  async insert(row: { id: string; noteId: string; versionId: string; kind: 'once' | 'daily'; remindAt: Date; reason?: string }): Promise<ReviewReminderRow> {
    const result = await this.db.query<ReviewReminderRow>(
      `insert into pa24.review_reminder (id, note_id, version_id, kind, remind_at, reason)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [row.id, row.noteId, row.versionId, row.kind, row.remindAt, row.reason ?? null],
    );
    return result.rows[0]!;
  }

  async get(id: string): Promise<ReviewReminderRow | null> {
    const result = await this.db.query<ReviewReminderRow>('select * from pa24.review_reminder where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  /** Due, unpaused reminders; claimed with SKIP LOCKED so one Host sends once. */
  async claimDue(now: Date, limit: number): Promise<ReviewReminderRow[]> {
    const result = await this.db.query<ReviewReminderRow>(
      `update pa24.review_reminder set updated_at = now()
       where id in (
         select id from pa24.review_reminder
         where status = 'pending' and remind_at <= $1
         order by remind_at limit $2 for update skip locked
       ) returning *`,
      [now, limit],
    );
    return result.rows;
  }

  async update(id: string, patch: Partial<Pick<ReviewReminderRow, 'status' | 'remind_at' | 'sent_count' | 'last_sent_at'>>): Promise<ReviewReminderRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    const result = await this.db.query<ReviewReminderRow>(`update pa24.review_reminder set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  /** Cancel every in-flight nag for a version (decision/supersede path). */
  cancelForVersionSql = `update pa24.review_reminder set status = 'canceled', updated_at = now() where version_id = $1 and status in ('pending', 'paused')`;

  async cancelForVersion(versionId: string): Promise<number> {
    const result = await this.db.query(this.cancelForVersionSql, [versionId]);
    return result.rowCount ?? 0;
  }


  async activeForNote(noteId: string): Promise<ReviewReminderRow[]> {
    const result = await this.db.query<ReviewReminderRow>(
      `select * from pa24.review_reminder where note_id = $1 and status in ('pending', 'paused') order by remind_at`,
      [noteId],
    );
    return result.rows;
  }

  async activeAll(limit = 50): Promise<ReviewReminderRow[]> {
    const result = await this.db.query<ReviewReminderRow>(
      `select * from pa24.review_reminder where status in ('pending', 'paused') order by remind_at limit $1`,
      [limit],
    );
    return result.rows;
  }
}

// ---- outreach, recurring tasks, waiting items (F08) ------------------------
