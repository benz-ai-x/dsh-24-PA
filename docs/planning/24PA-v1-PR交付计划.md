# 24私助（24PA）v1 PR 交付计划

更新：2026-10-07。用户已确定“一个 PR 交付一个可以实际使用的功能，可以包含多个 Issue”，已发布的工单按本轮命名与原型反馈同步到 [规格](../24PA-v1-SPEC.md)（现 1.3）和 [父规格 #1](https://github.com/benz-ai-x/dsh-24-PA/issues/1) 重新校准；v1 的 44 张工单已全部发布。

本次只发布实施计划，正式实现和生产部署仍按用户后续授权执行。可丢弃原型及其证据见 [原型验收记录](../prototypes/24PA-原型验收记录.md)，不计入下面 12 个生产功能 PR。

## 校准结果与交付单位

P01–P44 的稳定编号、分组与依赖继续保留，正文和覆盖映射校准到规格 1.2。中文名为24私助，英文名为24PA；统一预设同时承接本地交办和维护，Worker 按实际父会话与入口隔离。只读飞书接入、记忆正文展示、六页导航与 UI/UX 验收分配到原有功能，补齐故事 111–118、场景 S27–S30 和 T20。

共 **44 张工单**：43 张实施票组合成 **12 个功能 PR**，P40 跟踪整体发布验收，不预设独立 PR。P 编号为稳定规划编号，不表示执行顺序；GitHub 编号是实际事项。完整依赖顺序、验收与 118 条故事/30 场景/20 测试组映射见 [工单清单](24PA-v1-工单拆分草案.md)。

Issue 描述一次独立工作上下文可完成的完整流程；持久化、授权、操作回执与恢复随首个使用它的业务一起交付。PR 汇集同一可用功能所需的 Issue、迁移、配置和验证。完成一张票不触发新建 PR；数量仅在实现证据证明需要时调整，拆分后仍必须独立可用。

## 功能分组

“前置 PR”是完整功能合并所需的直接前置，已去除传递边。各 Issue 保留具体技术阻塞，编号不表示全部串行。

| 功能 PR | 包含的工单 | 前置 PR | 合并后可以完成的操作 |
|---|---|---|---|
| F01 工作区助理与随手记 | [P01 / #3](https://github.com/benz-ai-x/dsh-24-PA/issues/3)、[P02 / #4](https://github.com/benz-ai-x/dsh-24-PA/issues/4)、[P03 / #5](https://github.com/benz-ai-x/dsh-24-PA/issues/5)、[P14 / #6](https://github.com/benz-ai-x/dsh-24-PA/issues/6)、[P41 / #7](https://github.com/benz-ai-x/dsh-24-PA/issues/7) | 无 | 选择目录，通过统一24私助预设交办并维护配置；只读查阅飞书接入和按需诊断；飞书或本地发起备忘，Worker 保存真实文档并向原入口返回出处。 |
| F02 并行事项与记忆维护 | [P04 / #8](https://github.com/benz-ai-x/dsh-24-PA/issues/8)、[P05 / #9](https://github.com/benz-ai-x/dsh-24-PA/issues/9)、[P06 / #10](https://github.com/benz-ai-x/dsh-24-PA/issues/10)、[P07 / #11](https://github.com/benz-ai-x/dsh-24-PA/issues/11)、[P42 / #12](https://github.com/benz-ai-x/dsh-24-PA/issues/12)、[P36 / #13](https://github.com/benz-ai-x/dsh-24-PA/issues/13)、[P43 / #14](https://github.com/benz-ai-x/dsh-24-PA/issues/14)、[P44 / #15](https://github.com/benz-ai-x/dsh-24-PA/issues/15) | F01 | 按实际发起会话委派至少五项原生 Worker 工作，查看、继续、停止及恢复；在同一助理会话 CRUD/手工整理 JSON，面板直接展示正文、筛选和修订信息；注册新专业职责。 |
| F03 任务与项目清单 | [P08 / #16](https://github.com/benz-ai-x/dsh-24-PA/issues/16)、[P09 / #17](https://github.com/benz-ai-x/dsh-24-PA/issues/17)、[P17 / #18](https://github.com/benz-ai-x/dsh-24-PA/issues/18) | F02 | 创建、完成、调整任务，拆解项目和个人事务，查看实际进展；多个 Worker 修改同一任务得到一致结果。 |
| F04 日程与会议安排 | [P10 / #19](https://github.com/benz-ai-x/dsh-24-PA/issues/19)、[P11 / #20](https://github.com/benz-ai-x/dsh-24-PA/issues/20)、[P12 / #21](https://github.com/benz-ai-x/dsh-24-PA/issues/21) | F03 | 查询忙闲与关联任务影响、安排本人日程、邀请指定参会人，随后改期或取消并获得真实回执。 |
| F05 个人提醒与免打扰 | [P15 / #22](https://github.com/benz-ai-x/dsh-24-PA/issues/22)、[P18 / #23](https://github.com/benz-ai-x/dsh-24-PA/issues/23)、[P20 / #24](https://github.com/benz-ai-x/dsh-24-PA/issues/24)、[P21 / #25](https://github.com/benz-ai-x/dsh-24-PA/issues/25) | F02 | 在本地24私助会话设置偏好；飞书设置单次或周期提醒，主动收到通知，支持稍后、停止、静默和休假；固定提醒在模型不可用时仍运行。 |
| F06 手写笔记整理与人工审核 | [P28 / #26](https://github.com/benz-ai-x/dsh-24-PA/issues/26)、[P29 / #27](https://github.com/benz-ai-x/dsh-24-PA/issues/27)、[P31 / #28](https://github.com/benz-ai-x/dsh-24-PA/issues/28)、[P32 / #29](https://github.com/benz-ai-x/dsh-24-PA/issues/29) | F02 | 通过飞书 App 拍照提交一页笔记，得到待审文档，批准或退回指定版本；修改后重新审核，文档显示真实审核状态。 |
| F07 多页笔记与集中复核 | [P30 / #30](https://github.com/benz-ai-x/dsh-24-PA/issues/30)、[P33 / #31](https://github.com/benz-ai-x/dsh-24-PA/issues/31) | F05、F06 | 整理多页、小字及图示，按原稿定位疑点，通过待审队列和有节制的提醒完成批量复核；dsh 只读审核页展示版本和真实状态，批准仍通过本人飞书确认。 |
| F08 事项交办与持续跟进 | [P13 / #32](https://github.com/benz-ai-x/dsh-24-PA/issues/32)、[P19 / #33](https://github.com/benz-ai-x/dsh-24-PA/issues/33)、[P22 / #34](https://github.com/benz-ai-x/dsh-24-PA/issues/34)、[P23 / #35](https://github.com/benz-ai-x/dsh-24-PA/issues/35) | F04、F05 | 明确授权交办或发信，持续跟踪等待项和周期事项；任务、会议改期取消会更新提醒，催办默认提醒本人。 |
| F09 每日规划与定期回顾 | [P16 / #36](https://github.com/benz-ai-x/dsh-24-PA/issues/36)、[P24 / #37](https://github.com/benz-ai-x/dsh-24-PA/issues/37)、[P25 / #38](https://github.com/benz-ai-x/dsh-24-PA/issues/38) | F08 | 开启晨报、规划时间块、处理插单、进行晚间及每周回顾；智能周期工作通过原生 Schedule 唤醒顶层 Lead 后委派。 |
| F10 会议资料与纪要行动 | [P26 / #39](https://github.com/benz-ai-x/dsh-24-PA/issues/39)、[P27 / #40](https://github.com/benz-ai-x/dsh-24-PA/issues/40) | F09 | 会前收到有出处的资料包，会后把文字材料整理成纪要，选择行动创建任务或日程。 |
| F11 审核笔记的行动与综合查询 | [P34 / #41](https://github.com/benz-ai-x/dsh-24-PA/issues/41)、[P35 / #42](https://github.com/benz-ai-x/dsh-24-PA/issues/42) | F07、F10 | 从已审核笔记中单独授权执行行动，查询可信历史决定，并在今日概览和晨报中看到等待及待审事项。 |
| F12 运行维护与数据恢复 | [P37 / #43](https://github.com/benz-ai-x/dsh-24-PA/issues/43)、[P38 / #44](https://github.com/benz-ai-x/dsh-24-PA/issues/44)、[P39 / #45](https://github.com/benz-ai-x/dsh-24-PA/issues/45) | F11 | 完善已交付运行页的健康和预算诊断、处理会话归档及计划，完成配置/JSON/PG/会话/原稿/审核快照联合备份恢复；明确发现缺失数据、授权失效和能力降级。 |

F06 是最早可实际使用的手写完整流程：收图、识别、写文档、待审通知、本人批准/退回、修改失效均交付；F02 合并后可与任务/日程/提醒分支并行推进。F07 增加多页增强和集中复核。常规助理和全部手写能力均属于 v1。

## v1 后续功能（规格 1.3 起）

| 功能 PR | 工单 | 前置 PR | 合并后可以完成的操作 |
|---|---|---|---|
| F13 预设并入标准模式能力 | P45（故事 119） | F01–F12 全部合并 | 本地24私助会话在交办与维护之外直接使用标准模式编程工具全集（终端、文件、检索、计划、压缩、todo/web、通用 subagent/workflow 委派、ralph）；飞书入口与 Worker 边界不变；安装 provider 并在 extraLocalTools 开启后获得 codex/claude-code 外部 CLI 委派。 |
| F14 提示词结构化（LangGPT 对标） | [P46 / #62](https://github.com/benz-ai-x/dsh-24-PA/issues/62)（调研见 [研究清单](../research/提示词结构化-LangGPT对标与改进清单.md)） | F01–F12 全部合并 | 内置提示词集中于 `src/prompts.ts` 并带版本；Lead 规则按「身份/协调/业务/安全」分节注入；Worker persona 统一「职责/完成标准/边界/输出要求」四节；工作区 AGENTS.md 自然语言规则注入系统提示（只能收紧不能放宽）；委派与定时唤醒 prompt 模板化并带安全重申；`workerModels` 路由可选 `simplePersona` 简化结构；提示词关键锚点有快照测试守护。 |
| F16 企微日程待办渠道 | P48（故事 122–123，研究见 [F16 研究](../research/F16-企微日程待办实现研究.md)） | F17 合并（设置分区先行，无代码依赖，仅交付顺序） | 工作区配置 `calendarChannel`/`todoChannel`/`notifyChannel` 按域切换到企业微信后：助理经 wecom-cli 查询/创建/取消企微日程、创建/完成企微待办（写操作过 staged 账防重，unknown 提示核对）；提醒与汇报经企微机器人 markdown 单向推送（目标取授权真人）；`pa24_connection` 提供 wecom-setup 指南与授权诊断（未授权/过期/企业不可用 nextSteps）；wecom-cli 状态进入维护健康面板。 |
| F17 设置分区管理工作区 | P49（故事 124） | F01–F12 全部合并 | dsh 设置模态出现「24私助」分区：完成工作区绑定/切换、配置重载、生效配置查看（复用面板既有 RPC 与组件）；顶部可跳转打开24私助面板；侧栏面板入口保持不变。 |
| F24 手写识别质量 | [P56 / #81](https://github.com/benz-ai-x/dsh-24-PA/issues/81)（故事 130，已交付 PR #82） | F01–F12 全部合并 | vision-route 健康项升级能力判定（疑似纯文本模型显式 warn）；待审文档空段省略、单页不重复分页转写；handwriting persona v2 长度纪律。 |
| F25 默认 SQLite 存储 | [P57 / #84](https://github.com/benz-ai-x/dsh-24-PA/issues/84)（故事 131，研究见 [F25 研究](../research/F25-SQLite默认存储实现研究.md)） | F01–F12 全部合并 | 存储改默认 SQLite（工作区 data/pa24.db、WAL、node:sqlite，宿主 Node ≥ 23.4）、可选 PostgreSQL（`storage: "postgres"` 显式声明）；方言适配层（共享迁移清单与业务 SQL，残留 PG 方言即抛错）；备份改 checkpoint 文件拷贝；双后端测试矩阵；随票反向修订 SPEC 三处「不使用 SQLite」条款。 |
| F18 QwenNote 听记接入 | [P50 / #70](https://github.com/benz-ai-x/dsh-24-PA/issues/70)（故事 125，研究见 [F18 研究](../research/F18-QwenNote听记MCP接入研究.md)） | F01–F12 全部合并（extraLocalTools/prompts.ts/向导三件套随 F13–F15 已交付） | profile 配置 dsh-mcp-client 条目（stdio＋mcp-remote OAuth 桥，serverName=qwennote）并经 extraLocalTools 放行后：本地24私助会话可查询主人 QwenNote 录音卡的听记（最近列表、转写与纪要读取），引用带来源标注；行动提炼走既有候选行动→审核→行动授权；仅本地会话可用，飞书入口与 Worker 不放行；初始化指南含听记接入节（首次授权本人浏览器完成）与诊断三态。 |
| F19 晨报复盘语音投递 | [P51 / #72](https://github.com/benz-ai-x/dsh-24-PA/issues/72)（故事 126，研究见 [F19 研究](../research/F19-晨报复盘语音投递实现研究.md)） | F01–F12 全部合并（建议排 F16 之后：同改 outbox 投递分派） | digest 计划开启 voice 后：晨报/复盘到点先送达本机 TTS 合成的原生语音消息（say＋ffmpeg 转 opus，bot 身份经 lark-cli --audio），紧跟全文文本兜底；语音正文为口播变体（剥离元数据行）并截断上限；say/ffmpeg 缺失降级文本不中断；`digest_control` 可调 voice；初始化指南补 macOS/ffmpeg 前置项。 |
| F23 接入绑定体验 | [P55 / #80](https://github.com/benz-ai-x/dsh-24-PA/issues/80)（故事 129，研究见 [F23 研究](../research/F23-接入绑定体验实现研究.md)） | F01–F12 全部合并（F15/F16 向导已交付） | 新向导「先全量、后集中」：配置开始即交付本人操作全量清单＋提前发起的授权链接，一口气做完一次集中验收（往返 N → ≈2）；本人报完成后 agent 自动循环 check/wecom_check 按 nextSteps 收敛一次汇总；wecom 服务授权失效（850002/850003）经通知渠道主动推送续期链接。面板承载 QR/Secret 输入后置另立项。 |
| F24 手写识别质量 | [P56 / #81](https://github.com/benz-ai-x/dsh-24-PA/issues/81)（故事 130，研究见 [F24 研究](../research/F24-手写识别质量实现研究.md)） | F01–F12 全部合并（F06/F07 手写体系已交付） | vision-route 健康项从「路由存在即 ok」升级为能力判定：路由＝纯文本模型（如 deepseek-flash）时显式 warn「疑似非视觉模型」并在 check/read/向导透出，nextSteps 指向配置指引；handwriting persona v2 输出分级与长度纪律（短笔记只出转写＋候选行动、摘要≤100 字等），待审文档不再六段灌满；换视觉模型后置（改 AGENTS.md 一行＋配 key）。 |

F13 是用户 2026-10-07 确认的设计变更（规格 1.3 / 设计 v0.5 / ADR-0001 修订）：预设携带标准插件全集，权限仍按角色白名单裁剪；tool-schedule 不并入，提醒保持账本单轨。

F15（P47 / #63，故事 121，规格 1.5 / 设计 v0.6）：飞书接入配置向导——feishu-setup.md 随插件分发，pa24_connection 提供 guide 与带 nextSteps 的 check；解决「助理无配置知识导致多轮无法接通」的问题。F14（提示词结构化）由 P46 / #62 交付。

F16/F17 是用户 2026-10-07 确认的设计变更（规格 1.6 / 设计 v0.7）：F16 企业微信定位为日程/待办第二操作渠道＋单向推送出口，不做企微收信，Out of Scope 相应收敛为「第二聊天平台的收信接入」；提醒保持 PG 账本单轨（ADR-0001），仅扩投递出口。F17 纯 UI 小迭代先行交付，两者无代码依赖，交付顺序 F17 → F16 仅为了小 PR 先落地。

F18（P50 / #70，故事 125，规格 1.7 / 设计 v0.8）：用户 2026-10-07 提出的 QwenNote 录音卡听记接入。通道复用 dsh 内建 dsh-mcp-client（不自研 MCP 客户端、不新增包依赖），OAuth 经 mcp-remote stdio 桥（锁版本）；QwenNote MCP 的工具面与 token 形态以真机实测为准（工单第一步），架构不成立时回提案重审。

F19（P51 / #72，故事 126，规格 1.8）：用户 2026-10-07 提出的晨报复盘语音投递。三段链路已真机验证（digest 模板渲染既有、say＋ffmpeg 合成实测、lark-cli `--audio` bot 身份送达实测）；投递形态扩展，不新增服务；与 F16 同改 outbox 分派，建议串行实施。

F04 使用 F03 的实际任务查询呈现日程变更的关联影响，外部操作底座由 F01 的备忘流程建立。F09 的周回顾读取 F08 等待项；F10 会前准备复用 F09 智能 Schedule。F12 汇总运维能力，各早期功能仍须自行交付基础迁移和恢复说明，不把可靠性拖到最后。管理页和共同视觉规范同样随功能交付：F01 建立统一入口、SVG/主题/键盘基础和只读接入页，F02 交付事项与记忆内容，F07 补齐审核查阅，F12 扩展健康与日志。F12 的 T20 是全量复核，不是届时才开发全部界面。

## 实施与依赖判定

1. 开发获准后，领取 Issue 时先定位其功能分组。已有对应功能分支或 Draft PR 时继续使用；没有时，为该功能建立一个分支。组内可按 Issue 多次提交、分次交接上下文，最终由同一个 PR 交付。
2. 同一功能 PR 内，前置 Issue 的代码已在该功能分支上，且对应验收已通过，即可继续下一项。记录提交、验收结果和“已实现，待功能合并”，Issue 保持打开。后续修改影响该前置时重跑相关验收；不以口头完成替代证据。
3. 跨功能 PR 的代码依赖，以前置功能合并到默认分支且所依赖 Issue 验收通过为准。默认更新功能分支后再继续依赖任务；单独关闭 Issue 不足以证明代码可用。
4. GitHub 的 open/closed 与原生阻塞关系保留事项事实。组内推进额外查提交和验收记录，避免“必须先关闭前置，而关闭又必须等整个 PR 合并”的循环等待。领取、frontier 和 resolve 操作统一使用这项判定。
5. 一个功能可以提前开 Draft PR 供审阅；转为可合并前，表中前置、组内全部验收和该功能完整操作演示都应通过。PR 关联全部实际交付的 Issue，合并且验收通过后关闭这些 Issue；未完成的事项保持打开。

组内功能分支还未合并的提交可作为实现进度，不能作为其他功能已经可用的证明。若一个 Issue 涉及两个功能 PR，先明确分拆其交付和验收归属，保证一张实施票只有一个主交付 PR。

## 每个功能 PR 的合并标准

- 说明用户原来的问题、合并后能完成的操作，以及覆盖哪些 Issue；可以用输入、执行结果和实际对象链接演示完整流程。
- 包含该功能所需的迁移、配置、用户入口、结果反馈与使用说明；基础设置只要求已合并的前置功能。
- 通过真实 dsh Loader、Session 和隔离 PostgreSQL 的业务验证；模型、外部网络、时钟可以替换。该功能涉及的超时、重复、重启和未知结果随本 PR 验收。
- 涉及界面时执行该功能对应的 T20：SVG 与状态文字、空/加载/错误/离线状态、明暗主题、窄屏和键盘操作；配置与记忆由对话维护，界面不伪造成功或样本。
- 记录对应真实飞书验证的结果和边界。全量 30–50 页手写评测及完整试运行由 P40 汇总，各功能自己的验证仍在合并前完成。
- 合并到默认分支后，该功能无需等待其他未合并 PR 才能工作。数据库升级与恢复方式随相应变更交付，避免把数据恢复能力留作口头承诺。

## 发布验收 P40

F01–F12 全部合并并通过各自验收后，[P40 / #46](https://github.com/benz-ai-x/dsh-24-PA/issues/46) 汇总真实服务器安装、飞书兼容性、S01–S30、30–50 页手写样本及至少覆盖一次周回顾的试运行结果。检查单一24私助预设、按实际父会话回传、只读接入与记忆展示、UI/UX、工作区配置与 JSON 维护、至少五项真实 Worker、版本审核、固定 profile、无 SQLite I/O、模型不可用时固定提醒及联合恢复。

该票没有预设独立 PR；验收中的代码缺陷按受影响功能修复。各功能从自身 PR 起交付安装包和说明；全量验收不用于补齐前面缺失的功能。缺少真实凭据、授权或样本时明确未验证，原型边界模型结果不能替代真机验收。

## GitHub 发布与推进

工单已关联父规格 #1 并建立原生阻塞关系。本轮按用户要求更新 #1 和工单正文至规格 1.2；保留原有状态、标签、评论、编号和阻塞关系。现有 ready-for-agent 表示工单内容可实施，不代表正式开发或部署已获授权。

每张实施票只有一个主交付功能 PR，正文写明组别与同组/跨组推进规则；真实 PR 建立后再补 PR 链接。工作从无技术前置的 P01 开始，但仅在正式开发另行获准后领取；发布工单不会自动领取、开分支或创建 PR。
