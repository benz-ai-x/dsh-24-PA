# dsh 源码与插件机制：24PA 设计依据

调研日期：2026-10-05（Asia/Shanghai）。源码：`/Users/pc2026/DSH-Space/deepseek-harness`，HEAD `5badb15009ae1756c3afe0ae0cef1faafc290ccc`；`dsh-base` manifest 版本为 `0.2.1-alpha.1`。本笔记只记录源码和文档核查，以及据此提出的设计建议；没有安装插件、启动 dsh、访问用户飞书、调用视觉模型或编写插件实现。因此文中的精简组合与识别效果仍需开发获批后的验证。[版本依据](/Users/pc2026/DSH-Space/deepseek-harness/packages/bundle/base/package.json:4)

本文的设计建议已随第一次审核更新：业务直接使用 Docker PostgreSQL、常规助理为主线、同 Host 管理多个 dsh Session。更细的调度与会话限制见 [存储与调度](第一轮审核-存储与调度复用.md) 和 [多会话与恢复](第一轮审核-多会话与恢复.md)。

## 1. 主要结论

24PA 适合做成外部 Cordis bundle，默认加载到服务器既有 dsh Host 的组合中常驻，直接复用多个既有 Session；不默认另起独立 home/进程。复用 dsh 的模型路由、Agent/Session、附件、工具执行、凭据引用和持久化设施；24PA 自己负责飞书消息入口与出口、笔记处理状态、人工审核、提醒投递和恢复策略。无需修改 agent-loop，也不应另造独立 Node 应用入口。[应用入口规则](/Users/pc2026/DSH-Space/deepseek-harness/docs/architecture.md:43) [扩展点](/Users/pc2026/DSH-Space/deepseek-harness/docs/architecture.md:139)

最容易误判的四个事实：

- `schedule` 的“已投递”只表示提醒已进入原 Session 的持久化 inbox，并不表示模型处理完成、飞书发送成功或用户已读。它自身不提供发送失败定时重试，而且跨 Session 与任务记录的写入可能重复。[Schedule 实现说明](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/README.md:63) [限制](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/README.md:153)
- `jobs-local` 是进程内任务；`workflow` 没有持久化检查点和重启续跑。跨天的“待人工审核”必须进入 24PA 持久化业务状态，而不是保留一个等待中的 Agent、job 或 workflow。[Jobs](/Users/pc2026/DSH-Space/deepseek-harness/packages/jobs/jobs-local/README.md:30) [Workflow](/Users/pc2026/DSH-Space/deepseek-harness/packages/workflow/workflow/README.md:127)
- 当前源码中没有找到可直接复用的飞书 IM 收发适配器；既有 `webhookRuntime` 也不提供持久化队列、去重、重试或崩溃重放。[Webhook 语义](/Users/pc2026/DSH-Space/deepseek-harness/docs/subsystems/webhook.md:19)
- dsh 可接收视觉输入，但图像 admission 和模型请求都会按配置缩放、重编码。原始手写笔记需要独立保真保存，不能把规范化后的模型附件当成原件。[附件处理](/Users/pc2026/DSH-Space/deepseek-harness/packages/attachment/attachment-local/README.md:57) [模型图像处理](/Users/pc2026/DSH-Space/deepseek-harness/packages/llm/llm-deepseek/README.md:92)

## 2. 插件、bundle、profile 和生命周期

dsh 的所有产品能力由 Cordis 插件提供。插件通过 `inject` 声明服务依赖，通过 `ctx.<service>` 使用能力；服务注册、事件订阅、工具注册等是可清理的 effects。无需靠 YAML 行序手工安排启动，依赖注入决定激活顺序。[Cordis 五个概念](/Users/pc2026/DSH-Space/deepseek-harness/docs/cordis-primer.md:7) [基础组合注释](/Users/pc2026/DSH-Space/deepseek-harness/packages/bundle/base/cordis.patch.yml:12)

发布单元可以是一个包：`package.json` 中声明 `dsh.bundle.patch`，补丁插入一个或多个 Host 插件行。函数插件使用命名导出 `name / inject / Config / apply`；服务插件默认导出 Service 子类，不能混用两种导出形式。TypeScript 服务通过 declaration merging 扩展 Context；运行配置使用 schemastery，在激活时校验。[Bundle 声明](/Users/pc2026/DSH-Space/deepseek-harness/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md:3) [导出与配置](/Users/pc2026/DSH-Space/deepseek-harness/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md:57)

profile 位于 `$DSH_HOME/profiles/<name>`。组合顺序为：profile 所列 bundles → profile 补丁 → home 补丁 →命令行 `--patch`。同 id 的补丁替换整份 `config`，不是逐字段合并。外部插件的 DSH peer dependency 范围在加载前校验；本项目应声明并锁定已验证的 DSH 版本范围，并在升级时跑真实组合测试，不能依赖“安装成功即兼容”。[分层](/Users/pc2026/DSH-Space/deepseek-harness/docs/architecture.md:15) [兼容检查](/Users/pc2026/DSH-Space/deepseek-harness/packages/boot/app-boot/README.md:50)

建议 24PA 以一个 bundle 分发，在代码中划分业务服务、飞书 transport、飞书 CLI gateway、笔记识别与审核、提醒 dispatcher 等模块；是否拆成多个 npm 包可以延后。每个可替换能力先定义服务接口，再接当前唯一的飞书实现，避免在业务状态里存放 SDK 对象。宿主 root scope 放连接、存储、恢复调度等常驻服务；专用 `24pa` Agent preset 放人格、领域工具和上下文，不把每个 Session 都变成新的机器人连接。[能力服务结构](/Users/pc2026/DSH-Space/deepseek-harness/docs/architecture.md:131)

卸载/关闭时应先停止接收新事件，再取消定时器和识别请求，等待已接纳的落盘操作，最后关闭存储与连接。把有严格先后关系的资源放在一个 effect owner 中；不要假定不同插件并行 dispose 有固定顺序。此处是 24PA 的生命周期设计要求，不是已完成实现。[Effect 清理规则](/Users/pc2026/DSH-Space/deepseek-harness/docs/cordis-primer.md:41) [Schedule 关闭窗口](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/README.md:154)

## 3. 服务器常驻组合

`headless` 是一次任务执行后自动退出的 runner，适合命令行批处理，不适合作为全天候飞书机器人的运行模式。应在现有常驻 Host 的 profile 中挂载 24PA 长连接/服务插件，由服务器服务管理器负责开机启动和异常重启。[Headless 行为](/Users/pc2026/DSH-Space/deepseek-harness/packages/bundle/headless/README.md:28) [生命周期](/Users/pc2026/DSH-Space/deepseek-harness/packages/bundle/headless/README.md:60)

以 `dsh-base` 为基础能获得 Agent、模型路由、Session 持久化、附件、storageDomain、凭据等能力。`schedule` 与 `sessionController` 不在 base，而是 Web bundle 补入，因此不能宣称“任何 dsh profile 默认都有 schedule”。[Base 声明](/Users/pc2026/DSH-Space/deepseek-harness/packages/bundle/base/cordis.patch.yml:130) [Web 的 controller 与 schedule](/Users/pc2026/DSH-Space/deepseek-harness/packages/bundle/web-app/cordis.patch.yml:120)

精简 `base + 24pa bundle` 复用 SessionController/Schedule 的候选新增行如下。这是源码依赖推导，尚未通过 Loader 启动验证：

| 插件 | 必须补入的原因 | 直接依赖依据 |
|---|---|---|
| `@deepseek-ai/dsh-workspace` | Session 的 Workspace 管理 | `storageDomain`、`sessionPersistence`；[源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/workspace/workspace/src/index.ts:171) |
| `@deepseek-ai/dsh-client-connection` | 为 fileUploads 提供 Host RPC/Fetch registry | `credentials`；[源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/client/connection/src/index.ts:88) |
| `@deepseek-ai/dsh-client-file-upload` | SessionController 的必需服务，即便飞书图片另行下载 | `agents`、`attachments`、`commands`、`connection`；[源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/client/file-upload/src/index.ts:55) |
| `@deepseek-ai/dsh-api-session-controller` | 复用原 Session 激活/恢复及并发恢复去重 | `agentDefaultModel`、`agents`、`attachments`、`fileUploads`、`fs`、`llm`、`sessions`、`sessionProjections`、`sessionQuery`、`typert`、`workspaceRegistry`；[源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/api/session-controller/src/index.ts:103) |
| `@deepseek-ai/dsh-schedule` | 首版主动助理工作的定时唤醒 | `agents`、`sessions`、`storageDomain`、`sessionController`、`sessionPersistence`；[源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/src/index.ts:91) |

`client-connection` 这个包名不代表必须装浏览器 UI。Host 入口先注册 carrier-neutral 服务，仅在 `webServer` 存在时挂载 `/api`；因此上述候选组合可不开放 dsh Web 管理端口。若需要飞书 HTTP 回调，可以另挂隔离的回调 server；若使用可满足事件需求的长连接模式，则连接由飞书 adapter 持有。飞书事件类型在长连接中的支持范围需由飞书能力调研确认。[可选 WebServer 注入](/Users/pc2026/DSH-Space/deepseek-harness/packages/client/connection/src/index.ts:117)

P0 验证应把真实 profile/bundle 补丁经 dsh Loader 启动，验证所有必要服务已经激活、重启能读取业务状态，并在 shutdown 后没有残留连接/定时器。源码要求产品能力有真实 composition 测试，单纯 `ctx.plugin(...)` 的单元测试不充分。[组合测试要求](/Users/pc2026/DSH-Space/deepseek-harness/packages/AGENTS.md:7)

app-boot 对普通可选插件失败会警告后继续启动，其硬必需列表只包含约定的核心 entry id。因此服务器进程存活不等于 24PA 已可服务：部署应检查 24PA 自己的 readiness，至少包括业务域可读写、必要服务已激活、飞书连接/发送授权可用；启动失败须可见并由服务管理策略处理。不要把“dsh 返回就绪”直接当成 24PA 上线验收。[启动失败策略](/Users/pc2026/DSH-Space/deepseek-harness/packages/boot/app-boot/README.md:43) [可选与必需插件](/Users/pc2026/DSH-Space/deepseek-harness/packages/boot/app-boot/README.md:90)

## 4. Session、消息可靠性与执行状态

Session 是追加式事件日志，模型输入必须能从日志重建。模型可见的飞书文本、识别材料与工具返回必须按已支持的 Session/消息通道写入，不能只存在进程内临时上下文。Session 适合保存交互历史；“笔记是否审核通过、哪个提醒待发送、某次 CLI 写操作是否待核对”适合保存为独立业务域。[日志原则](/Users/pc2026/DSH-Space/deepseek-harness/docs/architecture.md:121) [非 Session 业务存储](/Users/pc2026/DSH-Space/deepseek-harness/packages/storage/storage-domain/README.md:28)

SessionController 的 `resolveAgent` 对同 Session 的并发恢复共用一个 Promise，应该复用这一入口，而不是消息入口、schedule 和笔记恢复各写一套冷启动逻辑。[恢复去重源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/api/session-controller/src/agent.ts:166)

`sessionController.prompt()` 会依据 `requestId` 检查已接纳的请求，并生成带 `source.kind: user`、`rpcId` 的消息；它检查图片所选模型能力并调用附件 admission，最后 `followup/steer`。返回 `accepted: true` 是接纳确认，不等于完成业务动作；该函数没有额外 Session flush。若 24PA 使用它，仍需要自己的 durable ingress 去重记录和合适的持久化确认。其 `clientTimeZone` 字段可显式传 `Asia/Shanghai`，避免无浏览器场景继承错误的自然语言时间解释。[Prompt 源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/api/session-controller/src/commands.ts:307)

建议入口先持久化飞书事件 id、owner、chat/message 关联和处理状态，再异步进入 Agent。向飞书回传最终答复应从已提交的 Assistant/turn 结果生成出站意图，并带稳定的发送去重键；不要直接把 `agent/assistant-stream` 的临时 token 当成不可撤回的聊天消息。现有流式事件属于进程内瞬态数据，完整 Assistant 输出只有在 settled 后才入日志。[流与日志区别](/Users/pc2026/DSH-Space/deepseek-harness/docs/architecture.md:109)

不必为日常私聊每条消息创建新 Session。可保留多个真实 dsh Session 的绑定和一个当前指针，统一使用固定飞书 profile，同时把每份笔记的处理放到独立业务对象，必要时创建独立处理 Session，以避免长笔记阻塞随手指令。跨会话引用采用 `noteId/sessionId` 显式映射；审核的最终权威在业务记录和已确认的文档版本中，而不在模型说“已审核”的文字里。这些是 24PA 设计建议。

## 5. 主动提醒：复用范围与需要新增的部分

dsh Schedule 支持 `after`、`at`、`every`、`daily`、`weekly`、五字段 `cron`。绝对时间需要时区偏移或显式 IANA zone；每天定时不等于固定 86400 秒。缺失的 DST 当地时间跳过，重叠选较早一次；已经提交的 `scheduledAt` 在重启时保留，后续发生时间使用服务器当前 IANA 数据。[时间规则](/Users/pc2026/DSH-Space/deepseek-harness/docs/subsystems/schedule.md:98) [重复与补发](/Users/pc2026/DSH-Space/deepseek-harness/docs/subsystems/schedule.md:142)

Schedule 开机扫描 active 记录；过期循环任务仅贡献最近一次错过的 occurrence，不积压全部次数。同 Session 同一扫描的循环任务合并为一次 follow-up，一次性任务分别发送；无需等待 Agent idle。结束的任务存为 inactive，只有显式删除才物理删除。[补发语义](/Users/pc2026/DSH-Space/deepseek-harness/docs/subsystems/schedule.md:146) [记录语义](/Users/pc2026/DSH-Space/deepseek-harness/docs/subsystems/schedule.md:9)

Schedule 管理与 due delivery 共享 FIFO。更新带完整 `expected` 记录，以 compare-and-set 防止覆盖另一编辑或调度推进。但这些能力只在单 Host 内解决并发，不是多服务器分布式调度。Schedule 服务的 Session 绑定也不是调用者授权检查。[更新并发](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/README.md:53) [限制](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/README.md:157)

真实投递顺序为：恢复原 Agent → 生成 reminder UserMessage → `agent.followup` → `ctx.sessions.flush` → 更新 task 的最后投递记录和下次时间。两次持久写不原子，崩溃窗口可能重复；失败任务保留但没有自动 retry timer。默认 JSON backend 每次还会改写整个 schedule 域。[源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/src/runtime.ts:100) [持久确认与限制](/Users/pc2026/DSH-Space/deepseek-harness/packages/schedule/schedule/README.md:65)

因此推荐两类机制：

- **需要模型做工作**：晨报、晚间复盘、每周计划，通过 dsh Schedule 唤醒普通根 Session；24PA 以 occurrence 去重，生成完成后走自己的飞书 outbox。
- **需要按时告知事实**：会议前提醒、用户指定的定时提醒、待审核提醒，复用 `dsh-schedule` 包根公开的 `create*ScheduleRecord / resolveRecurringOccurrence` 时间算法，再由 24PA PostgreSQL 到期实例与 Outbox 直接生成模板消息并发往飞书；无需等待模型完成推理。消息应使用 `reminderId + occurrence + channel` 的稳定去重键，区分待发、发送中、接口已接收、失败待重试和需人工处理。

24PA dispatcher 应记录下一次重试时间，遵循飞书限流/重试信号，持久化尝试次数，启动扫描 due 与未完成 effects，并按事项类型定义停机过期策略：会议已经结束时不再发送“十分钟后开会”；长期重要待办可补发并注明延迟；日汇总只补最近一次。数据库落盘与外部发送无法整体原子提交，对结果不明的写操作应先核查，不能承诺 exactly-once。这里是新增设计要求，而非 Schedule 既有能力。

## 6. 持久化：PostgreSQL 业务事务与现有 dsh 存储分工

用户已确认 PostgreSQL 通过 Docker 安装、应用直接连接。24PA 业务状态、会话路由、审核凭证和 Outbox 使用独立 schema 中的 PG 表，不采用 SQLite，也不默认先开发通用 dsh PG provider。Session 日志、附件、原生 Schedule 域继续复用 dsh 已有非 SQLite 实现；如将来要求这些域也入 PG，再考虑符合公开契约的窄适配。

dsh 提供 `storage` hub、`storage-domain` 与 JSON/SQLite backend；这里的 SQLite 是源码组件事实，不是 24PA 部署选择。`storageDomain` 是进程内加载与单域写队列，不提供 SQL 事务、二级索引或跨进程变更同步。[Storage 路由](/Users/pc2026/DSH-Space/deepseek-harness/packages/storage/storage-domain/README.md:60) [Domain 限制](/Users/pc2026/DSH-Space/deepseek-harness/packages/storage/storage-domain/README.md:139)

`update(key, fn)` 在队列位置读取最新记录，调用同步 transform，await backend 持久化后才更新内存；版本检查应放在 update 内。`await put/update` 已是其持久化完成点，close 排空已入队写后释放 unit。换成 PG backend 不会使两次 put 变成一个跨表事务。[Update 源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/storage/storage-domain/src/domain.ts:332) [队列](/Users/pc2026/DSH-Space/deepseek-harness/packages/storage/storage-domain/src/domain.ts:263) [关闭](/Users/pc2026/DSH-Space/deepseek-harness/packages/storage/storage-domain/src/domain.ts:225)

24PA 的 `PaRepository` 直接管理业务 PG 事务，例如审核决定、版本状态与文档同步 Outbox 同一事务提交；飞书网络调用在事务外执行。PG 与 dsh JSONL、飞书之间没有共同事务，仍需 requestId、执行回执和恢复对账。首版一个活跃 Host，不因 PG 已存在就宣称 dsh 内存域或 Session 自动支持多活。具体接口边界和无 SQLite query 配置见 [第一轮存储研究](第一轮审核-存储与调度复用.md)。

## 7. 手写识别、原图和审核

源码中的 DeepSeek adapter 已实现 image input、Files API 引用、base64 fallback、图像预算与 offload。`models[].inputModalities` 必须包含 image，且 `attachments` 服务存在；不支持 image 的 route 不能通过“提示模型读图”补足能力。另一个 `llm-pi-ai` adapter 可声明多供应商 image route。源码列出的模型默认值是这个 checkout 的配置事实，不是实际账号可用性或中文手写准确率的保证。[能力检查源码](/Users/pc2026/DSH-Space/deepseek-harness/packages/llm/llm-deepseek/src/images.ts:38) [模型与路由配置](/Users/pc2026/DSH-Space/deepseek-harness/packages/llm/llm-deepseek/README.md:34) [Pi-ai image 声明](/Users/pc2026/DSH-Space/deepseek-harness/packages/llm/llm-pi-ai/src/config.ts:140)

附件本地服务默认把图片规范化在 `2048 × 2048` 总像素预算内，应用 EXIF 朝向、去掉 metadata/color profile，并可能转换为 JPEG/WebP。模型请求又会按 route 的预算缩放；DeepSeek 当前默认方图约 1302×1302。小字、混排英文、日期数字和图中箭头可能因整页缩小丢失。因此建议保留三层材料：原始文件 bytes+hash；供文档对照的可视原页；供识别的规范化全页与局部高分辨率裁剪。原件可存附件的 generic-file 通道或 24PA 管理的 raw object，不能只存 `ImageAttachmentRef`。[附件默认值与流程](/Users/pc2026/DSH-Space/deepseek-harness/packages/attachment/attachment-local/README.md:38) [Generic file 保真](/Users/pc2026/DSH-Space/deepseek-harness/packages/attachment/attachment-local/README.md:90) [模型 request 图像预算](/Users/pc2026/DSH-Space/deepseek-harness/packages/llm/llm-deepseek/README.md:94)

据此建议的识别流程：质量检查/页序确认 → 逐页忠实转写（不确定字保留候选与区域定位）→ 结构整理（保留原意，待办与图示单独识别）→ 飞书文档草稿 → 人工审核 → 审核记录与文档状态同步。原文转写与整理结果分层，避免无法区分“图上写的”与“模型补充的”。日期、金额、人名、英文缩写和待办动作作为重点复核字段；模型自报 confidence 不作为审核通过依据。简单图示可优先保留裁剪图，并附文字解释，不强制变成可能错误的流程图。

人工审核应是服务端校验的业务命令：校验 owner、noteId、草稿版本/文档内容 hash、card action id，落盘 `approvedVersion/approvedBy/approvedAt`。LLM 工具无权把 `pending_review` 自行改成 `approved`；文档里的标识是权威记录的投影，需要可重试同步。审核后内容变更应使旧版本批准失效，或者明确只批准一个冻结快照。等待审核时没有需要继续运行的 Agent job。这一设计由业务需求推导，dsh 未提供现成的飞书文档审核状态机。

识别模型与主助理模型建议分别配置并记录具体 provider/model/version、模板版本和输入材料 hash。中文为主、夹英文/待办/简单图示的样本集应先以用户实际笔迹作评估，记录字符与关键字段错误、遗漏、无法判断率及复核耗时。没有评估前不要承诺“识别准确率 99%”或默认某个模型一定胜任。

## 8. 数据路径与验收重点

这个 checkout 的 base 默认挂载 `session-log-deepseek`，该插件默认 `enabled: true`，在普通模型输入之外把完整 Session 事件增量加入官方请求的 `dsh_session_log` 字段。OTel 的反馈日志是另一条独立路径。建议关闭非必需的 24PA 额外日志上传；同 Host 下如开关全局生效，安装前列明对既有会话的影响，并单独明确普通视觉/文本输入仍发送给选定模型服务。关闭额外日志不等于模型处理全部本地化。[Session-log 配置](/Users/pc2026/DSH-Space/deepseek-harness/packages/session/session-log-deepseek/README.md:26) [请求字段](/Users/pc2026/DSH-Space/deepseek-harness/packages/session/session-log-deepseek/README.md:40) [OTel 授权](/Users/pc2026/DSH-Space/deepseek-harness/packages/session/session-telemetry-otel/README.md:14)

获批开发后，需要用故障与恢复场景验证设计，而不只验证正常路径：

1. 真实 Loader 组合启动、必要服务齐备、卸载无连接/定时器残留。
2. 同一飞书事件重复到达、乱序到达、落盘后立即重启，只产生一个业务 Note/Operation。
3. 识别完成、创建文档、写文档、发审核卡片每一步发生网络失败或进程退出，重启均能从 PostgreSQL 工作记录与 Outbox 恢复；结果不明的外部写先核对。
4. 同一审核按钮重复点击、旧草稿卡片点击、非 owner 点击、审核后文档被改，不出现错误“已审核”标记。
5. 提醒发生在服务器离线期间、模型不可用、飞书限流、用户静默时段，补发/过期/重试符合已定义策略。
6. 日历事件被改期/取消，旧 occurrence 不再误发；确定性提醒不依赖模型队列是否繁忙。
7. 中文小字、英文缩写、划掉/勾选、日期金额、简单图示、多页顺序和模糊图输入有人工可核对的来源。
8. 固定 DSH 版本范围并记录升级验证；业务域版本变化有显式迁移策略，PG 业务 schema 和 dsh 域格式分开管理，不能修改版本号就期待旧数据自动迁移。

飞书 CLI 的命令契约、bot/user 两套授权、卡片回调、文档 revision 与事件支持仍以飞书能力研究为准；本笔记只证明 dsh 侧的复用点和限制，不推断外部 API 尚未验证的保证。
