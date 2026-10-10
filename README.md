---
description: "Feishu-backed personal-assistant profile bundle for dsh: one 24私助 preset carrying the full standard tool base plus ledger-driven business workers, reminders, handwriting review, and a staged access-setup wizard."
kind: "package-bundle"
---

# @benz-ai-x/dsh-24pa

English | [中文](README.zh.md)

## Summary

Install `@benz-ai-x/dsh-24pa` into a Profile to gain the「24私助」assistant preset and its host plugin: a Feishu plus local dual-entry coordinator delegating to six business workers, with a PostgreSQL ledger for items, reminders, handwritten-note review, digests, and delivery receipts. The preset carries the standard-mode tool base restricted per role, so the local session programs while the Feishu entry and workers keep business-only whitelists. Versions follow the dsh baseline (`<dsh version>.<serial>`) and support dsh `0.2.0-rc.2`, `0.2.1-alpha.1`, and `0.2.1-alpha.2`.

## FAQ

**What is 24私助 (24PA)?** — A Feishu personal-assistant plugin for dsh, shipped as a profile bundle: local dsh sessions and a Feishu bot coordinate six business workers over a PostgreSQL ledger — tasks, calendar, reminders, memos, digests, and handwritten-note review.

**Which dsh runtimes are supported?** — dsh `0.2.0-rc.2`, `0.2.1-alpha.1`, and `0.2.1-alpha.2`; versions are named `<dsh baseline>.<serial>` and npm dist-tags track baselines.

**How do I install it?** — `dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@<baseline serial>`, then restart the profile (see [Installing the Bundle](#installing-the-bundle)).

**Do reminders require the model to be online?** — No: reminders fire from PostgreSQL occurrence rows through the outbox, so fixed reminders deliver while the model is offline.

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

# dsh 0.2.1-alpha.2 host (preset synced to standard.patch.yml of that baseline;
# the peer check rejects cross-baseline installs, so alpha.2 hosts need this line)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.2.1

# dsh 0.2.0-rc.2 host — line frozen at 0.2.0-rc.2.3, no further releases (also add the two schedule companions for digests)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.0-rc.2.3
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-schedule-bundle
dsh plugin --profile <name> add <rc.2 harness checkout>/packages/schedule/schedule

dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa
```

Removal withdraws the preset and host plugin on the next Profile start; PostgreSQL data, dsh sessions, and the workspace directory are untouched. Version naming follows `<dsh baseline version>.<serial>`; npm dist-tags track baselines (`dsh-0.2.0-rc.2`, `dsh-0.2.1-alpha.1`, `dsh-0.2.1-alpha.2`).

### Configuration

Secrets live only in the server environment; the workspace `AGENTS.md` holds one machine-checked JSON block with variable names, revalidated on reload — a bad block never replaces the effective configuration.

| Variable | Meaning |
|---|---|
| `PA24_PG_DSN` | PostgreSQL connection string; the ledger uses an isolated `pa24` schema |
| `PA24_WORKSPACE` | Absolute workspace directory bound on first start (or pick one in the panel / dsh settings) |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | Feishu custom-app credentials (feishu mode) |

`AGENTS.md` fields: `mode` (demo/feishu), `larkProfile`, `ownerOpenId`, `folderToken`, `tasklistId`, `calendarId`, `calendarChannel`/`todoChannel`/`notifyChannel` (feishu|wecom, default feishu — WeCom as the second operation channel for calendar/todo plus one-way reminder push, never inbound), `timeZone`, `appIdEnv`/`appSecretEnv`/`pgDsnEnv`, `maxWorkers`, `enabledWorkers`, `workerModels`, `extraLocalTools` (closed enum). For Feishu access setup, tell the local session「帮我接通飞书」or call `pa24_connection` with `action=guide`; the bundled `feishu-setup.md` is the single authority.

### Exposing the tool

External CLI delegation rows ship enabled but stay dormant: `subagent_codex` and `subagent_claude_code` mount only after their provider bundles (`@deepseek-ai/dsh-subagent-codex` / `-claude-code`) are installed into the Profile, and the workspace must then opt in through `extraLocalTools`, because `tools.restrict()` rejects allow-listed names that are not live tools. `ralph` is available to local sessions and follows its own tool contract: only on an explicit user request.

### What you get

- The「24私助」preset: standard plugin set (platform shell, fs, search, jobs, skill, goal, plan-mode, compaction, delegation, ask-user, todo, web, present, ralph) plus `pa24-agent`; persona text merged into the assistant identity; `tool-schedule` deliberately excluded — reminders stay on the ledger.
- Role-restricted tool surfaces: local sessions get the full standard base plus all `pa24_*` tools; the Feishu entry session and workers keep business-only whitelists (one preset never implies one permission set).
- The host plugin: fixed Feishu access and local sessions, `pa24_delegate`/`pa24_jobs`/`pa24_notes`/`pa24_memory`/`pa24_maintenance`/`pa24_workspace`/`pa24_connection`/`pa24_work`, PostgreSQL ledger with outbox delivery and offline-capable reminders, handwriting review cards, digests, backup/health, the web panel, and a「24私助」section in the dsh settings modal for workspace binding, AGENTS.md reload, and effective-config review (the sidebar panel stays). WeCom access setup follows the bundled `wecom-setup.md` via `pa24_connection action=wecom_guide` / `wecom_check`.

### Failure and recovery

Digests and meeting prep on a dsh 0.2.0-rc.2 host report「当前 Host 未提供原生 Schedule 服务」until the schedule companions above are installed; the registry `dsh-schedule@0.2.0-rc.1` is peer-incompatible and its row stays disabled. An uninstalled external CLI provider keeps its tool absent rather than erroring. A second active pa24 Host against the same `$DSH_HOME/24pa` refuses startup by lock. A fresh Profile ships an unresolved `allowBuilds` placeholder for `protobufjs` (a transitive dependency of the Feishu SDK), so the first install exits nonzero until you set it to `true` in the Profile `pnpm-workspace.yaml`; the package is fully added either way. A lark-cli timeout settles as result-unknown — verify the real Feishu object before retrying; nothing is blindly re-executed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the assistant organizes work and where the observable behavior comes from; the consumer contract lives in [Use this package](#use-this-package).

### Design concept

- **One preset, many permission sets.** Every session composes the same「24私助」preset; role whitelists applied at agent creation decide the visible tools, so inheriting the preset never inherits maintenance authority (ADR-0001).
- **The ledger is the reminder authority.** `tool-schedule` is excluded on purpose: reminders occur from PostgreSQL occurrence rows through the outbox, so they fire with the model offline and every delivery keeps a receipt.
- **Material never becomes authorization.** Notes, documents, subagent replies, and fetched web content are inputs; only the owner's explicit instruction authorizes an external write, and secrets are referenced by environment variable name only.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](packages/24pa/cordis.patch.yml) | The Profile patch layer: preset row plus host plugin row |
| [`src/index.ts`](packages/24pa/src/index.ts) | Plugin entry: config schema, runtime construction, panel |
| [`src/tools.ts`](packages/24pa/src/tools.ts) | Tool registration, `STANDARD_CODING_TOOLS`, `ROLE_TOOLS` |
| [`src/prompts.ts`](packages/24pa/src/prompts.ts) | Every built-in prompt with `PROMPTS_VERSION`, AGENTS.md template |
| [`src/runtime.ts`](packages/24pa/src/runtime.ts) | Roles, delegation, ledger flows, reminders, digests, backup |
| [`src/feishu.ts`](packages/24pa/src/feishu.ts) | SDK long-connection transport, access diagnostics, `setupNextSteps` |
| [`feishu-setup.md`](packages/24pa/feishu-setup.md) | The bundled access-setup guide served by `pa24_connection guide` |

### Run flow

On start the host plugin takes a single-writer lock on `$DSH_HOME/24pa`, connects PostgreSQL, loads and validates the workspace `AGENTS.md`, and establishes the fixed Feishu access and local sessions through the SessionController. Inbound Feishu events durably enter an inbox before acknowledgment, the coordinator delegates to workers through the continuable child API, and each item records its origin, parent, and delivery target. Ticks drain the outbox with receipts, fire due reminder occurrences, verify published note fingerprints, and wake digest plans through the native Schedule service; results return to the entry that originated the work. At agent creation the role whitelist restricts the inherited tool catalog, and an `AGENTS.md` reload replaces the workspace-rules prompt section without touching the effective configuration on failure.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this bundle to the product it implements and the platform it plugs into.

- [Product spec](docs/24PA-v1-SPEC.md) — stories, scenarios, and test groups behind every delivered feature.
- [Overall design](docs/24PA-整体设计方案.md) — flows, session topology, and confirmed trade-offs.
- [ADR-0001](docs/adr/0001-workspace-session-boundaries.md) — the workspace/session permission boundary this preset enforces.
- [Research records](docs/research/) — per-feature verified contracts, including the dual-baseline and access-wizard studies.
- [Delivery plan](docs/planning/24PA-v1-PR交付计划.md) — feature groups, dependencies, and merge criteria.

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

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this assistant needs special operational care. They are current package constraints, not a general Feishu comparison or a task backlog.

- **Real Feishu tenants are untested** — long-connection, dual identities, and token renewal were verified against a stubbed Feishu side; the first real integration may surface wire differences, and console permission scope names are keyword-based pending on-console verification.
- **Handwriting recognition quality is unquantified** — multi-page transcription fidelity needs a 30–50 page real-sample evaluation before any accuracy claim; the visual route must be configured in `workerModels`.
- **dsh 0.2.0-rc.2 hosts ship no schedule service** — digests and meeting prep stay honestly unavailable until the schedule companions are installed, and the host-plane `schedule_*` tools those companions add cannot be hidden by preset restriction.
- **External CLI delegation is dormant by default** — `subagent_codex`/`subagent_claude_code` mount only after their provider bundles are installed and `extraLocalTools` opts in; unconfigured tools stay absent rather than erroring.
- **One writer per state directory** — a second active pa24 Host against the same `$DSH_HOME/24pa` refuses startup by lock; run one host per state directory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Multi-baseline verification** — regression runs select the runtime with `DSH_BIN` and append the rc.2 schedule companions with `PA24_E2E_EXTRA_PLUGINS`; the active baseline is 0.2.1-alpha.2 plain (156/156), while 0.2.0-rc.2 and 0.2.1-alpha.1 remain covered by the dual-API fallback paths.
- **Local harness adjacency** — dev type-checking links vendored peers from an adjacent `deepseek-harness` checkout through `scripts/link-peer.mjs`; registry installs never depend on that checkout.

</details>
