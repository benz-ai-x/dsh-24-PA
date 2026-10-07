---
description: "面向 dsh 的飞书私人助理 profile bundle：一个「24私助」预设，携带标准模式完整工具面与账本驱动的业务 Worker、提醒、手写审核和分阶段接入向导。"
kind: "package-bundle"
---

# @benz-ai-x/dsh-24pa

[English](README.md) | 中文

## 摘要

把 `@benz-ai-x/dsh-24pa` 安装进 Profile，即获得「24私助」助理预设及其宿主插件：飞书＋本地双入口协调、六类业务 Worker，PostgreSQL 账本承载事项、提醒、手写审核、简报与发送回执。预设携带按角色裁剪的标准模式工具面——本地会话可编程，飞书入口与 Worker 保持业务白名单。版本号跟随 dsh 基线（`<dsh 版本>.<序号>`），支持 dsh `0.2.0-rc.2` 与 `0.2.1-alpha.1`。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制与遗留事项](#已知限制与遗留事项)
- [维护者备注](#维护者备注)

-----

<a id="使用本包"></a>
## 使用本包

### 安装进 profile

按你的 dsh 运行时选择对应版本，然后重启 profile。reconcile 步骤会为这个 `dsh.bundle` 声明激活补丁层（一个助理预设行＋一个宿主插件行）。

```sh
# dsh 0.2.1-alpha.1 宿主（自带 schedule 服务）
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.1.2

# dsh 0.2.0-rc.2 宿主（简报功能另需两个 schedule 伴随件）
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.0-rc.2.1
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-schedule-bundle
dsh plugin --profile <name> add <rc.2 harness 源码>/packages/schedule/schedule

dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa
```

删除在下一次 profile 启动时收回预设与宿主插件；PostgreSQL 数据、dsh 会话与工作区目录不受影响。

### 你会得到什么

- 「24私助」预设：标准插件全集（平台 shell、文件、检索、jobs、skill、goal、plan-mode、压缩、通用委派、ask-user、todo、web、present、ralph）＋`pa24-agent`；persona 文案已并入助理身份；`tool-schedule` 刻意不并入——提醒统一走账本。
- 按角色裁剪的工具面：本地会话获得完整标准工具面＋全部 `pa24_*` 工具；飞书接入会话与 Worker 保持业务白名单（同一预设绝不意味着同一权限）。
- 宿主插件：固定飞书接入与本地会话，`pa24_delegate`/`pa24_jobs`/`pa24_notes`/`pa24_memory`/`pa24_maintenance`/`pa24_workspace`/`pa24_connection`/`pa24_work`，PostgreSQL 账本＋Outbox 回执＋离线可发提醒、手写审核卡片、简报、备份/健康与 Web 面板。
- `feishu-setup.md` 分阶段接入向导，经 `pa24_connection`（`guide` 与带 `nextSteps` 的 `check`）提供服务。

### 环境与配置

密钥只存在于服务器环境；工作区 `AGENTS.md` 以唯一一个机器校验的 JSON 块保存变量名。

| 变量 | 含义 |
|---|---|
| `PA24_PG_DSN` | PostgreSQL 连接串；账本使用独立 `pa24` schema |
| `PA24_WORKSPACE` | 首次启动绑定的绝对工作区目录（也可在面板选择） |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | 飞书自建应用凭据（feishu 模式） |

`AGENTS.md` 字段：`mode`（demo/feishu）、`larkProfile`、`ownerOpenId`、`folderToken`、`tasklistId`、`calendarId`、`timeZone`、`appIdEnv`/`appSecretEnv`/`pgDsnEnv`、`maxWorkers`、`enabledWorkers`、`workerModels`、`extraLocalTools`（封闭枚举：`subagent_codex`、`subagent_claude_code`）。配置飞书接入时，对本地会话说「帮我接通飞书」，或调用 `pa24_connection` 的 `action=guide`。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

补丁（`cordis.patch.yml`）插入两行：`pa24-preset`（`@deepseek-ai/dsh-agent-preset`，id `pa24`）组装标准插件集＋`@benz-ai-x/dsh-24pa/agent`，以及 `pa24`（`@benz-ai-x/dsh-24pa`）宿主插件。`toolFilter` 引用不存在的工具会导致启动失败，故 subagent 行不带 schedule deny 列表；`modelSelectionSettings` 因宿主面 settings 行不保证存在而省略。`subagent_codex`/`subagent_claude_code` 行已启用，但仅在安装对应 provider 包后才挂载；`tools.restrict()` 要求 allow 名单内工具真实存在，因此经 `extraLocalTools` 显式开启。`src/tools.ts` 持有 `STANDARD_CODING_TOOLS` 与 `ROLE_TOOLS`；`src/prompts.ts` 持有全部内置提示词与 `PROMPTS_VERSION`；`src/feishu.ts` 持有传输、接入诊断与 `setupNextSteps`。工作区规则提示段是动态可重载的；坏配置不会替换当前生效版本。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

仓库内含产品规格（`docs/24PA-v1-SPEC.md`）、整体设计（`docs/24PA-整体设计方案.md`）、工作区/会话边界的 ADR-0001、分功能研究记录（`docs/research/`）与交付计划（`docs/planning/`）。发布按 dsh 基线打 npm dist-tag（`dsh-0.2.0-rc.2`、`dsh-0.2.1-alpha.1`）。

-----

<a id="模型体验"></a>
## 模型体验

### 助理系统提示段（bundle 自有）

#### 模型看到什么

`pa24-agent` 注入四个有序 Lead 段（身份与能力分工、协调流程、业务要点、安全边界与汇报）与并入的 persona 行；工作区规则段（order 910）承载 `AGENTS.md` 散文规则，绑定工作区前为空。Worker 改收四节式 persona（职责/完成标准/边界/输出要求）。

##### 身份行原文（src/prompts.ts）

```markdown
统一提供助理协调、工作区维护和完整编程能力；按本会话实际可用的工具办理（身份与工作目录见系统提示开头）。
```

#### Token 影响

工作区绑定后按角色固定；工作区规则段为条件性（绑定前为空），重载时整体替换而非追加。

#### KV Cache 影响

会话内为稳定重复前缀；`AGENTS.md` 重载会替换规则段并自该请求起使复用失效，`PROMPTS_VERSION` 升版则跨部署使复用失效。

### bundle 自有工具模式（pa24_*）

#### 模型看到什么

八个 `pa24_*` 模式（固定 JSON 参数），以及对继承目录的角色裁剪：飞书入口恰见五个业务工具，Worker 恰见 `pa24_work` 与只读 `pa24_memory`，本地会话见完整标准工具面＋全部 `pa24_*` 工具。

#### Token 影响

会话生命周期内按角色固定；`extraLocalTools` 仅扩展本地 allow 名单。

#### KV Cache 影响

同一会话的各请求间目录恒定（对话只追加）；修改工作区 `extraLocalTools`、变更预设组装或升级本包会使复用失效。

间接地，经本 bundle 组装的预设行，每个被插入的标准包各自持有其工具描述与提示词贡献。

## 已知限制与遗留事项

<a id="已知限制与遗留事项"></a>

- **真实飞书租户未验证**——长连接、双身份与令牌续期仅在桩化的飞书侧验证过；首次真实接入可能暴露线路差异，控制台权限点为关键词表述、精确 scope 名待控制台核对。
- **手写识别质量未量化**——多页转写保真度需 30–50 页真实样本评测后才能作任何准确率表述；视觉路由须在 `workerModels` 配置。
- **dsh 0.2.0-rc.2 宿主不带 schedule 服务**——安装 experimental schedule bundle 与 workspace 构建的 `dsh-schedule` 前，简报与会前准备报「当前 Host 未提供原生 Schedule 服务」；registry 的 `dsh-schedule@0.2.0-rc.1` peer 不匹配，且其宿主面 `schedule_*` 工具无法被预设裁剪隐藏。
- **外部 CLI 委派默认休眠**——`subagent_codex`/`subagent_claude_code` 须安装对应 provider 包并经 `extraLocalTools` 显式开启后才挂载；未配置时工具缺席而非报错。
- **每个状态目录单写**——同一 `$DSH_HOME/24pa` 上的第二个 pa24 宿主会因锁拒绝启动；每个状态目录只跑一个宿主。

<a id="维护者备注"></a>
### 维护者备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

构建与测试在 `packages/24pa` 内进行，依赖相邻的 `deepseek-harness` checkout：`npm install && npm run build`，`npm test`（单元＋e2e，走真实 dsh loader、原生会话与隔离 PostgreSQL；仅模型、外部网络与时钟为桩）。双基线运行用 `DSH_BIN` 选运行时、`PA24_E2E_EXTRA_PLUGINS` 附加 rc.2 的 schedule 伴随件。回归基线：0.2.1-alpha.1 无附加与 0.2.0-rc.2 带伴随件，各 130/130。内置指南（`feishu-setup.md`）随 `files` 分发，是接入配置的唯一权威。

</details>
