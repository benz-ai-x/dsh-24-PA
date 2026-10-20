---
description: "Feishu-backed personal-assistant profile bundle for dsh: one 24私助 preset carrying the full standard tool base plus a SQLite-by-default ledger, seven business workers, task skills, voice digests, calendar-native reminders, handwriting review, and a staged access-setup wizard."
kind: "package-bundle"
---

# @benz-ai-x/dsh-24pa

English | [中文](README.zh.md)

## Summary

Install `@benz-ai-x/dsh-24pa` into a Profile to gain the「24私助」assistant preset and its host plugin: a Feishu plus local dual-entry coordinator delegating to seven business workers over a SQLite-by-default ledger (workspace `data/pa24.db`; optional PostgreSQL) for items, handwritten-note review, digests, and delivery receipts. Behavior ships as task skills — built-in plus workspace-customizable (`<workspace>/.dsh/skills/`, hot-reloaded), each declaring a deterministic template track or a model-executed track — covering voice digests and calendar-native clock reminders that fire from the Feishu/WeCom app with the host offline. The preset carries the standard-mode tool base restricted per role, so the local session programs while the Feishu entry and workers keep business-only whitelists. Versions follow the dsh baseline (`<dsh version>.<serial>`) and support dsh `0.2.0-rc.2`, `0.2.1-alpha.1`–`0.2.1-alpha.5`, `0.2.1-rc.1`–`0.2.1-rc.2`.

## FAQ

**What is 24私助 (24PA)?** — A Feishu personal-assistant plugin for dsh, shipped as a profile bundle: local dsh sessions and a Feishu bot coordinate seven business workers over a SQLite-by-default ledger — tasks, calendar, memos, digests, handwriting review, and a skill runner — while clock-type reminders ride native calendar events.

**Which dsh runtimes are supported?** — dsh `0.2.0-rc.2`, `0.2.1-alpha.1`–`0.2.1-alpha.5`, `0.2.1-rc.1`–`0.2.1-rc.2`; versions are named `<dsh baseline>.<serial>` and npm dist-tags track baselines.

**How do I install it?** — `dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@<baseline serial>`, then restart the profile (see [Installing the Bundle](#installing-the-bundle)).

**Do reminders require the model to be online?** — No. Clock-type reminders are written as calendar events with native app alerts (Feishu or WeCom, per `calendarChannel`) — they fire with both the model and the 24私助 host offline; the ledger keeps a delegated backup row. Follow-up and conditional reminders run as agent-track skills.

**Can I add or change routines without touching plugin code?** — Yes: periodic tasks, worker personas, access wizards, and workflows all ship as task skills. Drop a `<name>.md` into the workspace `.dsh/skills/` directory (picked up hot) or rebind from the panel's plan cards; each skill declares a deterministic template track or a model-executed track with completion criteria, and can only tighten — never loosen — tool permissions.

**How do I connect Feishu?** — Tell the local 24私助 session「帮我接通飞书」; the built-in wizard (`pa24_connection` `guide`, and `check` with `nextSteps`) walks app creation, authorization, resource ids, and health checks. The Feishu entry session can also run this read-only wizard and `wecom_guide`/`wecom_check` for channel diagnostics; configuration writes stay local-only (ADR-0001).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Installing the Bundle

Pick the release matching your dsh runtime, then restart the Profile. The reconcile step activates the patch layer (one assistant preset row plus the host plugin row) for exactly this `dsh.bundle` declaration.

```sh
# dsh 0.2.1-alpha.1 host (schedule service built in)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.1.6

# dsh 0.2.1-alpha.2 – 0.2.1-rc.2 hosts (peers span these baselines; rc.2 is the active release line)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-rc.2.9

# alpha.2 – alpha.5 hosts may also pin the alpha line (frozen at 0.2.1-alpha.5.1; preset content identical, only engines/peer range and docs differ)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.5.1

# dsh 0.2.0-rc.2 host — line frozen at 0.2.0-rc.2.3, no further releases (also add the two schedule companions for digests)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.0-rc.2.3
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-schedule-bundle
dsh plugin --profile <name> add <rc.2 harness checkout>/packages/schedule/schedule

dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa
```

Removal withdraws the preset and host plugin on the next Profile start; PostgreSQL data, dsh sessions, and the workspace directory are untouched. Version naming follows `<dsh baseline version>.<serial>`; npm dist-tags track baselines (`dsh-0.2.0-rc.2`, `dsh-0.2.1-alpha.1`, `dsh-0.2.1-alpha.2`, `dsh-0.2.1-alpha.5`, `dsh-0.2.1-rc.1`, `dsh-0.2.1-rc.2`).

### Configuration

Secrets live in the server environment or the workspace's private `.24pa/secrets.json` store; environment values take precedence. The workspace `AGENTS.md` holds one machine-checked JSON block with variable names, revalidated on reload — a bad block never replaces the effective configuration.

| Variable | Meaning |
|---|---|
| `PA24_PG_DSN` | PostgreSQL connection string; the ledger uses an isolated `pa24` schema |
| `PA24_WORKSPACE` | Absolute workspace directory bound on first start (or pick one in the panel / dsh settings) |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | Feishu custom-app credentials (feishu mode) |

`AGENTS.md` fields: `mode` (demo/feishu), `storage` (sqlite/postgres, default sqlite — the ledger is the workspace `data/pa24.db` file; SQLite uses the built-in `node:sqlite`, unflagged across this package's supported Node range; `postgres` requires `pgDsnEnv` and an external database), `larkProfile`, `ownerOpenId`, `folderToken`, `wikiNodeToken` (optional — memos and handwriting review docs land under this Feishu wiki node when set; empty falls back to folderToken), `tasklistId`, `calendarId`, `calendarChannel`/`todoChannel`/`notifyChannel` (feishu|wecom, default feishu — WeCom as the second operation channel for calendar/todo plus one-way reminder push, never inbound), `timeZone`, `appIdEnv`/`appSecretEnv`/`pgDsnEnv`, `maxWorkers`, `enabledWorkers`, `workerModels`, `extraBusinessSkills` (kebab-case allow list releasing workspace business skills to model-driven runs), `tts` (`engine` none/melo/volcengine, `voice`, `volcKeyEnv`, `meloDir` — voice digests via cloud Doubao TTS or local Melo), `extraLocalTools` (`subagent_codex`, `subagent_claude_code`, and QwenNote minutes tools via `mcp__qwennote__*` wildcard or precise names; entries naming unmounted tools are filtered out with a health note). For Feishu access setup, tell the local session「帮我接通飞书」or call `pa24_connection` with `action=guide`; the bundled `feishu-setup.md` is the single authority.

### Exposing the tool

External CLI delegation rows ship enabled but stay dormant: `subagent_codex` and `subagent_claude_code` mount only after their provider bundles (`@deepseek-ai/dsh-subagent-codex` / `-claude-code`) are installed into the Profile, and the workspace must then opt in through `extraLocalTools`; entries naming tools that are not live are filtered before `tools.restrict()` runs and surface in maintenance health, so a missing provider or channel never breaks agent creation. QwenNote minutes tools pass the same gate from the host plane: add a `dsh-mcp-client` entry with `serverName: qwennote` (stdio + `mcp-remote` OAuth bridge, pinned version) to the Profile patch, complete the owner-browser authorization once, then opt in via `mcp__qwennote__*`. `ralph` is available to local sessions and follows its own tool contract: only on an explicit user request.

### What you get

- The「24私助」preset: standard plugin set (platform shell, fs, search, jobs, skill, skill-filesystem, tool-skill, goal, plan-mode, compaction, delegation, ask-user, todo, web, present, ralph) plus `pa24-agent`; persona text merged into the assistant identity; `tool-schedule` deliberately excluded — clock-type reminders ride native calendar events, with the ledger as backup record.
- Role-restricted tool surfaces: local sessions get the full standard base plus all `pa24_*` tools; the Feishu entry session and workers keep business-only whitelists (one preset never implies one permission set).
- The host plugin: fixed Feishu access and local sessions, `pa24_delegate`/`pa24_jobs`/`pa24_notes`/`pa24_memory`/`pa24_maintenance`/`pa24_workspace`/`pa24_connection`/`pa24_work`, the SQLite-by-default ledger (optional PostgreSQL) with outbox delivery, the task-skill runtime (built-in plus workspace `.dsh/skills/`), calendar-native clock reminders, voice-capable digests, handwriting review cards, backup/health, the web panel (whose System category carries a parameter-configuration form: validate → rewrite the AGENTS.md config block → reload, with chat and the form sharing one config source; secrets are written via the Secrets group into a 0600 workspace store — write-only in the UI, env vars become optional overrides, and AGENTS.md/system prompts/backups never contain secret values), with workspace binding, switching, AGENTS.md reload, effective-config review, and health & budget living on the panel's System category under the Workspace & config card. WeCom access setup follows the bundled `wecom-setup.md` via `pa24_connection action=wecom_guide` / `wecom_check`.

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
- **Material never becomes authorization.** Notes, documents, subagent replies, and fetched web content are inputs; only the owner's explicit instruction authorizes an external write, and secrets are referenced by environment variable name only.

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

`backup_verify` checks the ledger, collection coverage, each listing's own
hash, and every listed file. Missing required collections, modified listings,
missing content, and old manifests without coverage evidence cannot pass as a
complete joint backup. An absent, configured attachment directory is recorded
explicitly when the host has not stored attachments yet.
Format 3 records the ledger snapshot guarantee. Old format-2 SQLite DB/WAL
bundles cannot prove it and no longer pass verification: keep those files for
recovery investigation and create a fresh backup before an upgrade. Existing
format-2 PostgreSQL dumps with complete collection coverage remain verifiable.
Older plugin versions cannot verify format 3; use this version to verify a new
bundle before any code rollback. The ledger schema is unchanged by this fix.

To restore, stop the host and verify the backup. First restore the ledger and
collections into isolated staging directories: load `pa24.sql` into a separate
database with psql, or copy the snapshot `pa24.db` into an empty, separate
`data/` directory, without a live or old `pa24.db-wal`/`pa24.db-shm` alongside it.
Check the schema and each memory record's revision,
source and expiry against the existing destination before replacing any files.
Keep newer destination memory; resolve conflicts with the owner explicitly.
Only then install the verified ledger and collections at their configured roots,
retaining the previous directories for rollback, and re-enter credentials
separately. Do not copy a live `host.lock`. Before resuming writes or sending old
notifications, reconcile external objects and unknown Outbox rows. These are
online file snapshots, not a cross-system transaction; check the restored
ledger, sessions and attachments together before restarting.

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

### Run flow

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
steps are in `docs/24PA-初始化指南.md`, “工作区与账本归属”.

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

- **Real-tenant operation is single-instance so far** — long-connection, identity, and renewal paths now run on one production Feishu tenant (WeCom channels and voice digests included); broader tenant and zone compatibility remains untested, and console permission scope names are keyword-based pending on-console verification.
- **Handwriting recognition quality is unquantified** — multi-page transcription fidelity needs a 30–50 page real-sample evaluation before any accuracy claim; the visual route must be configured in `workerModels`.
- **dsh 0.2.0-rc.2 hosts ship no schedule service** — digests and meeting prep stay honestly unavailable until the schedule companions are installed, and the host-plane `schedule_*` tools those companions add cannot be hidden by preset restriction.
- **External CLI delegation is dormant by default** — `subagent_codex`/`subagent_claude_code` mount only after their provider bundles are installed and `extraLocalTools` opts in; unconfigured tools stay absent rather than erroring.
- **One writer per state directory** — a second active pa24 Host against the same `$DSH_HOME/24pa` refuses startup by lock; run one host per state directory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Multi-baseline verification** — regression runs select the runtime with `DSH_BIN` and append the rc.2 schedule companions with `PA24_E2E_EXTRA_PLUGINS`; the active release line is 0.2.1-rc.2 with the full suite at 258/258, while 0.2.0-rc.2 and 0.2.1-alpha.1 remain covered by the dual-API fallback paths.
- **Preset patch is generated** — `cordis.patch.yml` is produced by `scripts/sync-preset.mjs` from the `@deepseek-ai/dsh-web-app` standard preset pinned as a devDependency; never edit it by hand. On a new dsh baseline, bump the pin and run `npm run preset:sync`; `npm run preset:check` and unit tests fail when the checked-in copy drifts.
- **Local harness adjacency** — dev type-checking links vendored peers from an adjacent `deepseek-harness` checkout through `scripts/link-peer.mjs`; registry installs never depend on that checkout.

</details>

### Original-turn settlement recovery

From schema 18, each Worker input has a durable execution identity saved before native admission. A completed turn whose result transaction fails is automatically retried with bounded backoff (up to 30 seconds between retries). The result and its Outbox intent commit together; neither the model nor the external action is called again for settlement. A committed transaction with a lost acknowledgement also releases waiting capacity on reconciliation.

Restart recovery checks the original workspace, parent/child Session, generation, actually consumed input and completed turn in the host's persisted history. Keep the business ledger **and native Session history** together in backups. Missing, mismatched or interrupted history is shown as `needs_reconciliation`; inspect the original result and external objects before explicitly stopping or continuing. A temporary history-read failure remains pending and is retried. Legacy work without the new input identity retains the previous generation-incrementing recovery path and asks the Worker to verify prior effects.

The native flush checkpoint must succeed; `false` or a failure does not prove durability. Older hosts without a public cold-history reader can finish live work after a successful checkpoint, but unverified cold recovery requires reconciliation. No private Session file format is written by 24PA. To roll back, stop the Host and restore the complete pre-upgrade ledger, workspace and Session backup with the corresponding old version; older code may resume work that this version would settle without re-execution.
