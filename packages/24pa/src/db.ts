// Backend-agnostic database surface (F25): the business ledger runs on
// SQLite by default or PostgreSQL by explicit workspace choice, and repos
// program against this interface only. No silent fallback — whichever
// backend the config names is the backend that runs, or startup fails loud.

export interface PaQueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Anything that can run business SQL — the pool itself or a tx client. */
export interface PaQueryer {
  query<T extends Record<string, any> = Record<string, any>>(text: string, values?: readonly unknown[]): Promise<PaQueryResult<T>>;
}

/** One self-contained ledger artifact a backup ships as a part (F28). */
export interface BackupPart {
  id: string;
  name: string;
  bytes: Buffer;
  /** Legacy multipart metadata; current SQLite backups are self-contained. */
  optional?: boolean;
}

export interface WorkspaceLedgerIdentity {
  workspaceId: string;
  workspacePath: string;
  ownerOpenId: string;
}

export interface PaDb extends PaQueryer {
  readonly kind: 'postgres' | 'sqlite';
  /** SQLite only: absolute path of the ledger file (backup support). */
  readonly filePath?: string;
  check(): Promise<void>;
  /** Runtime admission supplies identity; ownership and migrations commit together. */
  migrate(identity?: WorkspaceLedgerIdentity): Promise<number>;
  schemaVersion(): Promise<number>;
  /** Note numbering N-1, N-2… (PG sequence / SQLite counter table). */
  nextNoteSeq(): Promise<number>;
  withTransaction<T>(work: (client: PaQueryer) => Promise<T>): Promise<T>;
  /** Consistent ledger snapshot: SQLite native backup, PostgreSQL pg_dump. */
  backup(): Promise<BackupPart[]>;
  close(): Promise<void>;
}

// Schema authority (moved from pg.ts in the round-3 review): the shared
// migration list both adapters consume. Living at the db level keeps either
// adapter from being the other's dependency (sqlite used to import from pg).
export const MIGRATIONS: readonly { version: number; statements: readonly string[] }[] = [
  {
    version: 1,
    statements: [
      `create table if not exists pa24.binding (
        app_id text not null,
        tenant_key text not null,
        owner_open_id text not null,
        lark_profile text not null,
        status text not null default 'active',
        chat_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (app_id, tenant_key, owner_open_id)
      )`,
      `create table if not exists pa24.workspace_state (
        path text primary key,
        feishu_session_id text,
        local_session_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.inbox (
        event_id text primary key,
        source text not null,
        kind text not null,
        payload jsonb not null,
        status text not null,
        request_id text,
        target_session text,
        error text,
        created_at timestamptz not null default now(),
        processed_at timestamptz
      )`,
      `create table if not exists pa24.work_item (
        id text primary key,
        title text not null,
        role text not null,
        instruction text not null,
        origin text not null,
        parent_session_id text not null,
        child_session_id text,
        delivery text not null,
        status text not null,
        progress text,
        result text,
        result_ref jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists work_item_status_idx on pa24.work_item (status)`,
      `create table if not exists pa24.action_operation (
        id text primary key,
        work_item_id text not null,
        action text not null,
        params jsonb not null,
        status text not null,
        attempt int not null default 0,
        receipt jsonb,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.outbox (
        id bigserial primary key,
        dedup_key text not null unique,
        channel text not null,
        target text not null,
        kind text not null,
        content jsonb not null,
        status text not null,
        message_id text,
        attempts int not null default 0,
        next_attempt_at timestamptz,
        last_error text,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      )`,
      `create index if not exists outbox_dispatch_idx on pa24.outbox (status, next_attempt_at)`,
      `create table if not exists pa24.memo (
        id text primary key,
        work_item_id text,
        topic text not null,
        content text not null,
        doc_url text,
        doc_id text,
        doc_revision text,
        source text not null,
        occurred_on date,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists memo_topic_idx on pa24.memo (topic)`,
      `create index if not exists memo_occurred_idx on pa24.memo (occurred_on)`,
    ],
  },
  {
    version: 2,
    statements: [
      `create table if not exists pa24.message_route (
        message_id text primary key,
        channel text not null,
        kind text not null,
        work_item_id text,
        inbox_event_id text,
        created_at timestamptz not null default now()
      )`,
      `alter table pa24.work_item add column if not exists recovery_gen int not null default 0`,
    ],
  },
  {
    version: 3,
    statements: [
      `create table if not exists pa24.task (
        id text primary key,
        work_item_id text,
        task_guid text not null unique,
        url text,
        summary text not null,
        due_at timestamptz,
        due_has_time boolean not null default false,
        planned_at timestamptz,
        estimate_minutes int,
        status text not null default 'open',
        external_updated_at timestamptz,
        last_synced_at timestamptz,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists task_status_idx on pa24.task (status)`,
      `create table if not exists pa24.project (
        id text primary key,
        name text not null,
        goal text not null default '',
        status text not null default 'open',
        created_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.project_task (
        project_id text not null references pa24.project (id),
        task_id text not null references pa24.task (id),
        adopted_at timestamptz not null default now(),
        primary key (project_id, task_id)
      )`,
    ],
  },
  {
    version: 4,
    statements: [
      `create table if not exists pa24.calendar_event (
        event_id text primary key,
        calendar_id text not null,
        summary text not null,
        start_time timestamptz not null,
        end_time timestamptz not null,
        is_all_day boolean not null default false,
        timezone text,
        status text not null default 'active',
        recurring boolean not null default false,
        attendees jsonb,
        url text,
        raw jsonb,
        synced_at timestamptz not null default now()
      )`,
      `create index if not exists calendar_event_window_idx on pa24.calendar_event (calendar_id, start_time, end_time)`,
      `create table if not exists pa24.calendar_sync_state (
        calendar_id text primary key,
        window_start timestamptz not null,
        window_end timestamptz not null,
        complete boolean not null default false,
        last_synced_at timestamptz,
        last_error text
      )`,
    ],
  },
  {
    version: 5,
    statements: [
      `create table if not exists pa24.reminder_rule (
        id text primary key,
        kind text not null,
        text text not null,
        record jsonb not null,
        status text not null default 'active',
        next_due_at timestamptz,
        time_zone text not null,
        origin_expression text,
        source text,
        work_item_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists reminder_rule_due_idx on pa24.reminder_rule (status, next_due_at)`,
      `create table if not exists pa24.reminder_occurrence (
        id text primary key,
        rule_id text not null,
        due_at timestamptz not null,
        status text not null default 'pending',
        deferred_until timestamptz,
        origin_occurrence_id text,
        outbox_dedup_key text,
        attempts int not null default 0,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists reminder_occurrence_due_idx on pa24.reminder_occurrence (status, due_at)`,
    ],
  },
  {
    version: 6,
    statements: [
      `create sequence if not exists pa24.note_seq start 1`,
      `create table if not exists pa24.note (
        id text primary key,
        title text not null,
        status text not null default 'collecting',
        origin text not null default 'feishu',
        work_item_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.note_page (
        id text primary key,
        note_id text not null,
        page_no int not null,
        message_id text not null,
        image_key text,
        media_type text not null,
        byte_size int not null,
        sha256 text not null,
        storage_path text not null,
        source_type text not null default 'image',
        quality text,
        status text not null default 'saved',
        created_at timestamptz not null default now(),
        unique (note_id, page_no)
      )`,
      `create table if not exists pa24.note_version (
        id text primary key,
        note_id text not null,
        version int not null,
        doc_id text,
        doc_url text,
        doc_revision text,
        fingerprint text not null,
        normalized_text text not null,
        content jsonb not null,
        doc_snapshot text not null,
        status text not null default 'pending_review',
        verified_at timestamptz,
        verify_result text,
        verify_fingerprint text,
        created_at timestamptz not null default now(),
        decided_at timestamptz,
        unique (note_id, version)
      )`,
      `create table if not exists pa24.review_token (
        token text primary key,
        note_id text not null,
        version_id text not null,
        action text not null,
        owner_open_id text not null,
        fingerprint text not null,
        expires_at timestamptz not null,
        used_at timestamptz,
        result jsonb
      )`,
      `create table if not exists pa24.review_decision (
        id text primary key,
        note_id text not null,
        version_id text not null,
        decision text not null,
        reviewer_open_id text not null,
        token text not null,
        fingerprint text not null,
        decided_at timestamptz not null default now(),
        doc_sync_status text not null default 'pending',
        doc_sync_error text
      )`,
      `alter table pa24.message_route add column if not exists note_id text`,
    ],
  },
  {
    version: 7,
    statements: [
      `create table if not exists pa24.review_reminder (
        id text primary key,
        note_id text not null,
        version_id text not null,
        kind text not null,
        remind_at timestamptz not null,
        status text not null default 'pending',
        sent_count int not null default 0,
        last_sent_at timestamptz,
        reason text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists review_reminder_due_idx on pa24.review_reminder (status, remind_at)`,
    ],
  },
  {
    version: 8,
    statements: [
      `alter table pa24.reminder_rule add column if not exists link_source_type text`,
      `alter table pa24.reminder_rule add column if not exists link_source_id text`,
      `alter table pa24.reminder_rule add column if not exists link_fingerprint text`,
      `create index if not exists reminder_rule_link_idx on pa24.reminder_rule (link_source_type, link_source_id)`,
      `create table if not exists pa24.outreach (
        id text primary key,
        work_item_id text,
        kind text not null,
        target_open_id text not null,
        target_name text not null,
        content text not null,
        instruction text not null,
        status text not null,
        message_id text,
        task_guid text,
        error text,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      )`,
      `create table if not exists pa24.task_template (
        id text primary key,
        title text not null,
        tasklist_id text not null,
        schedule jsonb not null,
        origin_expression text,
        status text not null default 'active',
        next_due_at timestamptz,
        time_zone text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.task_template_instance (
        id text primary key,
        template_id text not null,
        due_at timestamptz not null,
        status text not null default 'pending',
        task_id text,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists task_template_instance_due_idx on pa24.task_template_instance (status, due_at)`,
      `create table if not exists pa24.waiting_item (
        id text primary key,
        title text not null,
        detail text not null default '',
        source_desc text not null default '',
        dedup_key text,
        checkpoint_at timestamptz,
        status text not null default 'waiting',
        result text,
        ask_count int not null default 0,
        last_asked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists waiting_item_due_idx on pa24.waiting_item (status, checkpoint_at)`,
    ],
  },
  {
    version: 9,
    statements: [
      `create table if not exists pa24.digest_plan (
        id text primary key,
        kind text not null,
        title text not null,
        schedule_id text,
        session_id text not null,
        schedule_spec jsonb not null,
        status text not null default 'active',
        last_window text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.digest_occurrence (
        id text primary key,
        plan_id text not null,
        window_key text not null,
        status text not null default 'delivering',
        report jsonb,
        outbox_key text,
        delivered_at timestamptz,
        completed_at timestamptz,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (plan_id, window_key)
      )`,
      `create index if not exists digest_occurrence_plan_idx on pa24.digest_occurrence (plan_id, created_at)`,
    ],
  },
  {
    version: 10,
    statements: [
      `create table if not exists pa24.minutes (
        id text primary key,
        work_item_id text,
        event_id text,
        topic text not null,
        memo_id text,
        doc_url text,
        candidates jsonb not null default '[]'::jsonb,
        status text not null default 'draft',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
    ],
  },
  {
    // F16 (spec 1.6): projection rows record which channel created them.
    // Existing rows keep their implicit feishu semantics.
    version: 11,
    statements: [
      `alter table pa24.task add column if not exists channel text not null default 'feishu'`,
      `alter table pa24.calendar_event add column if not exists channel text not null default 'feishu'`,
      `alter table pa24.calendar_sync_state add column if not exists channel text not null default 'feishu'`,
    ],
  },
  {
    // F19 (spec 2.3): per-plan voice-delivery switch, default off — existing
    // plans keep text-only delivery until the owner opts in per plan.
    version: 12,
    statements: [
      `alter table pa24.digest_plan add column if not exists voice boolean not null default false`,
    ],
  },
  {
    // F40 (spec 2.11): plan→task-skill binding; existing rows map to the
    // builtin template-track skill of their kind.
    version: 13,
    statements: [
      `alter table pa24.digest_plan add column if not exists skill text not null default ''`,
      `update pa24.digest_plan set skill = case when kind = 'meeting_prep' then 'meeting-prep' else 'digest-' || kind end where skill = '' and kind in ('morning', 'evening', 'weekly', 'meeting_prep')`,
    ],
  },
  {
    // A resumed Worker keeps its original occurrence; delivery never guesses
    // the newest window of a plan. Existing occurrences remain untouched.
    version: 14,
    statements: [
      `create table if not exists pa24.digest_work_binding (
        work_item_id text primary key,
        occurrence_id text,
        source jsonb,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists digest_work_binding_occurrence_idx on pa24.digest_work_binding (occurrence_id)`,
    ],
  },
  {
    version: 15,
    statements: [
      `alter table pa24.work_item add column if not exists skill text`,
      `alter table pa24.work_item add column if not exists skill_definition jsonb`,
      `alter table pa24.digest_plan add column if not exists lifecycle jsonb`,
      `alter table pa24.digest_plan add column if not exists revision integer not null default 0`,
    ],
  },
  {
    version: 16,
    statements: [
      `alter table pa24.digest_occurrence add column if not exists time_context jsonb`,
      `alter table pa24.digest_plan add column if not exists schedule_generation text`,
    ],
  },
  {
    version: 17,
    statements: [
      `create table if not exists pa24.ledger_owner (
        id integer primary key check (id = 1),
        workspace_id text not null unique,
        owner_open_id text not null,
        created_at timestamptz not null default now()
      )`,
    ],
  },
  {
    version: 18,
    statements: [
      `alter table pa24.work_item add column if not exists execution_id text`,
      `alter table pa24.work_item add column if not exists execution_scope jsonb`,
    ],
  },
  {
    version: 19,
    statements: [
      `create table if not exists pa24.skill_entry (
        id text primary key,
        name text not null unique,
        display_name text not null,
        source text not null,
        status text not null default 'draft',
        revision integer not null default 0,
        draft_version text not null,
        active_version text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.skill_version (
        id text primary key,
        skill_id text not null,
        package_data jsonb not null,
        definition jsonb,
        validation_error text,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists skill_version_entry_idx on pa24.skill_version (skill_id, created_at)`,
      `create table if not exists pa24.skill_change (
        id text primary key,
        request_hash text not null,
        result jsonb,
        created_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.skill_plan_block (
        plan_id text primary key,
        skill_id text not null,
        reason text not null,
        created_at timestamptz not null default now()
      )`,
      `alter table pa24.digest_occurrence add column if not exists skill_snapshot jsonb`,
      `alter table pa24.digest_occurrence add column if not exists plan_snapshot jsonb`,
      `alter table pa24.work_item add column if not exists execution_mode text not null default 'worker'`,
      `alter table pa24.work_item add column if not exists active_skill_run_id text`,
      `create table if not exists pa24.skill_run (
        id text primary key,
        request_id text not null unique,
        request_hash text not null,
        work_item_id text not null,
        skill_id text not null,
        version_id text not null,
        source_session_id text not null,
        session_id text not null unique,
        workspace_path text not null,
        mode text not null,
        trial boolean not null default false,
        snapshot jsonb not null,
        status text not null default 'pending',
        progress text,
        result text,
        delivery_status text not null default 'not_requested',
        recovery jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists skill_run_work_idx on pa24.skill_run (work_item_id, created_at)`,
      `create index if not exists skill_run_skill_idx on pa24.skill_run (skill_id, created_at)`,
      `create table if not exists pa24.skill_run_call (
        run_id text not null,
        call_id text not null,
        session_id text not null,
        root_call_id text,
        tool text not null,
        arguments jsonb not null,
        status text not null,
        result jsonb,
        final_result jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (run_id, session_id, call_id)
      )`,
      `create table if not exists pa24.skill_run_input (
        run_id text not null,
        message_id text not null,
        session_id text,
        message jsonb not null,
        accepted boolean not null,
        created_at timestamptz not null default now(),
        primary key (run_id, message_id)
      )`,
      `create table if not exists pa24.skill_run_session (
        session_id text primary key,
        run_id text not null,
        parent_session_id text,
        workspace_path text not null,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists skill_run_session_run_idx on pa24.skill_run_session (run_id)`,
      `create table if not exists pa24.skill_run_native (
        run_id text not null,
        kind text not null,
        owner_id text not null,
        native_id text not null,
        start_data jsonb,
        end_data jsonb,
        created_at timestamptz not null default now(),
        primary key (run_id, kind, owner_id, native_id)
      )`,
      `create table if not exists pa24.skill_run_review (
        request_id text primary key,
        request_hash text not null,
        run_id text not null,
        evidence_hash text not null,
        record jsonb not null,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists skill_run_review_run_idx on pa24.skill_run_review (run_id, created_at)`,
    ],
  },
  {
    version: 20,
    statements: [
      `create table if not exists pa24.source_registry_state (
        id text primary key, config_hash text not null, revision integer not null default 0,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.source_registration (
        id text primary key, revision integer not null default 1, scope_hash text not null,
        registration jsonb not null, identity_key text, removed boolean not null default false,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.source_evidence (
        source_id text primary key, registration_revision integer not null, scope_hash text not null,
        connection_hash text not null, evidence jsonb not null, checked_at timestamptz not null
      )`,
      `create table if not exists pa24.source_object (
        id text primary key, domain text not null, platform text not null, identity_key text not null,
        native_id text not null, body jsonb not null, observed_at timestamptz not null, updated_at timestamptz not null default now(),
        unique (domain, platform, identity_key, native_id)
      )`,
      `create table if not exists pa24.source_membership (
        source_id text not null, locator_id text not null, object_id text not null references pa24.source_object (id),
        registration_revision integer not null, scope_hash text not null, locator jsonb not null, body jsonb not null,
        roles jsonb not null, capabilities jsonb not null, active boolean not null,
        start_time timestamptz, end_time timestamptz, observed_at timestamptz not null,
        primary key (source_id, locator_id)
      )`,
      `create index if not exists source_membership_object_idx on pa24.source_membership (object_id)`,
      `create index if not exists source_membership_window_idx on pa24.source_membership (source_id, start_time, end_time)`,
      `create table if not exists pa24.source_observation (
        source_id text not null, query_key text not null, registration_revision integer not null, scope_hash text not null,
        state text not null, query jsonb not null, reason text, observed_at timestamptz not null,
        last_complete_at timestamptz, primary key (source_id, query_key)
      )`,
    ],
  },
  {
    version: 21,
    statements: [
      `create table if not exists pa24.skill_run_control (
        run_id text primary key, revision integer not null default 0,
        state jsonb not null, updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.skill_run_resume (
        request_id text primary key, run_id text not null, request_hash text not null,
        message jsonb not null, status text not null, native_message_id text,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists skill_run_resume_run_idx on pa24.skill_run_resume (run_id, created_at)`,
    ],
  },
  {
    version: 22,
    statements: [
      `alter table pa24.digest_plan add column if not exists task_config jsonb`,
      `alter table pa24.digest_plan add column if not exists task_authorization jsonb`,
      `alter table pa24.digest_plan add column if not exists owner_enabled boolean not null default false`,
      `alter table pa24.digest_plan add column if not exists recycled_at timestamptz`,
      `alter table pa24.digest_plan add column if not exists delete_when_idle boolean not null default false`,
      `alter table pa24.digest_plan add column if not exists failure_count integer not null default 0`,
      `alter table pa24.digest_plan add column if not exists last_success_hash text`,
      `update pa24.digest_plan set owner_enabled = true where status = 'active'`,
      `create table if not exists pa24.task_plan_block (
        plan_id text not null references pa24.digest_plan (id), key text not null,
        kind text not null, reason text not null, created_at timestamptz not null default now(),
        primary key (plan_id, key)
      )`,
      `create table if not exists pa24.task_plan_change (
        request_id text primary key, request_hash text not null, result jsonb,
        created_at timestamptz not null default now()
      )`,
      `alter table pa24.skill_run add column if not exists plan_id text`,
      `alter table pa24.skill_run add column if not exists trigger_kind text`,
      `alter table pa24.skill_run add column if not exists triggered_at timestamptz`,
      `create index if not exists skill_run_plan_idx on pa24.skill_run (plan_id, created_at)`,
      `create table if not exists pa24.plan_trigger (
        id text primary key, plan_id text not null references pa24.digest_plan (id),
        generation text not null, occurrence text not null, source text not null,
        status text not null, reason text, run_id text, snapshot jsonb not null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (plan_id, generation, occurrence)
      )`,
      `create index if not exists plan_trigger_status_idx on pa24.plan_trigger (status, created_at)`,
      `create table if not exists pa24.skill_run_admission_guard (id text primary key)`,
    ],
  },
  {
    version: 23,
    statements: [
      `create table if not exists pa24.task_plan_run_outcome (
        run_id text primary key, plan_id text not null, status text not null,
        result_hash text, created_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.task_plan_notice (
        id text primary key, run_id text not null, plan_id text not null, kind text not null,
        status text not null, reason text, destination jsonb,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists task_plan_notice_run_idx on pa24.task_plan_notice (run_id, created_at)`,
      `create table if not exists pa24.task_plan_delivery (
        outbox_id bigint primary key, notice_id text not null, run_id text not null,
        component text not null, expires_at timestamptz, override_quiet boolean not null default false
      )`,
      `create index if not exists task_plan_delivery_run_idx on pa24.task_plan_delivery (run_id)`,
      `create table if not exists pa24.task_plan_delivery_change (
        request_id text primary key, request_hash text not null, outbox_id bigint not null,
        record jsonb not null, created_at timestamptz not null default now()
      )`,
    ],
  },
  {
    version: 24,
    statements: [
      `alter table pa24.skill_run add column if not exists stop_reason text`,
    ],
  },
  {
    version: 25,
    statements: [
      `create table if not exists pa24.task_plan_migration (
        plan_id text primary key, original jsonb not null, time_zone text not null,
        request_id text not null, migrated_at timestamptz not null default now()
      )`,
    ],
  },
];
