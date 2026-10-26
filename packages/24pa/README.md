---
description: "24PA (24私助) is a self-hosted AI personal assistant for Feishu/Lark, built as a dsh plugin: agent skills, schedules, calendars, todos, memory, handwriting review, and WeCom integrations."
kind: "package-bundle"
---

# 24PA (24私助) — AI Personal Assistant for Feishu / Lark

**English** | [中文](README.zh.md) | [GitHub](https://github.com/benz-ai-x/dsh-24-PA) | [Releases](https://github.com/benz-ai-x/dsh-24-PA/releases)

[![npm version](https://img.shields.io/npm/v/%40benz-ai-x%2Fdsh-24pa?label=npm)](https://www.npmjs.com/package/@benz-ai-x/dsh-24pa)
[![GitHub release](https://img.shields.io/github/v/release/benz-ai-x/dsh-24-PA?label=release)](https://github.com/benz-ai-x/dsh-24-PA/releases/latest)
[![Node.js](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-43853d)](package.json)
[![dsh baseline](https://img.shields.io/badge/dsh-0.2.1--rc.3-3451b2)](https://github.com/benz-ai-x/dsh-24-PA/releases/tag/v0.2.1-rc.3.1)

**From “remind me” to “prepare my week” — turn conversations into organized, reviewable action without giving up control.**

`@benz-ai-x/dsh-24pa` is a self-hosted AI personal-assistant plugin for [dsh](https://github.com/deepseek-ai/deepseek-harness). A local desktop workspace and a Feishu bot coordinate seven business workers in one owner-bound workspace, combining agent skills, scheduled tasks, calendars, todos, structured memory, handwriting review, and delivery evidence.

![24PA desktop workspace showing Skill management, scheduled tasks, calendars, todos, and run history](https://raw.githubusercontent.com/benz-ai-x/dsh-24-PA/main/docs/assets/24pa-desktop-overview.png)

## Why 24PA?

- **More than a chatbot.** Move from a request to a work item, a Skill run, a platform object, and a traceable result — with schedules and follow-through built in.
- **Keep the tools you already use.** Work with original Feishu and WeCom calendars, todos, documents, and notifications instead of forcing another source of truth.
- **Automation you can actually govern.** Inspect Skill packages and versions, preview permissions, separate execution from delivery, and keep human approval distinct from action authorization.
- **A personal-assistant surface that can grow.** Cards organize focused capabilities on one shared workspace and runtime, so new scenarios can be added without creating another disconnected bot.

## Card-based assistant architecture

Conversational coordination and the desktop card surface share owner identity, role boundaries, the Skill and schedule runtime, work records, storage, and delivery evidence.

![Architecture of 24PA showing local and Feishu entries, one workspace and permission boundary, sixteen capability cards, a shared runtime, and future scenario cards](https://raw.githubusercontent.com/benz-ai-x/dsh-24-PA/main/docs/assets/24pa-architecture.png)

**Cards are the product's extension unit.** New scenarios can add focused cards while reusing the workspace, permissions, plans, run history, and operational foundation. The sixteen solid cards below are implemented; the dashed card is an extension direction, not a claim about an existing third-party card SDK.

## Sixteen implemented cards

Every card below is part of the current product. Ordinary browsing is read-only and does not silently start a model, create a platform object, or run a task.

### Work & plans — 5 cards

| Card | What it helps you do | Included capabilities |
| --- | --- | --- |
| **Skill management** | Turn reusable know-how into controlled assistant capabilities. | Create/import Markdown or ZIP; edit and copy; complete package tree and read-only file preview; immutable versions; linked plans; test, run, disable, roll back, delete, and download. |
| **Scheduled tasks** | Put one-off and recurring work on a persistent timeline. | Blank, preset, or copied plans; Skill parameters, fixed time zone, approved targets and delivery; occurrence preview; enable, pause, resume, run now, delete, restore, and history. |
| **Calendar** | Understand and manage schedules across registered calendars. | Today and next-event views; source filters, conflicts and query completeness; platform verification; conversation-based create/change; native reminders; original-event links. |
| **Todos** | Manage real platform work without confusing it with assistant execution. | Overdue, today and open views; multi-source aggregation; five role scopes; conversation-based create, complete, postpone, edit and cancel; original-object links and related work items. |
| **Run history** | See what ran, what resulted, and what was actually delivered. | Separate executions, work items and unexecuted events; filters and export; diagnostics and reconciliation; retry delivery or rerun; supplement, stop, continue and accept work items. |

### Knowledge & materials — 2 cards

| Card | What it helps you do | Included capabilities |
| --- | --- | --- |
| **Handwriting review** | Turn handwritten material into reviewable content and explicitly authorized next actions. | Source comparison, draft editing, version publishing and diffs; Feishu review entry; verification and resend; candidate actions remain separate from content approval. |
| **Structured memory** | Keep long-term facts, preferences and decisions traceable. | Full text, sources, confirmation evidence, scope, validity, conflicts and revisions; query/filter; local create, edit, deactivate, delete, restore and undo; JSON remains the editable authority. |

### Connections & setup — 6 cards

| Card | What it helps you do | Included capabilities |
| --- | --- | --- |
| **Feishu connection** | Know whether the owner, app and required capabilities are really connected. | Owner, CLI, app and profile identity evidence; send/receive, review callback and resource checks; read-only diagnostics, explicitly triggered tests, cleanup and configuration links. |
| **WeCom connection** | Operate selected WeCom resources without adding another inbound bot. | Separate calendar, todo and one-way push evidence; identity and authorization checks; renewal, independent tests and configuration links; no inbound chat. |
| **QwenNote minutes** | Use recordings and meeting notes as traceable source material. | Local-only, on-demand list/transcript/minutes reading; connection evidence; source-backed summaries and candidate actions that still require review and authorization. |
| **Feishu Wiki** | Choose where memos and handwriting-review documents belong. | Destination, node, permission and related-document checks; configure, verify and open; save through material workflows without moving old documents or silently changing destinations. |
| **Workspace & config** | Keep each owner's rules, data and sessions attached to the right workspace. | Directory and binding status, configuration source, effective version and differences; bind, switch, reload, inspect effective config and enter parameter editing; failed reloads keep the current environment. |
| **Parameters** | Change everyday behavior through one controlled configuration surface. | Business parameters, source mappings, model routes, voice and budget settings; edit, validate, save, reset and locate errors; write-only secrets and separate saved/effective feedback. |

### Operations & maintenance — 3 cards

| Card | What it helps you do | Included capabilities |
| --- | --- | --- |
| **Full-app health checks** | Find what needs attention before it blocks work. | Module status, evidence time and scope, impact and next steps; full or per-module read-only checks; distinguish disabled, unchecked, unverified and failed states; diagnostics and repair links. |
| **Models & budgets** | Understand model consumption and stop new managed requests at explicit limits. | Actual model routes, token/request usage and pricing evidence; daily/monthly limits and warning thresholds; one-run permit after review; unknown cost is never reported as zero. |
| **Ledger & backups** | Protect the state needed for recovery and prove what was checked. | SQLite/PostgreSQL status; create backups, inspect manifests and verify real copies; isolated restore checks; secrets excluded; restore drills remain separate from authorized production cutover. |

See the [Manticore delivery and acceptance record](https://github.com/benz-ai-x/dsh-24-PA/blob/main/docs/planning/24PA-Manticore-交付验收.md) for module ownership and verification evidence.

## Quick start

Requirements: Node.js `^22.19.0` or `>=24.0.0`, dsh `0.2.1-rc.3`, and no database service for the default SQLite demo.

<a id="installing-the-bundle"></a>
### Install the current release

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3

dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-rc.3.1 --registry=https://registry.npmjs.org
```

Restart the same Profile and choose the「24私助」preset. Installation and startup must use the same `DSH_HOME`. For a new instance, follow the [initialization guide](https://github.com/benz-ai-x/dsh-24-PA/blob/main/docs/24PA-初始化指南.md) for the isolated directory, launch script, expected pnpm approval, token URL, and demo verification. Then tell the local assistant「帮我接通飞书」or use the bundled [Feishu setup guide](feishu-setup.md).

To remove the bundle, run `dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa` with the same `DSH_HOME`. Removal takes effect on the next Profile start; it does not delete the workspace, sessions, or PostgreSQL data.

<details>
<summary><strong>Using an older dsh host?</strong> Recommended version pins</summary>

24PA versions follow `<dsh baseline>.<serial>`; npm dist-tags track baselines.

| dsh host | 24PA package |
| --- | --- |
| `0.2.1-rc.3` | `0.2.1-rc.3.1` (current) |
| `0.2.1-rc.2` | `0.2.1-rc.2.9` |
| `0.2.1-rc.1` | `0.2.1-rc.1.2` |
| `0.2.1-alpha.2` – `0.2.1-alpha.5` | `0.2.1-alpha.5.1` |
| `0.2.1-alpha.1` | `0.2.1-alpha.1.6` |
| `0.2.0-rc.2` | `0.2.0-rc.2.3`, plus the two schedule companions described in the [initialization guide](https://github.com/benz-ai-x/dsh-24-PA/blob/main/docs/24PA-初始化指南.md) |

</details>

-----

<a id="use-this-package"></a>
## Package reference

### Configuration

Secrets live in the server environment or the workspace's private `.24pa/secrets.json` store; environment values take precedence. The workspace `AGENTS.md` holds one machine-checked JSON block with variable names, revalidated on reload — a bad block never replaces the effective configuration.

| Variable | Meaning |
|---|---|
| `PA24_PG_DSN` | PostgreSQL connection string; the ledger uses an isolated `pa24` schema |
| `PA24_WORKSPACE` | Absolute workspace directory bound on first start (or pick one in the panel / dsh settings) |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | Feishu custom-app credentials (feishu mode) |

`AGENTS.md` fields: `mode` (demo/feishu), `storage` (sqlite/postgres, default sqlite — the ledger is the workspace `data/pa24.db` file; SQLite uses the built-in `node:sqlite`, unflagged across this package's supported Node range; `postgres` requires `pgDsnEnv` and an external database), `larkProfile`, `ownerOpenId`, `folderToken`, `wikiNodeToken` (optional — memos and handwriting review docs land under this Feishu wiki node when set; empty falls back to folderToken), `tasklistId`, `calendarId`, `calendarChannel`/`todoChannel`/`notifyChannel` (feishu|wecom, default feishu — WeCom as the second operation channel for calendar/todo plus one-way reminder push, never inbound), `timeZone`, `appIdEnv`/`appSecretEnv`/`pgDsnEnv`, `maxWorkers`, `enabledWorkers`, `workerModels`, `extraBusinessSkills` (kebab-case allow list releasing workspace business skills to model-driven runs), `tts` (`engine` none/melo/volcengine, `voice`, `volcKeyEnv`, `meloDir` — voice digests via cloud Doubao TTS or local Melo), `extraLocalTools` (`subagent_codex`, `subagent_claude_code`, and QwenNote minutes tools via `mcp__qwennote__*` wildcard or precise names; entries naming unmounted tools are filtered out with a health note). For Feishu access setup, tell the local session「帮我接通飞书」or call `pa24_connection` with `action=guide`; the bundled `feishu-setup.md` is the single authority.

### Registered calendar and todo sources

The Calendar card (`日程`) reads saved observations; **Verify calendars** explicitly reads the platforms. In Parameter configuration → Calendar & todo sources, register each personal, company or project calendar, choose its visible scope, creation default, project/company mapping and optional meeting duration. Registration does not grant platform permissions. Conversations query all enabled registered calendars; creation selects one explicit source, mapping or default. Missing or ambiguous targets require clarification.

The `sources` object in the same AGENTS.md config block is authoritative. Without it, existing calendar/task-list fields yield stable migration candidates. Saving the source editor materializes those candidates; changing a legacy default through the form preserves the old source and adds the new default. An explicit empty registry stays empty. After a registry exists, change defaults there. Removing a source preserves remote objects and operation history. Pending operations retain their original identity and resource; an unknown result is never replayed as a new create.

Feishu reads native instances plus paginated participant/group evidence. WeCom currently uses the authorized scope and a ±30-day window; a named calendar container, complete organizer evidence, invite and personal-reminder edit remain adapter gaps, reported explicitly. WeCom changes require the original confirmed creation receipt. Actual device notification delivery needs real-account verification.

Todo sources use the same registry and evidence model. Queries aggregate enabled sources with per-source default roles (`all`, `responsible`, `following`, `assigned`, or `creator`); an explicit role overrides only that query. Creation selects one explicit, mapped, or default source, while completion, postponement, edits, and cancellation stay bound to the original platform object and source. Platform todo status remains distinct from assistant work-item execution.

Schema 20 adds source registrations, access evidence, platform objects, per-source observations and memberships to both ledgers. Stop the host and keep a joint pre-upgrade backup of the ledger, workspace identity/config and native session history. Restore the whole backup with the matching code to roll back; do not drop migration records or run old and new hosts against the same ledger. See the initialization guide for recovery steps.

### Exposing the tool

External CLI delegation rows ship enabled but stay dormant: `subagent_codex` and `subagent_claude_code` mount only after their provider bundles (`@deepseek-ai/dsh-subagent-codex` / `-claude-code`) are installed into the Profile, and the workspace must then opt in through `extraLocalTools`; entries naming tools that are not live are filtered before `tools.restrict()` runs and surface in maintenance health, so a missing provider or channel never breaks agent creation. QwenNote minutes tools pass the same gate from the host plane: add a `dsh-mcp-client` entry with `serverName: qwennote` (stdio + `mcp-remote` OAuth bridge, pinned version) to the Profile patch, complete the owner-browser authorization once, then opt in via `mcp__qwennote__*`. `ralph` is available to local sessions and follows its own tool contract: only on an explicit user request.

### What you get

- The「24私助」preset: standard plugin set (platform shell, fs, search, jobs, skill, skill-filesystem, tool-skill, goal, plan-mode, compaction, delegation, ask-user, todo, web, present, ralph) plus `pa24-agent`; persona text merged into the assistant identity; `tool-schedule` deliberately excluded — clock-type reminders ride native calendar events, with the ledger as backup record.
- Role-restricted tool surfaces: local sessions get the full standard base plus all `pa24_*` tools; the Feishu entry session and workers keep business-only whitelists (one preset never implies one permission set).
- The host plugin: fixed Feishu access and local sessions, the eight `pa24_*` business tools, SQLite-by-default ledger (optional PostgreSQL) with outbox delivery, task-skill runtime, calendar-native reminders, voice digests, handwriting review, and the sixteen-card web panel across Work & plans, Knowledge & materials, Connections & setup, and Operations & maintenance. Parameter configuration validates and rewrites the AGENTS.md block before reload; secrets use the write-only 0600 workspace store, environment values remain optional overrides, and health, budgets, and backups have their own operations cards. WeCom setup follows `wecom-setup.md` through `pa24_connection action=wecom_guide` / `wecom_check`.

### Failure and recovery

Digests and meeting prep on a dsh 0.2.0-rc.2 host report「当前 Host 未提供原生 Schedule 服务」until the schedule companions above are installed; the registry `dsh-schedule@0.2.0-rc.1` is peer-incompatible and its row stays disabled. An uninstalled external CLI provider keeps its tool absent rather than erroring. A second active pa24 Host against the same `$DSH_HOME/24pa` refuses startup by lock. A fresh Profile ships an unresolved `allowBuilds` placeholder for `protobufjs` (a transitive dependency of the Feishu SDK), so the first install exits nonzero until you set it to `true` in the Profile `pnpm-workspace.yaml`; the package is fully added either way. A lark-cli timeout settles as result-unknown — verify the real Feishu object before retrying; nothing is blindly re-executed.

The reliability update adds schema migration v14 on both storage backends. It
stores each digest WorkItem's trusted trigger and occurrence binding without
rewriting existing plans or reports. Stop the host and retain a verified backup
before upgrading. Scheduled work uses the host's original occurrence time;
manual work uses its recorded admission time. An old, unbound WorkItem without
verifiable trigger provenance remains available for inspection but must be
delegated again; its execution date is never substituted silently.

After interruption, a saved remote receipt permits local bookkeeping repair
without sending or creating the remote object again. An unacknowledged send or
external write remains `unknown` for reconciliation. Local results target the
original parent session. PostgreSQL connection changes require an explicit
workspace rebind; parameter and secret updates cannot silently move the ledger.
For rollback, stop the host first and keep the v14 ledger intact: the additional
table is non-destructive, but older code does not understand its recovery guards.
Reconcile unfinished operations before resuming them under an older release.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the assistant organizes work and where the observable behavior comes from; the consumer contract lives in [Use this package](#use-this-package).

### Design concept

- **One preset, many permission sets.** Every session composes the same「24私助」preset; role whitelists applied at agent creation decide the visible tools, so inheriting the preset never inherits maintenance authority (ADR-0001).
- **Calendars own clock-type reminders.** `tool-schedule` is excluded on purpose: clock-type reminders are written as calendar events with native alerts (per `calendarChannel`), firing even with 24私助 offline; the ledger keeps delegated backup rows for history and dedup (ADR-0001, revised 2026-10-18).
- **Material never becomes authorization.** Notes, documents, subagent replies, and fetched web content are inputs; only the owner's explicit instruction authorizes an external write. Secrets stay in the server environment or private workspace secret store and never enter AGENTS.md, prompts, or backups.

### Backup and recovery

`pa24_maintenance backup_create` copies the selected ledger and the workspace
`AGENTS.md`, `.24pa/` (excluding `secrets.json` and its atomic-write temporary
file `secrets.json.pa24-tmp`), and `.dsh/skills/`. It also
collects the plugin state and the host's sessions, storages, and attachments.
The bundle supplies `backupSessionsRoot`, `backupStoragesRoot`, and
`backupAttachmentsRoot` from `dshHomePath`; installations that override the
host's persistence paths must override these three roots to match. Choose a
backup destination outside every source directory. Symbolic links fail the
backup instead of following them into unrelated files.

SQLite uses the native online backup operation to produce one self-contained
`pa24.db` snapshot, even when a reader prevents a WAL checkpoint. PostgreSQL
continues to use `pg_dump`. The ledger is consistent; the other collections are
copied live and do not share a transaction timestamp with it. A snapshot or
target-write failure rejects backup creation and leaves the source unchanged.

Manticore adds durable `create`, `verify` and `restore_check` records (schema 31).
`backup_verify` checks file coverage and hashes, then opens an isolated ledger
and native Session provider to verify ownership, schema, relationships,
attachments, material snapshots, Skill packages and memory. Missing capability
is reported as unchecked. PostgreSQL uses a new local cluster and restricted
import role, never the production DSN. It requires local PostgreSQL tools with
`psql --restrict` support.

Format 4 fences backup workspaces against execution. Format 3 remains readable;
format-2 SQLite DB/WAL bundles cannot prove snapshot consistency. Separate
capture times are retained; verification does not certify a single global point
in time or remote platform content.

For guided recovery, call `backup_preview`, review memory conflicts and deletion
protection, then explicitly confirm `backup_restore_check` with its preview token
and a new isolated target. Current memory and the source backup remain unchanged.
The copy stays blocked from normal activation, even if copying fails. A passed
drill is **not production recovery**: credentials, remote objects, prior actions,
pending deliveries, plans, budget permits and native runs must be reconciled
before a separately authorized manual cutover. Follow the
[Manticore recovery guide](../../docs/Manticore-备份恢复.md). Do not remove the
isolation marker or downgrade the plugin to bypass reconciliation.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The Profile patch layer: preset row plus host plugin row |
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, runtime construction, panel |
| [`src/tools.ts`](src/tools.ts) | Tool registration, `STANDARD_CODING_TOOLS`, `ROLE_TOOLS` |
| [`src/prompts.ts`](src/prompts.ts) | Every built-in prompt with `PROMPTS_VERSION`, AGENTS.md template |
| [`src/runtime.ts`](src/runtime.ts) | Roles, delegation, ledger flows, reminders, digests, backup |
| [`src/feishu.ts`](src/feishu.ts) | SDK long-connection transport, access diagnostics, `setupNextSteps` |
| [`feishu-setup.md`](feishu-setup.md) | The bundled access-setup guide served by `pa24_connection guide` |

### Ledger ownership and upgrades

Schema 17 binds each ledger to the UUID in the workspace's
`.24pa/ledger-identity.json` and its registered owner. Runtime validates ownership
before schema migration, session preparation or business recovery. First claim
and migrations commit together: PostgreSQL uses a transaction advisory lock;
SQLite uses its write transaction. A competing workspace fails before business
writes. Each new workspace needs its own empty ledger, including when the same
owner uses two workspaces.

An empty legacy ledger may be enrolled. A populated legacy ledger requires one
recorded canonical workspace path matching the selected directory and exactly one
nonempty binding owner matching the configuration. Missing or mixed evidence is
rejected without migration; preserve an offline backup, inspect/export an isolated
copy and resolve ownership before retrying. Do not fabricate binding rows or clear
ownership metadata. An initially empty owner can be enrolled once; later owner
changes require a separate workspace/ledger rather than configuration reload.

Schema-17 backup verification requires a valid identity file in the copied workspace collection matching the ledger UUID recorded in the manifest. Missing, damaged or mismatched identity means incomplete backup.

Keep the identity file with the workspace and ledger backup. Moving or restoring
them preserves the logical workspace; explicitly rebind the destination after
stopping the original Host. Copying the identity denotes a restore of the same
workspace, not a new workspace, and does not permit multiple active Hosts. Restore
a missing/damaged identity from the same backup. Existing sessions, attachments
and external objects still need reconciliation. Older binaries do not enforce
schema-17 ownership: rollback requires stopping all Hosts and restoring the complete
pre-upgrade backup, not deleting the ownership row. Detailed inspection and export
steps are in the [initialization guide](../../docs/24PA-初始化指南.md), “工作区与账本归属”.

### Run flow

On start the host plugin takes a single-writer lock on `$DSH_HOME/24pa`, loads and validates the target workspace `AGENTS.md` and secret store, prepares the ledger (SQLite workspace file by default, or PostgreSQL), and establishes the fixed Feishu access and local sessions through the SessionController. Inbound Feishu events durably enter an inbox before acknowledgment, the coordinator delegates to workers through the continuable child API, and each item records its origin, parent, and delivery target. Ticks drain the outbox with receipts, fire due non-delegated reminder occurrences, verify published note fingerprints, and wake digest plans through the native Schedule service; results return to the entry that originated the work. At agent creation the role whitelist restricts the inherited tool catalog, and an `AGENTS.md` reload replaces the workspace-rules prompt section without touching the effective configuration on failure.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this bundle to the product it implements and the platform it plugs into.

- [Product spec](../../docs/24PA-v1-SPEC.md) — stories, scenarios, and test groups behind every delivered feature.
- [Overall design](../../docs/24PA-整体设计方案.md) — flows, session topology, and confirmed trade-offs.
- [ADR-0001](../../docs/adr/0001-workspace-session-boundaries.md) — the workspace/session permission boundary this preset enforces.
- [Research records](../../docs/research/) — per-feature verified contracts, including the dual-baseline and access-wizard studies.
- [Agent preset registry](https://github.com/benz-ai-x/dsh-24-PA) — repository, releases, and the delivery plan.

-----

<a id="model-experience"></a>
## Model Experience

### Assistant request

#### What the model sees

`pa24-agent` injects four ordered lead sections (identity and capability split, coordination, business domains, safety and reporting) plus the merged persona line; the workspace-rules section (order 910) carries `AGENTS.md` prose and stays empty until a workspace is bound. Workers receive four-part personas (职责/完成标准/边界/输出要求) instead.

##### Verbatim identity line (src/prompts.ts)

```markdown
统一提供助理协调、工作区维护和完整编程能力；按本会话实际可用的工具办理（身份与工作目录见系统提示开头）。
```

#### Token effect

Fixed per role after workspace bind; the workspace-rules section is conditional (empty until bound) and is replaced, not extended, on reload.

#### KV Cache effect

Stable repeated prefix within a session: an `AGENTS.md` reload replaces the rules section and invalidates reuse from that request on, while a `PROMPTS_VERSION` bump invalidates across deployments. Nothing else in this bundle rewrites the earlier prefix.

### Role-restricted tool catalog

#### What the model sees

Eight `pa24_*` schemas with fixed JSON parameters, plus the role restriction applied to the inherited catalog: the Feishu entry sees exactly its five business tools, workers exactly `pa24_work` and read-only `pa24_memory`, local sessions the full standard base plus all `pa24_*` tools.

#### Token effect

Fixed catalog per role for the session lifetime; `extraLocalTools` extends the local allow list only, and host-plane additions from other bundles (for example `schedule_*`) are outside this bundle's allow list.

#### KV Cache effect

Append-only: the catalog is constant across one session's requests, so conversation growth never rewrites the prefix; changing the workspace `extraLocalTools`, the preset composition, or upgrading the package invalidates reuse.

Indirectly, through the preset rows this bundle composes, each inserted standard package owns its own tool descriptions and prompt contributions.

## Plan and reminder recovery

Schema migration 15 adds the delegated skill selection and validated definition, plus a native-plan mutation record and revision. SQLite and PostgreSQL apply the same additive migration. Existing WorkItems without a validated skill definition require a new delegation; existing completed history is retained.

A calendar reminder records its original channel, calendar, time, and operation identity before writing remotely. Retrying a failed local backup repairs that backup using the recorded receipt. WeCom daily/weekly reminders submit recurrence, the IANA time zone and a five-minute reminder explicitly. Feishu reminders use the native events-create command because the shortcut drops the IANA time zone. These contracts were checked against lark-cli 1.0.87 and WeCom CLI 1.3.4; phone delivery and server-side DST expansion still require tenant verification.

Native plans record an intent before calling Schedule. Pause/stop blocks business delivery first; a failed delete keeps its native ID for cleanup after restart. A lost create/update reply is reconciled using the original session and unique instruction marker, including inactive one-off plans. Zero or multiple matches remain visibly pending in the plans view and `digest_list`; they are not blindly recreated. Safe adjustment requires Host `catalog` and `update` support. If unavailable or conflicted, use the original native plan to verify the state, then explicitly pause/stop or adjust through 24PA.

Before upgrading, create the joint workspace/ledger/Host backup described by the initialization guide. Before rolling back, resolve pending plan changes and confirm native IDs agree with the ledger; an older package cannot interpret pending mutation records. Keep the additive columns when rolling back code, and restore paired Host and business-ledger backups together when restoring data.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this assistant needs special operational care. They are current package constraints, not a general Feishu comparison or a task backlog.

- **Environment-specific verification remains** — real Manticore account roles, broader tenant/Lark-region compatibility, actual device reminder delivery, QwenNote hardware, and vendor-bill reconciliation require verification in the deployment environment. See the [Manticore acceptance record](../../docs/planning/24PA-Manticore-交付验收.md).
- **Handwriting recognition quality is unquantified** — multi-page transcription fidelity needs a 30–50 page real-sample evaluation before any accuracy claim; the visual route must be configured in `workerModels`.
- **dsh 0.2.0-rc.2 hosts ship no schedule service** — digests and meeting prep stay honestly unavailable until the schedule companions are installed, and the host-plane `schedule_*` tools those companions add cannot be hidden by preset restriction.
- **External CLI delegation is dormant by default** — `subagent_codex`/`subagent_claude_code` mount only after their provider bundles are installed and `extraLocalTools` opts in; unconfigured tools stay absent rather than erroring.
- **One writer per state directory** — a second active pa24 Host against the same `$DSH_HOME/24pa` refuses startup by lock; run one host per state directory.
- **Desktop-only management UI** — the panel is designed and verified for computer viewports, not a mobile-responsive product; native Feishu and WeCom apps retain their own platform behavior.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers. Shipped behavior and limits live in the sections above and in the package code; historical verification counts belong to their dated evidence records rather than this living document.

- **Multi-baseline verification** — the active release line is 0.2.1-rc.3. Regression runs select the runtime with `DSH_BIN` and append the 0.2.0-rc.2 schedule companions with `PA24_E2E_EXTRA_PLUGINS`; older baselines retain their documented compatibility paths.
- **Preset patch is generated** — `cordis.patch.yml` is produced by `scripts/sync-preset.mjs` from the `@deepseek-ai/dsh-web-app` standard preset pinned as a devDependency; never edit it by hand. On a new dsh baseline, bump the pin and run `npm run preset:sync`; `npm run preset:check` and unit tests fail when the checked-in copy drifts.
- **Local harness adjacency** — dev type-checking links vendored peers from an adjacent `deepseek-harness` checkout through `scripts/link-peer.mjs`; registry installs never depend on that checkout.

</details>

### Original-turn settlement recovery

From schema 18, each Worker input has a durable execution identity saved before native admission. A completed turn whose result transaction fails is automatically retried with bounded backoff (up to 30 seconds between retries). The result and its Outbox intent commit together; neither the model nor the external action is called again for settlement. A committed transaction with a lost acknowledgement also releases waiting capacity on reconciliation.

Restart recovery checks the original workspace, parent/child Session, generation, actually consumed input and completed turn in the host's persisted history. Keep the business ledger **and native Session history** together in backups. Missing, mismatched or interrupted history is shown as `needs_reconciliation`; inspect the original result and external objects before explicitly stopping or continuing. A temporary history-read failure remains pending and is retried. Legacy work without the new input identity retains the previous generation-incrementing recovery path and asks the Worker to verify prior effects.

The native flush checkpoint must succeed; `false` or a failure does not prove durability. Older hosts without a public cold-history reader can finish live work after a successful checkpoint, but unverified cold recovery requires reconciliation. No private Session file format is written by 24PA. To roll back, stop the Host and restore the complete pre-upgrade ledger, workspace and Session backup with the corresponding old version; older code may resume work that this version would settle without re-execution.

### Recovering authorized candidate actions

Minutes and reviewed-note candidate retries retain their original channel, calendar/task list, authorization and receipt format. Changing channel preferences only affects new candidates. An acknowledged remote creation can repair its local projection after restart without a second write. Unknown remote outcomes or legacy records without enough original identity require reconciliation; do not switch preferences to force another creation. No schema migration is required for this change.

Reviewed-note summaries and actions now require a proof binding the structured content to the fetched document snapshot. If the document was edited before its first readback, or a body-only revision was republished, old summaries, candidates and doubts are cleared. The review card explicitly offers body-only approval until those fields are rebuilt and reviewed. Historical approvals without this proof remain recorded, but cannot authorize old candidates or contribute derived facts to search and digests. Reorganize the current document into a new reviewed version before selecting actions; approval never executes actions by itself.

Review tokens also bind the approval scope. An outstanding card from an older version of the plugin is replaced when refreshed or clicked; its old button cannot make a new decision. Already recorded decisions remain historical evidence. These changes use existing JSON/text columns without a schema migration. Downgrading to a build without these checks reopens the provenance and channel-recovery defects.

## Manticore Skill catalog and packages (M01a/M01b)

Open **Work & plans → Skill management** to browse built-in originals, discovered workspace skills, and managed packages. Same-name originals and workspace entries stay separate; copying or explicit updating never silently overwrites the original. Discovery reports its actual completeness, and a loaded definition does not prove dependency or execution readiness.

Create a draft, edit `SKILL.md`, or import Markdown/ZIP with `scripts`, `references`, and `assets`. The complete package tree and read-only file preview come from the same immutable version or captured snapshot; viewing files never executes scripts, installs dependencies, or starts a model. Download either the instruction Markdown or the complete ZIP package. Credentials, plan parameters, and run history are not exported as package resources.

Managed versions are immutable and runs keep their original package snapshot. Disable blocks new runs and pauses linked plans; re-enabling does not silently resume those plans. Rollback affects subsequent runs, while deleted packages retain their historical versions and run records. Preview parameters, version, resources, and tools before a test or real run; both can execute approved tools, and results are saved without automatic external delivery by default.

## Manticore schedules and run history (M02)

Open **Work & plans → Scheduled tasks** to create a blank plan or use a morning/evening/weekly preset. Enter a skill, parameters, a time rule and a fixed time zone; preview future occurrences before saving the plan paused. **Verify and enable** shows the tools, package resources, business targets and owner delivery being authorized. Changing defaults does not rebind an existing plan. Pause before editing; in-flight runs retain their input snapshots. A verified plan can run once while paused without enabling future occurrences.

Pause cancels future and not-yet-started work. Stop and delete are separate choices; deletion offers waiting for active runs or stopping them first, and preserves history. Restoring a recycled plan leaves it paused pending verification. Existing digest plans have an explicit migration preview; their original schedule identity and historical reports remain intact.

**Run history** separates executions, work items, unexecuted trigger events and legacy reports. Filters and pagination use the full ledger; unresolved records can remain visible outside the selected date range. Execution and delivery statuses are independent. Retry delivery sends the original result without rerunning the skill; unknown delivery requires a recorded platform check first. Download a single result or all filtered records. Diagnostic downloads require a preview and omit input, result text, recipient details, workspace paths and credentials. Detailed diagnostics default to 90 days (`diagnosticRetentionDays`, 1–3650); business snapshots, results and receipts do not expire under that setting.

### Manticore model usage and budgets

Open **Operations & maintenance → Models & budgets** to inspect actual models, accounting periods, tokens, unsettled requests, and estimation evidence for managed Skills and ordinary work items in this workspace. Opening or refreshing reads the ledger and does not call a model. Free chat, external CLI delegation, TTS, and pre-upgrade requests are outside this coverage. Missing usage or prices are shown as unknown; process counters and estimates are not vendor bills.

**Set budgets & models** opens the budget section of the parameter form. Choose daily or monthly accounting in the workspace time zone and configure request, token, estimated-cost, and warning thresholds. Blank means unlimited; zero pauses new managed requests. Optional prices are recorded per provider/model and million tokens for uncached input, output, cache reads, and cache writes with a verifiable source. Historical charges keep the price saved at request time.

When a limit is reached, the original input, progress, and independent blocker are preserved. Review the original session and run, then prepare and explicitly confirm a scoped one-run permit. It authorizes only the next model request in that session; a retry consumes another permit. Native child sessions show their own waits, while input, authorization, dependency, stop, timeout, and the owner's pause on future plans remain in force. Already dispatched requests may continue to accrue charges; native calendar reminders, result saving, and delivery continue.

Migration 30 appends the budget ledger and complete-input fields with unlimited defaults. Keep the migrated ledger when rolling back application code; do not delete budget rows manually to bypass a limit or resume a run. See the [budget and input-recovery contract](../../docs/research/2026-10-23-Manticore-M08预算与输入恢复契约.md) for evidence, recovery, and acceptance boundaries.
