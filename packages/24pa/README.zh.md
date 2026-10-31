---
description: "24私助（24PA）是运行在 dsh 上的自托管飞书 / Lark AI 私人助理插件，提供 Agent Skills、定时任务、日程、待办、结构化记忆、手写审核与企微集成。"
kind: "package-bundle"
---

# 24私助（24PA）— 飞书 / Lark AI 私人助理

[English](README.md) | **中文** | [GitHub](https://github.com/benz-ai-x/dsh-24-PA) | [版本发布](https://github.com/benz-ai-x/dsh-24-PA/releases)

[![npm 版本](https://img.shields.io/npm/v/%40benz-ai-x%2Fdsh-24pa?label=npm)](https://www.npmjs.com/package/@benz-ai-x/dsh-24pa)
[![GitHub 最新发布](https://img.shields.io/github/v/release/benz-ai-x/dsh-24-PA?label=release)](https://github.com/benz-ai-x/dsh-24-PA/releases/latest)
[![Node.js](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-43853d)](package.json)
[![dsh 基线](https://img.shields.io/badge/dsh-0.2.1--rc.5-3451b2)](https://github.com/benz-ai-x/dsh-24-PA/releases/tag/v0.2.1-rc.5.1)

**从“提醒我”到“帮我准备这一周”——把对话变成有条理、可审核、能跟进的行动，同时把控制权留在自己手里。**

`@benz-ai-x/dsh-24pa` 是运行在 [dsh](https://github.com/deepseek-ai/deepseek-harness) 上的自托管 AI 私人助理插件。本地 DSH 会话与飞书机器人围绕同一位主人的工作区协调七类业务 Worker；电脑端工作区另以十六张能力卡片承接 Agent Skills、定时任务、日程、待办、结构化记忆、手写审核与送达证据。

![24私助电脑端工作区，展示 Skill 管理、定时任务、日程、待办与运行记录](https://raw.githubusercontent.com/benz-ai-x/dsh-24-PA/main/docs/assets/24pa-desktop-overview.png)

## 为什么是24私助？

- **不止聊天，更能跟进事情。** 从一句委托到助理交办、Skill 运行、平台对象与可追溯结果，把定时计划和后续跟进串在同一条工作链路里。
- **继续用你熟悉的工具。** 直接承接飞书的日程、待办、文档与通知，以及企微的日程、待办和单向推送，不为了使用助理再迁出一套数据真相。
- **自动化也能看得见、管得住。** 查看 Skill 包与版本、预览权限、分开跟踪执行和投递，并把内容审核与行动授权明确分开。
- **个人助理能力可以持续生长。** 用卡片组织聚焦的能力，共享同一工作区与运行时；新需求可以扩展新场景卡片，而不是再造一个彼此割裂的机器人。

## 卡片化个人助理架构

对话协调与电脑端卡片能力面共享主人身份、角色权限、Skill 与计划运行时、工作记录、存储和送达证据。

![24私助架构图：本地与飞书入口、统一工作区与权限边界、十六张能力卡片、共享运行时，以及未来新场景卡片](https://raw.githubusercontent.com/benz-ai-x/dsh-24-PA/main/docs/assets/24pa-architecture.zh.png)

**卡片是产品能力的扩展单元。** 新需求可以增加聚焦的场景卡片，复用同一工作区、权限、计划、运行记录和运维底座。下方十六张实线卡片均已实现；虚线卡片代表产品扩展方向，不表示当前版本已经提供第三方卡片 SDK。

## 已实现的 16 张卡片

以下卡片全部属于当前产品。普通浏览是只读操作，不会悄悄启动模型、创建平台对象或运行任务。

### 事务与计划 · 5 张

| 卡片 | 能帮你做什么 | 已具备的能力 |
| --- | --- | --- |
| **Skill 管理** | 把可复用的经验变成可控的助理能力。 | 新建／导入 Markdown 或 ZIP；编辑、复制；完整包目录树与只读文件预览；不可变版本与关联计划；试运行、运行、禁用、回退、删除和下载。 |
| **定时任务** | 让一次性和周期性工作按持久计划推进。 | 空白、预设或复制计划；Skill 参数、固定时区、授权目标与投递；触发预览；启用、暂停、恢复、立即运行、删除、还原和历史查询。 |
| **日程** | 跨已登记日历查看并办理真实日程。 | 今日安排与下一场；来源筛选、冲突和查询完整性；平台核验；对话创建／变更；原生提醒；原日程入口。 |
| **待办** | 管理原平台业务工作，同时与助理执行保持分流。 | 逾期、今日到期和未完成视图；多来源聚合与五档角色范围；对话创建、完成、延期、修改、取消；原对象入口与关联交办。 |
| **运行记录** | 看清运行了什么、结果是什么、是否真正送达。 | 执行记录、助理交办、未执行事件分视图；筛选与导出；诊断与核对；补投、重跑；交办补充、停止、接续与验收。 |

### 知识与资料 · 2 张

| 卡片 | 能帮你做什么 | 已具备的能力 |
| --- | --- | --- |
| **手写审核** | 把手写材料整理成可审核的内容，再逐项授权后续行动。 | 原稿对照、草稿编辑、版本发布与差异；飞书审核入口；核验与重发；内容批准不会自动执行候选行动。 |
| **结构化记忆** | 让长期事实、偏好与决定有来源、有确认依据。 | 完整正文、来源、确认依据、范围、时效、冲突与修订；查询筛选；本地新建、修改、停用、删除、恢复和撤销；JSON 保持唯一可编辑权威。 |

### 接入与设置 · 6 张

| 卡片 | 能帮你做什么 | 已具备的能力 |
| --- | --- | --- |
| **飞书接入** | 确认主人、应用与所需能力是否真正接通。 | 主人、CLI、应用与 profile 身份证据；收发、审核回调与资源检查；只读诊断、明确触发的测试、清理和配置定位。 |
| **企业微信接入** | 办理授权范围内的企微对象，而不增加另一个收信机器人。 | 日程、待办、单向推送分域证据；身份与授权检查；续期、独立测试和配置定位；不提供收信对话。 |
| **QwenNote 听记** | 把录音、转写与会议纪要作为可追溯的资料来源。 | 仅本地按需读取列表、转写和纪要；接入证据；带来源的整理与候选行动提炼，仍需审核和行动授权。 |
| **飞书知识库** | 选择备忘与手写审核文档的保存落点。 | 落点、节点、权限与关联文档检查；配置、核验和打开；沿资料流程保存，不搬动旧文档，也不静默更换落点。 |
| **工作区与配置** | 让主人的规则、数据和会话始终归属正确的工作区。 | 目录、绑定、配置来源、生效版本与差异；绑定、切换、重载、生效配置查看和参数编辑入口；重载失败保留当前环境。 |
| **参数配置** | 在一个受控入口调整日常行为，不必翻找配置文件。 | 业务参数、来源映射、模型路由、语音和预算；编辑、校验、保存、重置和错误定位；密钥只写不回显，保存与生效分别反馈。 |

### 运行与维护 · 3 张

| 卡片 | 能帮你做什么 | 已具备的能力 |
| --- | --- | --- |
| **全应用健康检查** | 在问题阻断工作之前，找到真正需要处理的环节。 | 模块状态、证据时间与范围、影响和下一步；全量或分项只读检查；区分未启用、未检查、未验证与故障；诊断与修复定位。 |
| **模型与预算** | 看清模型消耗，并在明确限额处暂停新的受管请求。 | 实际模型路由、Token／请求用量与价格依据；日／月限额和预警；核对后单次放行；费用未知不会报成零。 |
| **账本与备份** | 保护恢复所需状态，并证明实际检查过什么。 | SQLite／PostgreSQL 状态；创建备份、查看清单、校验真实副本；隔离恢复检查；排除密钥；恢复演练不等于授权生产切换。 |

各模块归属与验证证据见 [Manticore 交付与验收记录](https://github.com/benz-ai-x/dsh-24-PA/blob/main/docs/planning/24PA-Manticore-交付验收.md)。

## 快速开始

前置要求：Node.js `^22.19.0` 或 `>=24.0.0`、dsh `0.2.1-rc.5`；默认 SQLite demo 无需独立数据库服务。

<a id="安装-bundle"></a>
### 安装当前版本

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.5

dsh plugin --profile <name> add @benz-ai-x/dsh-24pa@0.2.1-rc.5.1 --registry=https://registry.npmjs.org
```

重启同一个 Profile 并选择「24私助」预设。安装与启动必须使用相同的 `DSH_HOME`。全新实例请按[初始化指南](https://github.com/benz-ai-x/dsh-24-PA/blob/main/docs/24PA-初始化指南.md)完成隔离目录、启动脚本、pnpm 构建审批、带 token 的面板地址与 demo 验收；随后对本地助理说「帮我接通飞书」，或阅读随包[飞书接入指南](feishu-setup.md)。

删除时使用相同 `DSH_HOME` 执行 `dsh plugin --profile <name> remove @benz-ai-x/dsh-24pa`。下一次 Profile 启动会收回预设与宿主插件，不删除工作区、会话或 PostgreSQL 数据。

<details>
<summary><strong>使用旧版 dsh 宿主？</strong>查看推荐版本</summary>

24私助版本号遵循 `<dsh 基线>.<序号>`；npm dist-tag 按基线分通道。

| dsh 宿主 | 24私助包版本 |
| --- | --- |
| `0.2.1-rc.5` | `0.2.1-rc.5.1`（当前版本） |
| `0.2.1-rc.4` | `0.2.1-rc.4.2` |
| `0.2.1-rc.3` | `0.2.1-rc.3.2` |
| `0.2.1-rc.2` | `0.2.1-rc.2.9` |
| `0.2.1-rc.1` | `0.2.1-rc.1.2` |
| `0.2.1-alpha.2` – `0.2.1-alpha.5` | `0.2.1-alpha.5.1` |
| `0.2.1-alpha.1` | `0.2.1-alpha.1.6` |
| `0.2.0-rc.2` | `0.2.0-rc.2.3`，另需[初始化指南](https://github.com/benz-ai-x/dsh-24-PA/blob/main/docs/24PA-初始化指南.md)中的两个 schedule 伴随件 |

</details>

-----

<a id="使用本包"></a>
## 包级参考

### 配置

密钥保存在服务器环境或工作区私有的 `.24pa/secrets.json` 密钥库，同名环境变量优先；工作区 `AGENTS.md` 以唯一一个机器校验的 JSON 块保存非秘密配置与变量名，重载时重新校验——坏配置绝不替换当前生效版本。

| 变量 | 含义 |
|---|---|
| `PA24_PG_DSN` | PostgreSQL 连接串；账本使用独立 `pa24` schema |
| `PA24_WORKSPACE` | 首次启动绑定的绝对工作区目录（也可在面板或设置里选择） |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | 飞书自建应用凭据（feishu 模式） |

`AGENTS.md` 字段：`mode`（demo/feishu）、`storage`（sqlite/postgres，默认 sqlite——账本默认是工作区 `data/pa24.db`，SQLite 用 Node 内建 `node:sqlite`（本包支持的 Node 范围内均免 flag）；显式 `postgres` 时才需要 `pgDsnEnv` 与外部数据库）、`larkProfile`、`ownerOpenId`、`folderToken`、`wikiNodeToken`（可选——已配置时备忘与手写待审文档建到该飞书知识库节点下，留空回退 folderToken）、`tasklistId`、`calendarId`、`calendarChannel`/`todoChannel`/`notifyChannel`（feishu|wecom，默认 feishu——企微作日程/待办第二操作渠道＋提醒单向推送，永不收信）、`timeZone`、`appIdEnv`/`appSecretEnv`/`pgDsnEnv`、`maxWorkers`、`enabledWorkers`、`workerModels`、`extraBusinessSkills`（kebab-case 放行名单，把工作区业务 skill 释放给模型执行）、`tts`（`engine` none/melo/volcengine、`voice`、`volcKeyEnv`、`meloDir`——语音简报走火山豆包云端或本地 Melo）、`extraLocalTools`（subagent_codex、subagent_claude_code，以及经 `mcp__qwennote__*` 通配或精确名放行的 QwenNote 听记工具；点名未挂载工具的条目会被过滤并在健康里提示）。配置飞书接入时，对本地会话说「帮我接通飞书」，或调用 `pa24_connection` 的 `action=guide`；内置 `feishu-setup.md` 是唯一权威。

### 已登记的日程与待办来源

在「参数配置 → 日历与待办来源」登记个人、公司或项目的平台资源，保存名称、身份、用途、可见范围、默认角色、公司／项目映射和读写意图。登记本身不授予平台权限；普通卡片浏览读取保存的观察，点击核验或通过对话查询才读取平台。

工作区 `AGENTS.md` 中同一配置块的 `sources` 是来源权威。旧字段只生成稳定迁移候选，保存来源编辑器后才物化；显式空登记保持为空。移除来源不会删除远端对象或历史，改变全局默认也不会改绑已有操作与计划。

日程查询聚合所有已启用来源，写入按明确来源、公司／项目映射、默认来源选择唯一目标。待办使用同一登记与证据模型，支持 `all`、`responsible`、`following`、`assigned`、`creator` 五档默认角色；本次明确角色只覆盖本次查询。创建、完成、延期、修改与取消都保持原平台对象和来源，平台待办状态与助理交办执行状态分开。

schema 20 为两种账本增加来源登记、访问证据、平台对象、来源观察与成员关系。升级前停止宿主并联合备份账本、工作区身份／配置和原生会话历史；回退恢复整组备份与对应代码，不删除迁移记录，也不让新旧宿主共用账本。

### 暴露工具

外部 CLI 委派行已随包启用但保持休眠：`subagent_codex` 与 `subagent_claude_code` 仅在对应 provider 包（`@deepseek-ai/dsh-subagent-codex` / `-claude-code`）安装进 Profile 后挂载，且工作区须再经 `extraLocalTools` 显式开启——点名了未挂载工具的条目会在 `tools.restrict()` 之前被过滤并进入维护健康提示，provider 或通道缺失不再导致会话创建失败。QwenNote 听记工具经宿主面过同一道门：在 Profile patch 添加 `serverName: qwennote` 的 `dsh-mcp-client` 条目（stdio＋`mcp-remote` OAuth 桥，锁版本），由本人浏览器完成一次授权，再经 `mcp__qwennote__*` 放行。`ralph` 对本地会话可用，遵循其工具契约：仅在本人明确要求时使用。

### 你会得到什么

- 「24私助」预设：标准插件全集（平台 shell、文件、检索、jobs、skill、skill-filesystem、tool-skill、goal、plan-mode、压缩、通用委派、ask-user、todo、web、present、ralph）＋`pa24-agent`；persona 文案已并入助理身份；`tool-schedule` 刻意不并入——时钟型提醒走日历原生日程，账本留备份行。
- 按角色裁剪的工具面：本地会话获得完整标准工具面＋全部 `pa24_*` 工具；飞书接入会话与 Worker 保持业务白名单（同一预设绝不意味着同一权限）。
- 宿主插件：固定飞书接入与本地会话、八个 `pa24_*` 业务工具、默认 SQLite 账本（可选 PostgreSQL）＋Outbox 回执、任务 Skill 运行时、日历原生提醒、语音简报、手写审核，以及事务与计划、知识与资料、接入与设置、运行与维护四分类共十六卡面板。参数配置校验并写回 AGENTS.md 后重载；密钥使用只写的 0600 工作区密钥库，环境变量是可选覆盖；健康、预算与备份各有独立运维卡片。企微接入走随包 `wecom-setup.md`（`pa24_connection action=wecom_guide` / `wecom_check`）。

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
- **日历是时钟型提醒的权威。** `tool-schedule` 的排除是有意为之：时钟型提醒按 `calendarChannel` 写成带原生提醒的日程，24私助离线也照发；账本保留 delegated 备份行供历史与防重（ADR-0001，2026-10-18 修订）。
- **材料永远不构成授权。** 笔记、文档、子 Agent 回复与抓取的网页内容都只是输入；只有本人的明确指令才授权外部写入。密钥只存于服务器环境或工作区私有密钥库，不进入 AGENTS.md、系统提示或备份。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Profile 补丁层：预设行＋宿主插件行 |
| [`src/index.ts`](src/index.ts) | 插件入口：配置模式、runtime 装配、面板 |
| [`src/tools.ts`](src/tools.ts) | 工具注册、`STANDARD_CODING_TOOLS`、`ROLE_TOOLS` |
| [`src/prompts.ts`](src/prompts.ts) | 全部内置提示词与 `PROMPTS_VERSION`、AGENTS.md 模板 |
| [`src/runtime.ts`](src/runtime.ts) | 角色、委派、账本流程、提醒、简报、备份 |
| [`src/feishu.ts`](src/feishu.ts) | SDK 长连接传输、接入诊断、`setupNextSteps` |
| [`feishu-setup.md`](feishu-setup.md) | `pa24_connection guide` 服务的内置接入指南 |

### 运行流程

启动时宿主插件对 `$DSH_HOME/24pa` 取单写锁，打开账本（默认 SQLite 工作区文件，或 PostgreSQL），加载并校验工作区 `AGENTS.md`，经 SessionController 建立固定的飞书接入与本地会话。入站飞书事件先耐久落 inbox 再确认；协调者经 continuable child API 委派 Worker，每个事项记录 origin、父会话与固定投递目标。定时循环带回执地排空 Outbox、触发到期的非 delegated 提醒、核验已发布笔记指纹、经原生 Schedule 服务唤醒简报计划；结果回到实际发起入口。agent 创建时角色白名单裁剪继承的工具目录；`AGENTS.md` 重载只替换工作区规则提示段，失败时不触碰生效配置。

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

当包级契约不够时读这些页面。它们从本 bundle 延伸到它实现的产品与它接入的平台。

- [产品规格](../../docs/24PA-v1-SPEC.md)——每个已交付功能背后的故事、场景与测试组。
- [整体设计](../../docs/24PA-整体设计方案.md)——流程、会话拓扑与已确认取舍。
- [ADR-0001](../../docs/adr/0001-workspace-session-boundaries.md)——本预设执行的工作区/会话权限边界。
- [研究记录](../../docs/research/)——分功能的已验证契约，含双基线与接入向导研究。
- [仓库与发布](https://github.com/benz-ai-x/dsh-24-PA)——源码、Release 与交付计划。

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

- **仍需按环境完成真实核验**——Manticore 真实账号角色、更广的租户／Lark 地区兼容性、实际设备提醒、QwenNote 真机和供应商账单核对，都需在部署环境验证；见 [Manticore 交付验收](../../docs/planning/24PA-Manticore-交付验收.md)。
- **手写识别质量未量化**——多页转写保真度需 30–50 页真实样本评测后才能作任何准确率表述；视觉路由须在 `workerModels` 配置。
- **dsh 0.2.0-rc.2 宿主不带 schedule 服务**——安装 schedule 伴随件之前，简报与会前准备如实不可用；伴随件在宿主面新增的 `schedule_*` 工具无法被预设裁剪隐藏。
- **外部 CLI 委派默认休眠**——`subagent_codex`/`subagent_claude_code` 须安装对应 provider 包并经 `extraLocalTools` 显式开启后才挂载；未配置时工具缺席而非报错。
- **每个状态目录单写**——同一 `$DSH_HOME/24pa` 上的第二个 pa24 宿主会因锁拒绝启动；每个状态目录只跑一个宿主。
- **管理界面只面向电脑端**——面板按电脑视口设计与验收，不提供手机响应式产品界面；飞书与企微原生 App 保持各自平台行为。

<a id="维护者备注"></a>
### 维护者备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本备注面向维护者。已交付行为与限制以正文章节和包代码为准；历史测试数量属于对应的 dated 验收记录，不作为本 living 文档的长期状态。

- **多基线验证**——当前活跃发版线为 0.2.1-rc.5。回归运行用 `DSH_BIN` 选运行时，并以 `PA24_E2E_EXTRA_PLUGINS` 附加 0.2.0-rc.2 的 schedule 伴随件；旧基线沿用各自文档中的兼容路径。
- **预设补丁为生成物**——`cordis.patch.yml` 由 `scripts/sync-preset.mjs` 对 devDependency 钉住的 `@deepseek-ai/dsh-web-app` 标准预设应用 delta 生成，勿手改；换新 dsh 基线时先改 pin 再跑 `npm run preset:sync`，`npm run preset:check` 与单测守护已提交副本不漂移。
- **本地 harness 相邻性**——dev 类型检查经 `scripts/link-peer.mjs` 从相邻的 `deepseek-harness` checkout 链接 vendored peers；registry 安装不依赖该 checkout。

</details>
