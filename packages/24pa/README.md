# 24私助（24PA）正式插件

`@benz-ai-x/dsh-24pa` 是 24私助的正式 dsh bundle：一个「24私助」预设同时承接事务交办、工作区维护与标准模式完整编程能力（F13 起），业务账本使用 PostgreSQL，飞书接入采用官方 SDK 长连接＋受控 lark-cli 执行器。

预设携带标准预设的插件全集（persona 已并入助理身份、bash/pwsh、文件与检索、jobs、skill、goal、plan-mode、压缩、subagent/subagent_fork、workflow、ralph、ask-user、todo、web、present）＋ pa24 业务插件；各入口实际可见工具由角色白名单决定：本地24私助会话获得标准编程工具全集，飞书接入会话与 Worker 维持业务白名单。`tool-schedule` 不并入——提醒统一经 PostgreSQL 账本。外部 CLI 委派（`subagent_codex`/`subagent_claude_code`）的工具行已启用，但需先向 profile 安装对应 provider 包（`@deepseek-ai/dsh-subagent-codex` / `-claude-code`）并在 AGENTS.md `extraLocalTools` 中显式列出后才对本地会话生效。

## 版本命名

版本号跟随 dsh 基线：**`<dsh 基线版本>.<本产品序号>`**（如 dsh 基线 0.2.0-rc.2 → 本产品 0.2.0-rc.2.1、0.2.0-rc.2.2…）。当前基线＝peerDependencies 锁定并经全量验证的 dsh 版本；dsh 基线变化时版本号随之推进并重新核验后发版。

## 安装与启动

```sh
npm install && npm run build          # 构建 lib/
dsh --profile <你的 profile> plugin add <本目录> --ignore-scripts
dsh --profile <你的 profile>
```

环境变量（值由服务器启动环境提供，文件只保存名称）：

| 变量 | 用途 |
|---|---|
| `PA24_PG_DSN`（默认名，可在 AGENTS.md 改） | PostgreSQL 连接串；业务账本位于独立 `pa24` schema，应使用受限账户 |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | 飞书自建应用凭据（feishu 模式） |
| `PA24_WORKSPACE` | 首次启动时绑定的工作区绝对目录（也可在面板选择） |

首次绑定目录若没有 `AGENTS.md` 会生成模板；已有文件不覆盖。AGENTS.md 中唯一的 json 块是配置源：`mode`（demo/feishu）、`larkProfile`、`ownerOpenId`、`folderToken`、`tasklistId`、`calendarId`、`timeZone`、`pgDsnEnv`、`maxWorkers`、`enabledWorkers`、`workerModels`、`extraLocalTools`。凭据与连接串只写环境变量名。

## F02 增量（并行事项与记忆维护）

- 五类专业角色注册于 `src/roles.ts`：memo 可用；calendar/tasks/reminders/handwriting 已注册、未交付前委派时明确拒绝。维护者可经管理端点注册新职责（如 digest 资料摘要），沿用统一 WorkItem/并发/回传/恢复边界。
- 飞书回复旧消息固定路由到原事项（`pa24.message_route` 持久路由）；未知引用明确告知，不回退新工作。
- 重启对账：`processing` 收件重派（requestId 幂等）、`admitted` 未交付行提示重发、运行中事项按恢复代次（`work_item.recovery_gen`）续办、已停止事项不复活。
- JSON 记忆权威：工作区 `.24pa/memory.json`（schemaVersion/revision/records）＋审计 `memory-log.jsonl`＋可撤销变更集 `.24pa/changesets/`；写入/整理/撤销仅限本地24私助会话（expectedRevision 原子提交），检索对所有角色开放；无任何定时/后台整理。面板「结构化记忆」页展示正文、来源、筛选与分页。

## F03 增量（任务与项目清单）

- tasks Worker 正式可用：`task_create`（幂等键＋staged 操作，结果未知不自动重试）、`task_update`（截止时间与计划投入/估时分开记录，每任务串行门）、`task_complete`（明确动作，不从对话推断）、`task_get`（尽力远端刷新投影）、`task_list`。
- 项目/个人清单：`project_create` / `project_adopt`（本人采纳后才创建真实飞书任务并关联）/ `project_progress`（进展取自实际任务状态；不订票、付款或对外提交）。
- 本地表：`pa24.task`（飞书为权威的投影，含 due/planned/estimate 与同步时间）、`pa24.project`、`pa24.project_task`。平台无任务删除接口：取消以修改＋说明处理，如实告知。

## F04 增量（日程与会议安排）

- calendar Worker 正式可用：`calendar_query`/`calendar_busy`（先同步授权日历到 `pa24.calendar_event` 投影，报告 syncedAt/窗口/新鲜度与冲突；同步失败返回“投影可能过期”而非“没有会议”）、`calendar_create`/`calendar_update`/`calendar_cancel`（staged 幂等、平台回执、写后回填投影，取消落投影）。
- `meeting_schedule`：参会人取明确 open_id 或已确认记忆联系人（`联系人：姓名` 主题）；同名/缺失必须澄清，未发出任何邀请；邀请仅凭本人明确指令（instruction 依据）。
- 同步水位在 `pa24.calendar_sync_state`（窗口、complete、last_error）；查询窗口上限 62 天。

## F05 增量（个人提醒与免打扰）

- reminders Worker 正式可用：`reminder_create`（once afterSeconds/at、every、daily/weekly 本地时间＋IANA 时区；时间计算复用 dsh-schedule 公开函数，cron 未支持时如实拒绝）、`reminder_list`、`reminder_cancel/pause/resume`（停止一并取消未发送实例）、`reminder_skip`（跳过本次）、`reminder_snooze`（关联原实例的唯一稍后实例）、`reminder_status`（实例状态＋Outbox 平台接受状态，不推断已读）。
- 机制：规则与发生实例在 `pa24.reminder_rule`/`pa24.reminder_occurrence`（唯一键幂等，SKIP LOCKED 领取）；发送经持久 Outbox（模型离线仍能发出）；周期规则只补最近一次错过的发生；单 Host 内每 tick 失败不致命。
- 免打扰/休假（P15/P21）：派发时读记忆权威——主题「休假」（confirmed＋validUntil）或「通知偏好」（内容含 `安静时段 HH:mm-HH:mm`，按工作区时区）；到期实例被扣住（pending+deferred_until）而非丢弃，窗口结束后补发。偏好仅在本地24私助会话经 pa24_memory 维护。

## F06 增量（手写笔记整理与人工审核）

- 收集（P28）：飞书拍照或发送 JPEG/PNG/WebP 图片文件 → 稳定笔记编号（`pa24.note`/`pa24.note_page`）；原稿字节＋sha256 存工作区 `.24pa/originals/`，页序与消息来源入账本。回答回执消息继续发图＝追加页；不按时间窗自动合并；重复原稿（同 sha）拒绝重复保存；未知格式/超 10 MiB/超 50 页记为缺页并反馈。
- 识别（P29）：handwriting Worker 正式可用，委派必须带 `noteId` 且要求 `workerModels.handwriting` 视觉路由（缺配置明确报错）；原稿图片经 dsh 附件服务真实进入子 Agent 与模型请求。Worker 仅提交结构化候选（`note_submit`：转写/摘要/AI建议/疑点/候选行动/相对日期分离），发布为 `docs +create` 模板文档（含【24PA·系统】状态块＋原稿图片）＋回读全文＋指纹（`pa24.note_version` 不可变快照）；staged 操作保证重试不重复建文档。本版仅识别单页笔记，多页如实拒绝（F07 交付）。
- 审核（P31）：待审版本经 Outbox 发交互卡片，按钮只携带不透明令牌（`pa24.review_token` 绑定主人/笔记/版本/指纹/7 天有效期）；点击时服务端重新核验文档指纹一致才受理，裁决（approve/return）在 PG 事务内落 `pa24.review_decision`＋版本/笔记状态，文档状态块随后同步（失败＝凭证已保存、同步中）。重复点击返回原结果；Worker 没有任何批准或外部行动工具。
- 失效与重审（P32）：指纹覆盖正文（系统状态块排除在外）、结构顺序与原稿资源摘要；`pa24_notes verify` 有界核验 matches/changed/unknown，changed → 版本转 stale、笔记转 needs_rereview 并通知（旧批准保留为历史凭证）；`pa24_notes republish` 以当前文档为 v(n+1) 候选重发审核卡（含行级差异），批准前不继承旧结论。

## F07 增量（多页笔记与集中复核）

- 多页识别（P30）：单次委派识别整份笔记（≤20 页/批次，超出如实要求分批）；`note_submit` 支持 `pages[]` 逐页转写（页号必须精确对应已保存页，缺页如实留空不臆造）、`doubts[]`（数字/人名/缩写/日期/否定/勾选/不清七类重点复核，带 0–1 归一化区域）、`diagrams[]`（保留原图＋文字说明，不做矢量重绘）。区域疑点/图示由 sharp 从保真原稿生成 PNG 裁片（`.24pa/crops/`，坐标变换与 certainty 随版本存档），经 `docs +media-insert` 插入文档；回读完整性检查为 图片数 ≥ 页数＋裁片数；指纹第三组输入＝裁片 sha（页序/疑点坐标/裁片内容任一变化都会换指纹）。单页基线与多页增强共用同一视觉路由与审核管线。
- 审核队列（P33）：`pa24_notes queue` 与面板「手写审核」页集中列出待审/需重审/已退回对象（最新版本、指纹、上次核验结果与时间、页数、在途催办、打开飞书文档）；页面只读，无网页批准按钮；空队列/读取失败分别显示。
- 审核提醒（P33）：`pa24_notes remind`（once/daily，绑定当前待审版本）与 `remind_control`（snooze/pause/resume/cancel，只动提醒不动审核）；派发复用 Outbox 与 F05 静默扣留，6 小时最小间隔、daily 3 次封顶；版本完成审核或被新候选取代时在途催办同事务自动取消——旧版本不再催审；重启后按账本继续。面板 `notes.poll` / `notes.remind-poll` 暴露有界核对与派发入口。

## F08 增量（事项交办与持续跟进）

- 交办与发信（P13）：tasks Worker 的 `outreach_send`（`im +messages-send --user-id`，幂等键=操作号）与 `task_assign`（`task +assign`）只凭本人明确指令（instruction 依据）；草稿不发送、目标不唯一先澄清（复用 F04 联系人解析）；执行回执（平台 message_id/操作号）入 `pa24.outreach`；失败/结果未知如实记录，不伪造成功；等待事项与资料永不构成对外沟通授权。
- 来源跟随提醒（P19）：`reminder_create` 可 `linkTaskGuid`/`linkEventId`（快照来源指纹）；提醒引擎**发送前复核**来源仍匹配——取消/改期则拦截实例并告知；任务修改、日程写入与日历同步检测到指纹变化时：未发送实例取消并通知、已发送的补发关联更正（`srccorr`）；规则按业务键天然去重，不重写飞书原生重复规则。
- 周期任务模板（P22）：`task_repeat_create`（every≥60s/daily/weekly，dsh-schedule 记录＋`pa24.task_template[_instance]` 唯一实例）；有界物化 tick 逐实例生成真实飞书任务（幂等键=实例 id）；只补最近一次错过（不无界回补）；`task_repeat_skip`（跳过本次）/`task_repeat_stop`（停止以后）/`task_repeat_update`（修改以后，重建模板停旧）；已生成历史保留。飞书任务 CLI 未暴露原生重复规则，按模板实现（如实说明）。
- 等待事项（P23）：`waiting_create`（内容/来源/检查点/去重键，同源不重复建）＋`waiting_control`（收到/继续等/改时间/取消，同步调整检查点）；到点经 Outbox **只询问本人**（复用免打扰扣留），不自动催办他人；没有可读回复来源时以本人答复为准。

## F09 增量（每日规划与定期回顾）

- 每日规划（P16）：calendar Worker `plan_today`（重点/估时/容量/冲突/缺失；confirmed 偏好「会议之间留 N 分钟」计入缓冲；过载如实建议只选重点）、`plan_preview`（明日或含临时插单的候选时间块；插单只列受影响安排，未受影响不动）、`plan_adopt`（只写入选定块，写入前经 staged 日历创建并回执链接）、`overview_today`（今日任务/日历合并视图；未读取范围不显示为零）。建议与写入严格分离，截止与安排时间分开，不自动延期。
- 智能计划（P24/P25）：`pa24.digest_plan[_occurrence]`＋原生 ScheduleService（`create/list/delete/history`，仅挂固定飞书接入顶层会话；dsh 原生拒绝 child）。`digest_enable`（morning/evening/weekly 定时、once 演示）/`digest_control`（暂停=移除原生计划保留历史；恢复=重新入队；调整=重建）/`digest_list`。状态三层：Schedule 持久入队（schedule_id）→ 模型工作（occurrence delivering→model_done）→ 平台接受（Outbox sent）；简报由 digest Worker `digest_build {planId}` 按窗口唯一键幂等生成（同窗重复投递不重复发布，全部以 planId/scheduleId 归属，不按标题相似盲建）。
- 投递监督：有界核对对比原生 `schedule.history` 投递与已完成发生——无法归属（宽限后）→ 计划暂停＋`digestunconfirmed` 通知，不为过期窗口补发一串；面板 `digest.supervise {graceMs}` 暴露同一入口。重启后原生 Schedule 自持久续跑，业务状态按账本恢复。
- 简报内容：事实（日程带 syncedAt/新鲜度、任务截止与计划分开、完成、等待、待审、项目进展）与建议分开，每期带来源与数据缺失清单；晚间/周回顾绝不自动延期任务、绝不写 JSON 记忆。

## F10 增量（会议资料与纪要行动）

- 会前准备（P26）：`meeting_prep_enable {eventId, leadMinutes}` 把一次性原生 Schedule 挂到固定接入会话（schedule_spec 记录会议与提前量）；到点 Lead 委派 calendar Worker `meeting_prep_build {planId}`——**发送前复查会议状态**（取消/改期即跳过并说明，不发送过时准备包）；资料检索限定授权范围（备忘关键词＋近期、confirmed 记忆、相关未完成任务），没有材料如实说明、不编造议程；准备包带资料出处与 WorkItem 标注。日程取消/改期经 F08 来源联动自动停止绑定该会议的 prep 计划。
- 会后纪要（P27）：memo Worker `minutes_build {topic, content, candidates[]}` 经既有 memo 管线保存飞书纪要（创建＋回读），候选行动（含出处引文、责任人/日期原话、未知项）存 `pa24.minutes.candidates`——纪要生成≠行动执行。
- 候选行动契约（可被手写链复用）：`minutes_adopt_actions {minutesId, indexes[], instruction}` 只执行选定且信息足够的候选（有 start/end→日历时间块，否则→飞书任务）；**幂等键＝(minutes, index)**——跨会话重复选择返回已有对象；结果未知拒绝盲重试；部分选择与部分失败逐项返回并回写纪要状态。

## F11 增量（审核笔记的行动与综合查询）

- 审核后行动（P34）：handwriting 角色 `note_adopt_actions {noteId, versionId, indexes[], instruction}`——使用前核验版本为 approved **且当前文档指纹仍匹配**（未审/已退回/被取代/编辑后/无法核验一律拒绝，未知字段不会自动变成执行参数）；候选保留出处（sourceQuote）与日期原话（due 原文＋解析值）；幂等键＝`note.action:<note>:v<版本>:<索引>`（复用 P27 契约，跨会话重复选择返回已有对象）；批准与行动授权分别落账。
- 修订影响（P34）：发布新版本时对旧版本已建的行动对象发**变更建议**（`noteimpact` 通知，逐版本去重；"是否调整由你决定"，绝不静默删除/覆盖）。
- 可信检索（P35）：`notes_search {query}` 只读检索，逐条**重新核验当前有效性**——matches（可作为已确认事实引用）/changed/unknown（含原因）/unreviewed 明确标注，多版本各自成行、不因曾通过而继承；返回可打开的文档链接。今日概览与晨报新增 reviewedNotes（当前仍匹配的已审版本，带版本/审核时间/链接）；待审读取失败显示"无法读取（不按零处理）"；会话历史不默认拼接。

## F12 增量（运行维护与数据恢复）

- 归档检查/执行（P37）：`pa24_maintenance archive_check` 盘点运行中事项、**原生 Schedule**（digest/prep 计划）与 **PG 外部提醒**（reminder_rule/review_reminder，单独展示不与原生计划混同）及未确认发送；`archive_execute` 需 `confirmStop:true`——停止 Worker（用户停止不复活）→ 逐个删除原生计划并回读（部分失败逐项说明）→ 外部提醒默认保留、`stopRules:true` 才停止；恢复不自动重建已删计划；取消零副作用。dsh 原生归档闸（active Schedule 阻止归档）仍是权威兜底。
- 联合备份（P38）：`backup_create {targetDir}` 产出 `pg_dump --schema=pa24`＋工作区（AGENTS.md/.24pa 记忆/修订/原稿/裁片）清单＋dsh 状态清单＋`backup-manifest.json`（各部分 sha256、PG schema 版本与行数水位、凭据**引用名**清单——凭据值永不入备份）；`backup_verify` 校验摘要并报告缺失部分（未完整恢复的能力不可假装就绪）。恢复顺序与旧 Outbox/飞书对象对账规则见下方「数据与备份/恢复」。
- 健康/预算（P39）：`pa24_maintenance health`＋面板「工作区」页健康区块——能力状态（视觉路由/日历同步新鲜度）、本 Host 投入统计（模型轮次/输入页/裁片/发送队列/结果未知/发送延迟 p50/p95；进程内计数重启清零，费用口径声明）、数据流披露（模型输入范围/日志/保留期/凭据不出现在诊断）、降级语义（模型断→仅模型工作暂停固定提醒继续；PG 断→停止接纳）。

## F13 增量（预设并入标准模式能力）

- 预设组装：`cordis.patch.yml` 的 `pa24-preset` 行携带标准预设插件全集（persona 文案并入助理身份）＋`pa24-agent`；`tool-schedule` 不并入（提醒统一走账本），subagent 行的 schedule deny 过滤随之移除。
- 角色白名单（`src/tools.ts` `STANDARD_CODING_TOOLS`）：本地24私助会话额外获得 bash/pwsh（按平台择一）、read/write/edit/read_image/glob/grep、job_*、skill、goal、exit_plan_mode、ask_user_question、todo_write、web_fetch/web_search、present、subagent/subagent_fork、interrupt_agent/send_message/list_agents、workflow、ralph；飞书接入会话与 Worker 白名单不变。
- `extraLocalTools`（封闭枚举 `subagent_codex`/`subagent_claude_code`）：安装对应 provider 包后在 AGENTS.md 显式列出，本地会话才获得外部 CLI 委派工具；restrict() 要求名单内工具真实存在，故该能力不能默认开启。
- 验收：`tests/e2e/f13.e2e.mjs` 经真实 Loader 断言三个角色的实际工具面（本地全集、飞书白名单、Worker 仅 pa24_work＋只读记忆）。

## F15 增量（飞书接入配置向导）

- `feishu-setup.md` 随插件分发（进入 npm files），是飞书接入配置的唯一权威流程：阶段 0 前置自查 → 1 建自建应用（权限点/长连接事件/发布）→ 2 lark-cli 绑定与用户授权（Device Flow 三步法，`--domain im,task,calendar,docs,drive`）→ 3 资源标识（ownerOpenId/folderToken/tasklistId）→ 4 切换（先 env、后 AGENTS.md、再重启）→ 5 健康检查与 `/24pa` 端到端 → 6 故障对照；附安全红线（密钥不读不写、授权点击与建应用只由本人完成）。
- `pa24_connection`：`guide` 返回指南全文＋插件版本；`check`（`src/feishu.ts` `inspectAccess`）新增 `nextSteps`——把 cli/source/auth（missing/unbound/mismatch/unverified/error）与资源（missing/error）状态映射为带指南锚点的下一步，全部就绪时按 mode 给出切换或端到端验收指引。
- 系统提示词与 AGENTS.md 模板：配置飞书接入前必读指南、按 check 的 nextSteps 收敛。
- 测试：`tests/unit/feishu-setup.test.mjs`（指南章节契约＋映射全分支）、`tests/e2e/f15.e2e.mjs`（真实 Loader 下 guide/check 经本地会话可达）。

## 数据与备份/恢复

| 数据 | 位置 |
|---|---|
| 业务账本（收件/事项/操作/Outbox/绑定/备忘/消息路由/任务/日程/提醒/手写笔记与审核凭证） | PostgreSQL `pa24` schema |
| 长期记忆权威、审计与变更集 | 工作区 `.24pa/`（memory.json / memory-log.jsonl / changesets/） |
| 手写原稿与疑点裁片（不可变字节与派生副本） | 工作区 `.24pa/originals/`、`.24pa/crops/` |
| 工作区规则与配置 | 工作区 `AGENTS.md` |
| 原生会话日志与附件 | dsh `$DSH_HOME/sessions`（原生 JSONL，不使用 SQLite） |

备份：`pg_dump --schema=pa24 <dsn> > pa24.sql` ＋ 工作区目录 ＋ `$DSH_HOME/sessions`。
恢复：先恢复 PG（`psql < pa24.sql`）再恢复目录，重启 Host；启动即核对绑定与进行中事项，`needs_reconciliation`/失败事项由人工核对后续办，不自动重放外部写入。
单 Host：同一状态目录（`$DSH_HOME/24pa`）第二个活跃进程会被锁拒绝。

## 测试

```sh
npm run build
npm test        # 单元（真实隔离 PostgreSQL 集群）+ e2e（真实 dsh Loader/Host）
```

测试边界（与工单一致）：真实 Loader、原生 Session/子代理、隔离 PostgreSQL、真实 lark-cli 子进程（飞书侧为桩）；仅替换模型（本地 Messages 兼容 mock）、外部网络与注入时钟。需要相邻的 `deepseek-harness` checkout（`../deepseek-harness`，含已构建 `lib/`）与 Homebrew PostgreSQL（`initdb`/`pg_ctl`）。

## 边界

真实飞书租户联调、真实模型质量与生产部署尚未验收（按工单另记实测/未验证状态）。
