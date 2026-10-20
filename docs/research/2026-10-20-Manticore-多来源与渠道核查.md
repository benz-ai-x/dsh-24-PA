# Manticore 多来源、日程、待办与渠道核查

日期：2026-10-20。代码基线：`67172733b0405718edd78e19d114a5ef6adc4db7`。需求依据：[已确认产品定稿](../planning/24PA-Manticore-产品定稿.md)。本文是实施研究，不表示目标功能已交付。

本次只读取仓库、GitHub 工单、官方公开资料及已安装 CLI 的版本、help、schema；没有调用真实账号的业务读写、身份查询或凭据接口，没有改变 CLI 版本。`lark-cli 1.0.87`；`wecom-cli 1.3.4`，构建提交 [`f9b28151dc8d42f703db624fc9b26723c3c93fc5`](https://github.com/WecomTeam/wecom-cli/commit/f9b28151dc8d42f703db624fc9b26723c3c93fc5)。公开文档与机器契约不一致的地方保持待核验，不能据任一侧推断真实租户已支持或不支持。

## 结论

现有渠道网关、外部动作账、按原渠道刷新、日历完整观察后再替换投影、日期精度及未知结果阻断可以复用。本轮主要新增的是**登记来源和冻结写入目标、完整远端查询、多来源对象关联、真实角色与操作影响**，不能仅把原来的单渠道选择器改成数组。

飞书具备多日历、任务清单、明确负责人/关注人及分页接口；当前代码尚未消费其中若干能力。企微修改日程、修改/完成/删除待办的命令存在，但多日历容器选择、本人待办的角色映射及非机器人创建对象的查询覆盖仍有证据缺口。尤其企微同版官方材料存在身份口径冲突，须在相应功能实施前解决，不能把适配器遗漏写成平台能力限制。

## 已有能力与差距

| 方面 | 基线中可以复用 | Manticore 所需增量 |
|---|---|---|
| 配置与路由 | `PaConfig` 保存一个 `calendarId`、一个 `tasklistId`、按域单选渠道；配置保存已有校验和生效隔离 | 分别登记日历/待办来源、默认筛选、用途、项目映射与读写证据；明确来源→映射→默认的唯一解析；未登记资源拒绝直接写入 |
| 已有对象变更 | `TaskLifecycle` 按对象保存的渠道刷新/更新；`calendarWrite` 优先查原投影的渠道及日历 | 将原对象定位扩到具体授权身份、资源与影响范围；默认来源变化不改变旧对象或既有计划 |
| 待办读取 | 单项 `get` 按精确 GUID/ID 核对远端；本地投影有 stale 语义 | `taskList` 目前只读本地数据，普通列表默认最多 50 条，没有远端全来源发现、分页总数或负责人/关注人投影；须包含非助理创建对象 |
| 日程读取 | 按单日历窗口同步；失败保留旧水位，完整观察才使消失对象失效 | 全登记来源聚合、分源完整性、本人参与/组织证据、跨源合并和冲突；默认渠道目前仍决定唯一查询渠道 |
| 写入 | 两渠道 staged operation、已知回执补本地、未知结果禁止盲重发 | 同一动作持久保存解析后的平台、身份、容器、角色及授权依据；禁止恢复时读取新默认解释旧回执 |
| 身份与诊断 | 飞书固定 profile 与主人 open_id 核对；企微显式检查刷新授权真人、失败清空缓存 | 登记和运行关联应用/企业/机器人/真人身份及配置代次；逐资源、逐能力证据，身份变更使旧证据失效 |

代码证据：[`config.ts`](../../packages/24pa/src/config.ts) 的 `PaConfig`/字段表；[`runtime.ts`](../../packages/24pa/src/runtime.ts) 的 `calendarQuery`、`calendarWrite`、`taskList`；[`task-lifecycle.ts`](../../packages/24pa/src/task-lifecycle.ts)；[`calendar-observation.ts`](../../packages/24pa/src/calendar-observation.ts)；[`external-operations.ts`](../../packages/24pa/src/external-operations.ts)；[`feishu.ts`](../../packages/24pa/src/feishu.ts) 的资源及身份检查；[`wecom-channels.ts`](../../packages/24pa/src/wecom-channels.ts) 的 `wecomOwnerUserid`/`inspectWecom`。以上按固定基线评估，后续行号随实施变化。

### 存储身份须先扩展

当前 `calendar_event.event_id` 是全局主键，`calendar_sync_state.calendar_id` 是主键；`TaskRow.task_guid` 全局唯一，任务未保存来源清单、负责人、关注人。`CalendarRepo.upsertEvent` 会拒绝相同 event_id 来自不同日历的记录，属于现有单来源保护，不能直接用于多来源成员关系。参见 [`db.ts`](../../packages/24pa/src/db.ts) 的任务/日历建表与 v11 渠道迁移、[`repo/calendar.ts`](../../packages/24pa/src/repo/calendar.ts)、[`repo/task.ts`](../../packages/24pa/src/repo/task.ts)。

建议分开保存平台对象身份与来源成员关系：对象至少包含平台、已核验身份、原生 ID；日程原定位还包含日历及实例/系列标识。来源关系分别保存可见状态、角色、权限和核验时间。查询可以合并展示已确认同一对象，修改仍指向唯一原定位。某来源查询失败、移除或对象退出该来源，不能把其他来源下的对象判成全局删除。

## 固定版本的平台能力

### 飞书

| 目标 | 核实结果及实现选择 | 证据边界 |
|---|---|---|
| 登记多个日历 | `calendar calendars list/get/primary` 存在；`get` 返回实际 ID、日历类型及当前身份的 `role`。`permissions` 是公开范围，不能当当前用户写权限 | 本机 1.0.87 schema；原生列表对日历类型、调用身份有范围限制，逐来源验证，不能由“用户在 App 可见”推断 API 可读 |
| 完整时间窗查询 | 现用 `+agenda` 内部调用 `instance_view`，对超过 40 天及超量错误切窗，合并去重；它不是仅取一页的普通 `events list` | [1.0.87 源码](https://github.com/larksuite/cli/blob/v1.0.87/shortcuts/calendar/calendar_agenda.go#L30)。不能把缺少本地翻页循环误报成现有日历一定截断 |
| 本人参与/组织筛选 | `+agenda` 会删去 attendees；原生 `instance_view` 的 attendees 也只承诺会议室。真实用户参与/组织关系需按对象读 `calendar event.attendees list` 并翻完分页，或取得等价可靠证据 | [shortcut 输出处理](https://github.com/larksuite/cli/blob/v1.0.87/shortcuts/calendar/calendar_agenda.go#L219)；本机 `calendar.events.instance_view`、`calendar.event.attendees.list` schema。关系查不到须标范围不完整 |
| 日程查询替换接口 | 官方 `events list` 的 start/end 模式不可分页且会截断；anchor/page/sync 模式是另一套同步契约，不能混用参数 | [官方列表 API](https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list)。若改用原生同步，需固定游标失效和重复实例展开方案，不因“原生”二字假设更完整 |
| 多清单待办 | `task tasklists list`、`task tasklists tasks --tasklist-guid …` 支持 page_token；后者返回 members、截止及完成状态，足以按登记清单发现非助理创建对象 | 本机 `task.tasklists.list/tasks` schema；创建者等详情缺字段时以 `task tasks get` 补齐，清单成员权限不等于每个任务的实际操作权限 |
| 个人范围及角色查询 | `task tasks list` 仅 `my_tasks`；另有 `+get-related-tasks --created-by-me/--followed-by-me`，按相关任务分页后做客户端筛选 | [1.0.87 源码](https://github.com/larksuite/cli/blob/v1.0.87/shortcuts/task/task_get_related_tasks.go)。该命令一次最多 40 页，输出仍含 has_more/page_token；达到上限仍须续取或标不完整。明确角色选择不得把两标志同时当“或”条件 |
| 默认本人负责与明确分派 | `task +create --assignee` / `--follower` 已分别组装成员角色；原生 create 可同时传 members、tasklists、client_token。应在同次创建落实负责人并读回确认，不先建无负责人任务再假报成功 | [同版创建实现](https://github.com/larksuite/cli/blob/v1.0.87/shortcuts/task/shortcuts.go#L138)及本机 `task.tasks.create/get` schema。当前 24PA `taskCreate` 没传 assignee，属适配缺口 |
| 修改、完成、删除 | 原生 `task tasks patch/delete` 均存在；patch 显式 update_fields，删除与完成不同。当前“飞书任务平台不提供删除/取消接口”文案不能沿用 | 本机 `task.tasks.patch/delete` schema。产品的“取消”须明确对应删除、移出来源或其他实际效果，不能偷换完成。真实角色和权限效果待租户验收 |

飞书原日程写入已有 IANA 时区专用路径，但当前“显式时区 + 参会人”被代码拒绝；不能把它当成平台不能邀请。参会人添加的部分成功、逐动作回执及重试应与日程写入共同验收。沿用 [第二轮提醒与日历同步研究](2026-10-19-第二轮提醒与日历同步研究.md)的同次提交时区、稳定幂等键和原生提醒边界，不重新使用丢失 IANA 信息的 shortcut 路径冒充等价实现。

### 企业微信

| 目标 | 已确认契约 | 待核验及不能作出的推断 |
|---|---|---|
| 日程 CRUD | 1.3.4 有 `calendar schedules list/get/create/update/cancel`；update 为字段补丁，支持时间、标题及增减参与人；重复变更有 repeat_mod | 当前 24PA 主动拒绝 update 是旧实现范围。应核验实际权限、取消影响、重复范围和读回，不能以取消重建代替改期 |
| 多日历登记/选定容器 | list 请求仅 begin/end；create 无 calendar_id/cal_id；响应为 schedule_id，当前实现统一使用伪日历 ID `wecom` | **这只证明该 CLI 面未暴露多日历选择。**尚未证实官方其他接口能否在同一身份与授权下选择公司/项目日历；不得伪造多个远端容器或宣称平台整体不支持。可表示已验证授权范围，但范围来源与真正容器须区分 |
| 查询完整性 | 官方同版日程文档限定当前时刻前后 30 天；schema 无游标。待办 list 有 has_more/next_cursor，默认 10、最多 20；未传状态仅 proceed | 时间范围、服务端上限与覆盖范围分别报告。条数等于数组长度不是完整性证明；所有待办查询须显式状态并继续至终页，限流/失败不报全量 |
| 既有待办范围与创建身份 | **同一版本资料冲突**：本机 schema 写机器人创建视角，官方发布提交的 todo-list.md 写当前用户创建和参与，todo-create.md 写当前用户为发起人 | 不得直接得出“只能查询机器人创建”或“已支持用户全部待办”。以真人原生创建、他人分派、机器人创建的既有样本只读对照，并核对真实创建回执，作为交付前门槛 |
| 负责人/关注人 | schema 提供 follower_ids / followers，描述为参与人；官方同版资料称分派人，返回 user_status；没有独立 assignee/follower 双角色字段 | **字段英文相似不等于飞书关注人语义。**先证明实际分派/本人完成责任关系，再建立归一化映射。不能把任何 follower 自动记成负责人，也不能仅因字段名就断言不具备分派能力 |
| 修改与完成 | todo update 支持标题、描述、deadline；followers 是全量替换。finish 未给 finished_all 只完成调用方份额，true 是整体完成 | 更新无关字段不重写参与人；本人完成与整项完成分别记录，读回 status/user_status；不能擅自提升 finished_all |
| 删除/退出 | 官方同版 todo-delete.md 区分创建者删除整项与非创建者退出；本机 schema 描述仍是机器人删除视角 | 当前代码一律把 delete 成功存成 canceled 不足以证明所有参与人的任务已取消。先核验角色及实际效果；回执显示删除整项或本人退出 |

上述机器契约由已安装 `wecom-cli 1.3.4` 的 `--schema` 读取，官方同版资料固定如下：[日程查询](https://github.com/WecomTeam/wecom-cli/blob/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-calendar/references/calendar-agenda.md)、[日程变更](https://github.com/WecomTeam/wecom-cli/blob/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-calendar/references/calendar-update.md)、[待办查询](https://github.com/WecomTeam/wecom-cli/blob/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-todo/references/todo-list.md)、[待办创建](https://github.com/WecomTeam/wecom-cli/blob/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-todo/references/todo-create.md)、[完成](https://github.com/WecomTeam/wecom-cli/blob/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-todo/references/todo-finish.md)、[删除](https://github.com/WecomTeam/wecom-cli/blob/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills/wecomcli-todo/references/todo-delete.md)。材料中的默认时长、提示话术、同标题合并等属于官方示例的产品策略，24PA 仍服从已确认的 Manticore 决策。

企微原生多日历 API 文档入口 `developer.work.weixin.qq.com/document/path/93647`、`93648` 本次未能取得可读正文；因此未将搜索摘要或第三方 SDK 的转述作为可用性证据。待验证项应继续查官方授权模型及接口，并与目标企业真实权限对照，不能直接换另一种身份后声称符合当前接入范围。

## 最小实现契约

下列是建议模块边界，不预设新增 public API 的最终命名。由集中模块完成解析、鉴权、遍历和回执处理，调用方不自行拼平台字段。

| 契约 | 至少保存/返回 | 必须保护的行为 |
|---|---|---|
| 来源登记 | 稳定 sourceId、领域、平台、经核验的身份引用、原生容器或授权范围、名称/用途、默认角色、读写能力与核验时间/版本 | 显示筛选不扩大授权；公司/项目名称不是权限；单个固定飞书 profile 仍不扩成多账号产品 |
| 写入解析 | 唯一具体身份与资源、选择依据、登记版本、动作授权范围 | 歧义、未登记、无权返回可修复原因，不降级到其他来源；计划启用/重配时冻结该结果，新默认不改旧绑定 |
| 对象引用及成员关系 | 平台对象引用、原来源关联、原生角色/状态、操作能力、系列/实例信息、可核验链接 | 同名不合并；合并展示不抹去原定位；删除来源不删远端对象或历史 |
| 分源读取 | items、续页信息、已覆盖范围、查询/角色条件、核验时刻、complete/partial/failed/stale 及原因 | 全部登记来源都被计入覆盖报告；空第一页有更多页仍须继续；分页上限、角色证据不足不报完整总数 |
| 变更/核对 | 稳定操作 ID、原目标/身份、效果范围、明确失败/未知/已确认、原始回执与归一化结果 | 每次尚未发出的动作重验当前登记和权限；恢复用原 adapter 解释回执；未知不换操作键重做 |

“我交办的”必须有实际分派关系或可追溯委托依据；创建者身份只是其中一类证据，不把所有创建者自动等同于交办人。企微角色无法等价映射时保留原生参与人及已知业务含义，界面显示待核验/能力差异，不用假负责人满足筛选验收。

## 可拆工单与先后依赖

| 工作包 | 可独立验收的交付物 | 前置与验收重点 |
|---|---|---|
| S1 来源登记、唯一路由与迁移 | 参数界面登记两类来源；分域默认/公司项目映射；服务端解析与诊断；从旧配置恢复初始登记 | 先固定来源/对象/授权契约。完整旧配置迁移零远端写入；primary 解析实际 ID；无法识别身份/资源保留待核验；重复执行不重建、不覆盖新配置；已移除来源不再新写入 |
| S2 全来源查询及对象成员关系 | 远端枚举、分页、水位、来源关系、统一完整性与准确计数；支持非助理对象 | 依赖 S1。覆盖同任务多清单、同日程多来源、跨平台原生 ID 相同、空页仍有游标、分页中断、无权、缓存与空结果；单源失效不污染其他来源 |
| S3 日程办理与聚合 | 两入口占位/改期/取消；本人参与筛选、冲突与来源详情；原生提醒保留 | 依赖 S1/S2 及相应渠道能力核实。明确目标优先，时区与时长有依据，无参会人不猜人；共享来源角色不明标不完整；个人退出和整场取消按明确范围执行 |
| S4 待办角色与真实变更 | 本人默认负责、角色覆盖默认筛选、远端修改/完成/延期/取消；保留助理交办分工 | 依赖 S1/S2。飞书同次创建负责人并读回；企微须先解决身份/范围/分派语义证据缺口。验收 A 本人负责、B 本人关注并交办的角色切换；无截止不造期限；部分完成不报整体完成 |
| S5 固定计划目标、接入健康与跨路径恢复 | 计划影响预览、资源移除阻断、身份变化重验、既有动作恢复、两库升级验证 | 与计划/运行基础协同；写入恢复依赖 #208。默认 A→B 旧计划仍用 A；移除 A 阻断未发出动作；修复只解除对应阻断；已成功动作不因重启/换默认重做 |

S1/S2 的平台无关框架可先实施；未核实的企微能力不能作为 S3/S4 该渠道的通过条件。真实平台能力研究、适配器测试和真实账号验收分别记证据，避免以桩通过替代平台覆盖。

### 与尚未合并的 #208 / #209 协作

2026-10-20 只读工单状态均为 OPEN：[#208 原渠道与回执恢复](https://github.com/benz-ai-x/dsh-24-PA/issues/208)、[#209 正文与派生候选同源](https://github.com/benz-ai-x/dsh-24-PA/issues/209)。状态记录只代表本次读取时刻，本文不修改工单。

- **#208 是多来源写入恢复的直接契约依赖。**其范围已含原渠道、操作类型、对象容器、授权范围和回执解释依据；S1 可先定义来源配置，S3–S5 改造外部写入/候选恢复时应接入其已验收实现，避免另造第二套恢复账或覆盖正在修的 `runtime.ts` / `external-operations.ts` / 两渠道 adapter。已有候选的目标不能随新默认变化；历史身份证据不足保持待核对。
- **#209 是资料候选→日程/待办执行的前置。**未经同源证明的旧候选不能因为新建了来源系统就获得执行资格。它不阻断直接对话 CRUD、只读聚合或参数登记；候选集成验收等待其合并后进行，覆盖正文改人名/日期/删行动后的授权与新目标解析。
- 两项合并后记录实际 SHA，并复跑交叉场景：远端创建成功→本地失败→默认来源切换→恢复只补旧关联；内容版本变化→旧授权不可执行；SQLite/PG 迁移与重启行为一致。不得因新增 Manticore 工作包而重复关闭或替代它们的验收。

## 验证记录及剩余门槛

可复现的本地只读契约查询：

```text
lark-cli --version
lark-cli task +create --help
lark-cli task +get-related-tasks --help
lark-cli schema task.tasks.create
lark-cli schema task.tasklists.tasks
lark-cli schema task.tasks.get
lark-cli schema task.tasks.patch
lark-cli schema task.tasks.delete
lark-cli schema calendar.calendars.get
lark-cli schema calendar.events.instance_view
lark-cli schema calendar.event.attendees.list
wecom-cli --version
wecom-cli todo create --schema
wecom-cli todo list --schema
wecom-cli todo get --schema
wecom-cli todo update --schema
wecom-cli todo finish --schema
wecom-cli calendar schedules list --schema
wecom-cli calendar schedules create --schema
wecom-cli calendar schedules update --schema
```

未执行 auth/status/whoami、业务 list/get、任何业务写入或 dry-run；dry-run 曾触及 profile 状态的既有研究警告继续适用。版本检查、schema 与官方源码只能证明声明的契约，不能证明账号已获权、设备收到提醒或消息真实送达。

进入相关渠道实现前仍需完成：企微同版身份与覆盖冲突对照、企微多日历容器/授权范围选择、企微真实分派与本人责任关系；进入交付前再验证邀请/退出/取消、分页末页、用户原生对象、原生提醒及权限撤销等真实场景。若能力证据与已确认需求不符，应提交具体差异与替代方案，不静默缩减产品目标。

既有研究沿用范围：[F03 任务](F03-任务清单实现研究.md)的外部操作及投影原则、[F04 日程](F04-日程会议实现研究.md)的授权和冲突原则、[F16 企微](F16-企微日程待办实现研究.md)的独立信封与未知语义、[R3-B](2026-10-19-R3-B渠道契约.md)的精确对象读回及本人/整项完成区分。早期“无单项 get”“无删除”或将 follower 直接解释为关注人的结论，只反映当时接入方式，以上同版新证据优先；历史研究不回写。
