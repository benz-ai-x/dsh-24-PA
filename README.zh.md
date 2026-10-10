---
description: "面向 dsh 的飞书私人助理 profile bundle：一个「24私助」预设，携带标准模式完整工具面与账本驱动的业务 Worker、提醒、手写审核和分阶段接入向导。"
kind: "package-bundle"
---

# @benz-ai-x/dsh-24pa

[English](README.md) | 中文

## 摘要

把 `@benz-ai-x/dsh-24pa` 安装进 Profile，即获得「24私助」助理预设及其宿主插件：飞书＋本地双入口协调、六类业务 Worker，PostgreSQL 账本承载事项、提醒、手写审核、简报与发送回执。预设携带按角色裁剪的标准模式工具面——本地会话可编程，飞书入口与 Worker 保持业务白名单。版本号跟随 dsh 基线（`<dsh 版本>.<序号>`），支持 dsh `0.2.0-rc.2`、`0.2.1-alpha.1` 与 `0.2.1-alpha.2`。

## 常见问题

**24私助（24PA）是什么？**——面向 dsh 的飞书私人助理插件（profile bundle）：本地 dsh 会话与飞书机器人协调六类业务 Worker，PostgreSQL 账本承载任务、日程、提醒、备忘、简报与手写审核。

**支持哪些 dsh 运行时？**——dsh `0.2.0-rc.2`、`0.2.1-alpha.1` 与 `0.2.1-alpha.2`；版本号按 `<dsh 基线>.<序号>` 命名，npm dist-tag 按基线分通道。

**怎么安装？**——`dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@<基线序号>`，然后重启 profile（见[安装 Bundle](#安装-bundle)）。

**提醒需要模型在线吗？**——不需要：提醒由 PostgreSQL 发生实例经 Outbox 触发，模型离线时固定提醒照发。

**怎么接通飞书？**——对本地24私助会话说「帮我接通飞书」；内置向导（`pa24_connection` 的 `guide` 与带 `nextSteps` 的 `check`）带你完成建应用、授权、资源标识与健康检查。飞书接入会话也可运行这套只读向导及 `wecom_guide`/`wecom_check` 渠道诊断；配置写入仍仅限本地会话（ADR-0001）。

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

### 安装 Bundle

按你的 dsh 运行时选择对应版本，然后重启 Profile。reconcile 步骤会为这个 `dsh.bundle` 声明激活补丁层（一个助理预设行＋一个宿主插件行）。

```sh
# dsh 0.2.1-alpha.1 宿主（自带 schedule 服务）
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.1.6

# dsh 0.2.1-alpha.2 宿主——peer 范围已包含 alpha.2；首个 alpha.2 基线版本
# （0.2.1-alpha.2.1）随该宿主同步后的预设发布，发布前 alpha.2 宿主无法安装
# alpha.1 线（peer 检查拒绝跨基线安装）
# dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-alpha.2.1

# dsh 0.2.0-rc.2 宿主——该线已冻结于 0.2.0-rc.2.3、不再迭代（简报功能另需两个 schedule 伴随件）
dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.0-rc.2.3
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-schedule-bundle
dsh plugin --profile <name> add <rc.2 harness 源码>/packages/schedule/schedule

dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa
```

删除在下一次 Profile 启动时收回预设与宿主插件；PostgreSQL 数据、dsh 会话与工作区目录不受影响。版本命名遵循 `<dsh 基线版本>.<序号>`；npm dist-tag 按基线分通道（`dsh-0.2.0-rc.2`、`dsh-0.2.1-alpha.1`、`dsh-0.2.1-alpha.2`）。

### 配置

密钥只存在于服务器环境；工作区 `AGENTS.md` 以唯一一个机器校验的 JSON 块保存变量名，重载时重新校验——坏配置绝不替换当前生效版本。

| 变量 | 含义 |
|---|---|
| `PA24_PG_DSN` | PostgreSQL 连接串；账本使用独立 `pa24` schema |
| `PA24_WORKSPACE` | 首次启动绑定的绝对工作区目录（也可在面板或设置里选择） |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | 飞书自建应用凭据（feishu 模式） |

`AGENTS.md` 字段：`mode`（demo/feishu）、`larkProfile`、`ownerOpenId`、`folderToken`、`tasklistId`、`calendarId`、`calendarChannel`/`todoChannel`/`notifyChannel`（feishu|wecom，默认 feishu——企微作日程/待办第二操作渠道＋提醒单向推送，永不收信）、`timeZone`、`appIdEnv`/`appSecretEnv`/`pgDsnEnv`、`maxWorkers`、`enabledWorkers`、`workerModels`、`extraLocalTools`（封闭枚举）。配置飞书接入时，对本地会话说「帮我接通飞书」，或调用 `pa24_connection` 的 `action=guide`；内置 `feishu-setup.md` 是唯一权威。

### 暴露工具

外部 CLI 委派行已随包启用但保持休眠：`subagent_codex` 与 `subagent_claude_code` 仅在对应 provider 包（`@deepseek-ai/dsh-subagent-codex` / `-claude-code`）安装进 Profile 后挂载，且工作区须再经 `extraLocalTools` 显式开启——因为 `tools.restrict()` 会拒绝 allow 名单里不真实存在的工具。`ralph` 对本地会话可用，遵循其工具契约：仅在本人明确要求时使用。

### 你会得到什么

- 「24私助」预设：标准插件全集（平台 shell、文件、检索、jobs、skill、goal、plan-mode、压缩、通用委派、ask-user、todo、web、present、ralph）＋`pa24-agent`；persona 文案已并入助理身份；`tool-schedule` 刻意不并入——提醒统一走账本。
- 按角色裁剪的工具面：本地会话获得完整标准工具面＋全部 `pa24_*` 工具；飞书接入会话与 Worker 保持业务白名单（同一预设绝不意味着同一权限）。
- 宿主插件：固定飞书接入与本地会话，`pa24_delegate`/`pa24_jobs`/`pa24_notes`/`pa24_memory`/`pa24_maintenance`/`pa24_workspace`/`pa24_connection`/`pa24_work`，PostgreSQL 账本＋Outbox 回执＋离线可发提醒、手写审核卡片、简报、备份/健康与 Web 面板，并在 dsh 设置模态提供「24私助」分区管理工作区（绑定/重载/生效配置查看；侧栏面板保持不变）；企微渠道接入走随包 `wecom-setup.md`（`pa24_connection action=wecom_guide` / `wecom_check`）。

### 失败与恢复

dsh 0.2.0-rc.2 宿主上，安装上述 schedule 伴随件之前，简报与会前准备如实报「当前 Host 未提供原生 Schedule 服务」；registry 的 `dsh-schedule@0.2.0-rc.1` peer 不匹配、其行保持禁用。未安装的外部 CLI provider 使工具缺席而非报错。同一 `$DSH_HOME/24pa` 上的第二个 pa24 宿主会因锁拒绝启动。全新 Profile 对 `protobufjs`（飞书 SDK 的传递依赖）自带未决的 `allowBuilds` 占位符，首次安装会以非零码结束，需在 Profile 的 `pnpm-workspace.yaml` 里把它设为 `true`；无论哪种结果包都已完整加入。 lark-cli 超时归类为结果未知——先核对飞书实际对象再决定是否重试；绝不盲目重放外部写入。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

本节说明助理如何组织工作、可观察行为来自哪里；消费者契约见[使用本包](#使用本包)。

### 设计概念

- **一个预设，多套权限。** 每个会话组装的都是同一个「24私助」预设；agent 创建时套用的角色白名单决定可见工具，因此继承预设绝不继承维护授权（ADR-0001）。
- **账本是提醒的权威。** `tool-schedule` 的排除是有意为之：提醒由 PostgreSQL 发生实例经 Outbox 触发，模型离线也能发出，每次投递都有回执。
- **材料永远不构成授权。** 笔记、文档、子 Agent 回复与抓取的网页内容都只是输入；只有本人的明确指令才授权外部写入，密钥只以环境变量名引用。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`cordis.patch.yml`](packages/24pa/cordis.patch.yml) | Profile 补丁层：预设行＋宿主插件行 |
| [`src/index.ts`](packages/24pa/src/index.ts) | 插件入口：配置模式、runtime 装配、面板 |
| [`src/tools.ts`](packages/24pa/src/tools.ts) | 工具注册、`STANDARD_CODING_TOOLS`、`ROLE_TOOLS` |
| [`src/prompts.ts`](packages/24pa/src/prompts.ts) | 全部内置提示词与 `PROMPTS_VERSION`、AGENTS.md 模板 |
| [`src/runtime.ts`](packages/24pa/src/runtime.ts) | 角色、委派、账本流程、提醒、简报、备份 |
| [`src/feishu.ts`](packages/24pa/src/feishu.ts) | SDK 长连接传输、接入诊断、`setupNextSteps` |
| [`feishu-setup.md`](packages/24pa/feishu-setup.md) | `pa24_connection guide` 服务的内置接入指南 |

### 运行流程

启动时宿主插件对 `$DSH_HOME/24pa` 取单写锁，连接 PostgreSQL，加载并校验工作区 `AGENTS.md`，经 SessionController 建立固定的飞书接入与本地会话。入站飞书事件先耐久落 inbox 再确认；协调者经 continuable child API 委派 Worker，每个事项记录 origin、父会话与固定投递目标。定时循环带回执地排空 Outbox、触发到期提醒、核验已发布笔记指纹、经原生 Schedule 服务唤醒简报计划；结果回到实际发起入口。agent 创建时角色白名单裁剪继承的工具目录；`AGENTS.md` 重载只替换工作区规则提示段，失败时不触碰生效配置。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

当包级契约不够时读这些页面。它们从本 bundle 延伸到它实现的产品与它接入的平台。

- [产品规格](docs/24PA-v1-SPEC.md)——每个已交付功能背后的故事、场景与测试组。
- [整体设计](docs/24PA-整体设计方案.md)——流程、会话拓扑与已确认取舍。
- [ADR-0001](docs/adr/0001-workspace-session-boundaries.md)——本预设执行的工作区/会话权限边界。
- [研究记录](docs/research/)——分功能的已验证契约，含双基线与接入向导研究。
- [v1 PR 交付计划](docs/planning/24PA-v1-PR交付计划.md)——功能分组、依赖与合并标准。

-----

<a id="模型体验"></a>
## 模型体验

### 助理请求

#### 模型看到什么

`pa24-agent` 注入四个有序 Lead 段（身份与能力分工、协调流程、业务要点、安全边界与汇报）与并入的 persona 行；工作区规则段（order 910）承载 `AGENTS.md` 散文规则，绑定工作区前为空。Worker 改收四节式 persona（职责/完成标准/边界/输出要求）。

##### 身份行原文（src/prompts.ts）

```markdown
统一提供助理协调、工作区维护和完整编程能力；按本会话实际可用的工具办理（身份与工作目录见系统提示开头）。
```

#### Token 影响

工作区绑定后按角色固定；工作区规则段为条件性（绑定前为空），重载时整体替换而非追加。

#### KV Cache 影响

会话内为稳定重复前缀：`AGENTS.md` 重载会替换规则段并自该请求起使复用失效，`PROMPTS_VERSION` 升版则跨部署使复用失效；本 bundle 不改写更早的前缀。

### 角色裁剪的工具目录

#### 模型看到什么

八个 `pa24_*` 模式（固定 JSON 参数），以及对继承目录的角色裁剪：飞书入口恰见五个业务工具，Worker 恰见 `pa24_work` 与只读 `pa24_memory`，本地会话见完整标准工具面＋全部 `pa24_*` 工具。

#### Token 影响

会话生命周期内按角色固定；`extraLocalTools` 仅扩展本地 allow 名单，其他 bundle 在宿主面新增的工具（如 `schedule_*`）不经过本 bundle 的名单。

#### KV Cache 影响

只追加：同一会话各请求间目录恒定，对话增长不改写前缀；修改工作区 `extraLocalTools`、变更预设组装或升级本包会使复用失效。

间接地，经本 bundle 组装的预设行，每个被插入的标准包各自持有其工具描述与提示词贡献。

## 已知限制与遗留事项

<a id="已知限制与遗留事项"></a>

这些限制说明本助理何时需要特别的运维注意。它们是当前的包约束，不是与飞书的一般性对比，也不是任务清单。

- **真实飞书租户未验证**——长连接、双身份与令牌续期仅在桩化的飞书侧验证过；首次真实接入可能暴露线路差异，控制台权限点为关键词表述、精确 scope 名待控制台核对。
- **手写识别质量未量化**——多页转写保真度需 30–50 页真实样本评测后才能作任何准确率表述；视觉路由须在 `workerModels` 配置。
- **dsh 0.2.0-rc.2 宿主不带 schedule 服务**——安装 schedule 伴随件之前，简报与会前准备如实不可用；伴随件在宿主面新增的 `schedule_*` 工具无法被预设裁剪隐藏。
- **外部 CLI 委派默认休眠**——`subagent_codex`/`subagent_claude_code` 须安装对应 provider 包并经 `extraLocalTools` 显式开启后才挂载；未配置时工具缺席而非报错。
- **每个状态目录单写**——同一 `$DSH_HOME/24pa` 上的第二个 pa24 宿主会因锁拒绝启动；每个状态目录只跑一个宿主。

<a id="维护者备注"></a>
### 维护者备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本备注是面向维护者的工作上下文：待决问题与未定方向。它明确不具权威性——已交付的行为与限制以正文章节与包代码为准。

- **多基线验证**——回归运行用 `DSH_BIN` 选运行时、`PA24_E2E_EXTRA_PLUGINS` 附加 rc.2 的 schedule 伴随件；当前活跃基线为 0.2.1-alpha.2 无附加（156/156），0.2.0-rc.2 与 0.2.1-alpha.1 由双 API 回退路径保持兼容。
- **本地 harness 相邻性**——dev 类型检查经 `scripts/link-peer.mjs` 从相邻的 `deepseek-harness` checkout 链接 vendored peers；registry 安装不依赖该 checkout。

</details>
