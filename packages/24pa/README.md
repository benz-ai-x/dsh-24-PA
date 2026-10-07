---
description: "Feishu-backed personal-assistant profile bundle for dsh: one 24私助 preset carrying the full standard tool base plus ledger-driven business workers, reminders, handwriting review, and a staged access-setup wizard."
kind: "package-bundle"
---

# @benz-ai-x/dsh-24pa

English | [中文](README.zh.md)

## Summary

Install `@benz-ai-x/dsh-24pa` into a Profile to gain the「24私助」assistant preset and its host plugin: a Feishu plus local dual-entry coordinator delegating to six business workers, with a PostgreSQL ledger for items, reminders, handwritten-note review, digests, and delivery receipts. The preset carries the standard-mode tool base restricted per role, so the local session programs while the Feishu entry and workers keep business-only whitelists. Versions follow the dsh baseline (`<dsh version>.<serial>`) and support dsh `0.2.0-rc.2` and `0.2.1-alpha.1`.

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

### Install into a profile

Pick the release matching your dsh runtime, then restart the profile. The reconcile step activates the patch layer (one assistant preset row plus the host plugin row) for exactly this `dsh.bundle` declaration.

```sh
# dsh 0.2.1-alpha.1 host (schedule service built in)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.1.2

# dsh 0.2.0-rc.2 host (also add the two schedule companions for digests)
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.0-rc.2.1
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-schedule-bundle
dsh plugin --profile <name> add <rc.2 harness checkout>/packages/schedule/schedule

dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa
```

Removal withdraws the preset and host plugin on the next profile start; PostgreSQL data, dsh sessions, and the workspace directory are untouched.

### What you get

- The「24私助」preset: standard plugin set (platform shell, fs, search, jobs, skill, goal, plan-mode, compaction, delegation, ask-user, todo, web, present, ralph) plus `pa24-agent`; persona text merged into the assistant identity; `tool-schedule` deliberately excluded — reminders stay on the ledger.
- Role-restricted tool surfaces: local sessions get the full standard base plus all `pa24_*` tools; the Feishu entry session and workers keep business-only whitelists (one preset never implies one permission set).
- The host plugin: fixed Feishu access and local sessions, `pa24_delegate`/`pa24_jobs`/`pa24_notes`/`pa24_memory`/`pa24_maintenance`/`pa24_workspace`/`pa24_connection`/`pa24_work`, PostgreSQL ledger with outbox delivery and offline-capable reminders, handwriting review cards, digests, backup/health, and the web panel.
- `feishu-setup.md`, the staged access-setup wizard surfaced through `pa24_connection` (`guide` plus `check` with `nextSteps`).

### Environment and configuration

Secrets live only in the server environment; the workspace `AGENTS.md` holds one machine-checked JSON block with variable names.

| Variable | Meaning |
|---|---|
| `PA24_PG_DSN` | PostgreSQL connection string; the ledger uses an isolated `pa24` schema |
| `PA24_WORKSPACE` | Absolute workspace directory bound on first start (or pick one in the panel) |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | Feishu custom-app credentials (feishu mode) |

`AGENTS.md` fields: `mode` (demo/feishu), `larkProfile`, `ownerOpenId`, `folderToken`, `tasklistId`, `calendarId`, `timeZone`, `appIdEnv`/`appSecretEnv`/`pgDsnEnv`, `maxWorkers`, `enabledWorkers`, `workerModels`, `extraLocalTools` (closed enum: `subagent_codex`, `subagent_claude_code`). For Feishu access setup, tell the local session「帮我接通飞书」or call `pa24_connection` with `action=guide`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch (`cordis.patch.yml`) inserts two rows: `pa24-preset` (`@deepseek-ai/dsh-agent-preset`, id `pa24`) composing the standard plugin set plus `@benz-ai-x/dsh-24pa/agent`, and `pa24` (`@benz-ai-x/dsh-24pa`) for the host plugin. A `toolFilter` naming absent tools fails startup, so the subagent rows carry no schedule deny list; `modelSelectionSettings` is omitted because its host-scope settings row is not guaranteed. `subagent_codex`/`subagent_claude_code` rows are enabled but mount only when their provider bundles are installed; `tools.restrict()` requires allow-listed names to exist, hence the `extraLocalTools` opt-in. `src/tools.ts` owns `STANDARD_CODING_TOOLS` and `ROLE_TOOLS`; `src/prompts.ts` owns every built-in prompt with `PROMPTS_VERSION`; `src/feishu.ts` owns transport, access diagnostics, and `setupNextSteps`. The workspace-rules prompt section is dynamic and reloadable; bad config never replaces the effective version.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The repository carries the product spec (`docs/24PA-v1-SPEC.md`), the design (`docs/24PA-整体设计方案.md`), ADR-0001 on workspace/session boundaries, per-feature research (`docs/research/`), and the delivery plan (`docs/planning/`). Releases publish npm dist-tags per dsh baseline (`dsh-0.2.0-rc.2`, `dsh-0.2.1-alpha.1`).

-----

<a id="model-experience"></a>
## Model Experience

### Assistant system-prompt sections (bundle-owned)

#### What the model sees

Four ordered lead sections (identity and capability split, coordination, business domains, safety and reporting) plus the merged persona line, injected by `pa24-agent`; the workspace-rules section (order 910) carries `AGENTS.md` prose and stays empty until a workspace is bound. Workers receive four-part personas (职责/完成标准/边界/输出要求) instead.

##### Verbatim identity line (src/prompts.ts)

```markdown
统一提供助理协调、工作区维护和完整编程能力；按本会话实际可用的工具办理（身份与工作目录见系统提示开头）。
```

#### Token effect

Fixed per role after workspace bind; the workspace-rules section is conditional (empty until bound) and is replaced, not extended, on reload.

#### KV Cache effect

Stable repeated prefix within a session; an `AGENTS.md` reload replaces the rules section and invalidates reuse from that request on, while a `PROMPTS_VERSION` bump invalidates across deployments.

### Bundle-owned tool schemas (pa24_*)

#### What the model sees

Eight `pa24_*` schemas with fixed JSON parameters, plus the role restriction applied to the inherited catalog: the Feishu entry sees exactly its five business tools, workers exactly `pa24_work` and read-only `pa24_memory`, local sessions the full standard base plus all `pa24_*` tools.

#### Token effect

Fixed catalog per role for the session lifetime; `extraLocalTools` extends the local allow list only.

#### KV Cache effect

The catalog is constant across one session's requests (append-only conversation); changing the workspace `extraLocalTools`, the preset composition, or upgrading the package invalidates reuse.

Indirectly, through the preset rows this bundle composes, each inserted standard package owns its own tool descriptions and prompt contributions.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Real Feishu tenants are untested** — long-connection, dual identities, and token renewal were verified against a stubbed Feishu side; the first real integration may surface wire differences, and console permission scope names are keyword-based pending on-console verification.
- **Handwriting recognition quality is unquantified** — multi-page transcription fidelity needs a 30–50 page real-sample evaluation before any accuracy claim; the visual route must be configured in `workerModels`.
- **dsh 0.2.0-rc.2 hosts ship no schedule service** — digests and meeting prep report "当前 Host 未提供原生 Schedule 服务" until the experimental schedule bundle and a workspace-built `dsh-schedule` are installed; the registry `dsh-schedule@0.2.0-rc.1` is peer-incompatible, and its host-plane `schedule_*` tools cannot be hidden by preset restriction.
- **External CLI delegation is dormant by default** — `subagent_codex`/`subagent_claude_code` mount only after their provider bundles are installed and `extraLocalTools` opts in; unconfigured tools stay absent rather than erroring.
- **One writer per state directory** — a second active pa24 Host against the same `$DSH_HOME/24pa` refuses startup by lock; run one host per state directory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Build and test run inside `packages/24pa` against an adjacent `deepseek-harness` checkout: `npm install && npm run build`, `npm test` (unit plus e2e over the real dsh loader, native sessions, and an isolated PostgreSQL; only the model, network, and clock are stubbed). Dual-baseline runs pass `DSH_BIN` to select the runtime and `PA24_E2E_EXTRA_PLUGINS` to append the rc.2 schedule companions. Regression baselines: 0.2.1-alpha.1 plain and 0.2.0-rc.2 with companions, 130/130 each. The bundled guide (`feishu-setup.md`) ships in `files` and is the single authority for access setup.

</details>
