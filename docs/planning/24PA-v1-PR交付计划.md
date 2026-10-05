# 24PA v1 PR 交付计划

更新：2026-10-05。用户已确定“一个 PR 交付一个可以实际使用的功能，可以包含多个 Issue”，本轮进一步明确执行 to-tickets 并写入 GitHub Issues。工单按 [规格 1.1](../24PA-v1-SPEC.md) 和 [父规格 #1](https://github.com/benz-ai-x/dsh-24-PA/issues/1) 重新校准；当前已发布 44/44 张。

本次只发布实施计划，正式实现和生产部署仍按用户后续授权执行。可丢弃原型及其证据见 [原型验收记录](../prototypes/24PA-原型验收记录.md)，不计入下面 12 个生产功能 PR。

## 校准结果与交付单位

旧 P01–P40 的正文与映射已全部校准到规格 1.1；删除全局 A–E 当前指针，采用工作区、顶层 Lead、按事项隔离的原生 Worker、JSON 记忆和本人发起的维护。新增 P41 配置维护、P42 JSON 条目维护、P43 手工整理与撤销、P44 Worker 注册，使 101–110 故事及 T17–T19 有独立可验收归属。

共 **44 张工单**：43 张实施票组合成 **12 个功能 PR**，P40 跟踪整体发布验收，不预设独立 PR。P 编号为稳定规划编号，不表示执行顺序；GitHub 编号是实际事项。完整依赖顺序、验收与 110 条故事/26 场景/19 测试组映射见 [工单清单](24PA-v1-工单拆分草案.md)。

Issue 描述一次独立工作上下文可完成的完整流程；持久化、授权、操作回执与恢复随首个使用它的业务一起交付。PR 汇集同一可用功能所需的 Issue、迁移、配置和验证。完成一张票不触发新建 PR；数量仅在实现证据证明需要时调整，拆分后仍必须独立可用。

## 功能分组

“前置 PR”是完整功能合并所需的直接前置，已去除传递边。各 Issue 保留具体技术阻塞，编号不表示全部串行。

| 功能 PR | 包含的工单 | 前置 PR | 合并后可以完成的操作 |
|---|---|---|---|
| F01 工作区助理与随手记 | [P01 / #3](https://github.com/benz-ai-x/dsh-24-PA/issues/3)、[P02 / #4](https://github.com/benz-ai-x/dsh-24-PA/issues/4)、[P03 / #5](https://github.com/benz-ai-x/dsh-24-PA/issues/5)、[P14 / #6](https://github.com/benz-ai-x/dsh-24-PA/issues/6)、[P41 / #7](https://github.com/benz-ai-x/dsh-24-PA/issues/7) | 无 | 选择目录、校验工作区规则与配置，通过原生维护会话修改/重载；飞书向 Lead 交办，备忘 Worker 保存真实文档并返回出处。 |
| F02 并行事项与记忆维护 | [P04 / #8](https://github.com/benz-ai-x/dsh-24-PA/issues/8)、[P05 / #9](https://github.com/benz-ai-x/dsh-24-PA/issues/9)、[P06 / #10](https://github.com/benz-ai-x/dsh-24-PA/issues/10)、[P07 / #11](https://github.com/benz-ai-x/dsh-24-PA/issues/11)、[P42 / #12](https://github.com/benz-ai-x/dsh-24-PA/issues/12)、[P36 / #13](https://github.com/benz-ai-x/dsh-24-PA/issues/13)、[P43 / #14](https://github.com/benz-ai-x/dsh-24-PA/issues/14)、[P44 / #15](https://github.com/benz-ai-x/dsh-24-PA/issues/15) | F01 | Lead 委派至少五项原生 Worker 工作；按事项查看、继续、停止及恢复；维护会话 CRUD/手工整理 JSON，业务 Agent 按需读取；注册新专业职责。 |
| F03 任务与项目清单 | [P08 / #16](https://github.com/benz-ai-x/dsh-24-PA/issues/16)、[P09 / #17](https://github.com/benz-ai-x/dsh-24-PA/issues/17)、[P17 / #18](https://github.com/benz-ai-x/dsh-24-PA/issues/18) | F02 | 创建、完成、调整任务，拆解项目和个人事务，查看实际进展；多个 Worker 修改同一任务得到一致结果。 |
| F04 日程与会议安排 | [P10 / #19](https://github.com/benz-ai-x/dsh-24-PA/issues/19)、[P11 / #20](https://github.com/benz-ai-x/dsh-24-PA/issues/20)、[P12 / #21](https://github.com/benz-ai-x/dsh-24-PA/issues/21) | F03 | 查询忙闲与关联任务影响、安排本人日程、邀请指定参会人，随后改期或取消并获得真实回执。 |
| F05 个人提醒与免打扰 | [P15 / #22](https://github.com/benz-ai-x/dsh-24-PA/issues/22)、[P18 / #23](https://github.com/benz-ai-x/dsh-24-PA/issues/23)、[P20 / #24](https://github.com/benz-ai-x/dsh-24-PA/issues/24)、[P21 / #25](https://github.com/benz-ai-x/dsh-24-PA/issues/25) | F02 | 在维护会话设置偏好；飞书设置单次或周期提醒，主动收到通知，支持稍后、停止、静默和休假；固定提醒在模型不可用时仍运行。 |
| F06 手写笔记整理与人工审核 | [P28 / #26](https://github.com/benz-ai-x/dsh-24-PA/issues/26)、[P29 / #27](https://github.com/benz-ai-x/dsh-24-PA/issues/27)、[P31 / #28](https://github.com/benz-ai-x/dsh-24-PA/issues/28)、[P32 / #29](https://github.com/benz-ai-x/dsh-24-PA/issues/29) | F02 | 通过飞书 App 拍照提交一页笔记，得到待审文档，批准或退回指定版本；修改后重新审核，文档显示真实审核状态。 |
| F07 多页笔记与集中复核 | [P30 / #30](https://github.com/benz-ai-x/dsh-24-PA/issues/30)、[P33 / #31](https://github.com/benz-ai-x/dsh-24-PA/issues/31) | F05、F06 | 整理多页、小字及图示，按原稿定位疑点，通过待审队列和有节制的提醒完成批量复核。 |
| F08 事项交办与持续跟进 | [P13 / #32](https://github.com/benz-ai-x/dsh-24-PA/issues/32)、[P19 / #33](https://github.com/benz-ai-x/dsh-24-PA/issues/33)、[P22 / #34](https://github.com/benz-ai-x/dsh-24-PA/issues/34)、[P23 / #35](https://github.com/benz-ai-x/dsh-24-PA/issues/35) | F04、F05 | 明确授权交办或发信，持续跟踪等待项和周期事项；任务、会议改期取消会更新提醒，催办默认提醒本人。 |
| F09 每日规划与定期回顾 | [P16 / #36](https://github.com/benz-ai-x/dsh-24-PA/issues/36)、[P24 / #37](https://github.com/benz-ai-x/dsh-24-PA/issues/37)、[P25 / #38](https://github.com/benz-ai-x/dsh-24-PA/issues/38) | F08 | 开启晨报、规划时间块、处理插单、进行晚间及每周回顾；智能周期工作通过原生 Schedule 唤醒顶层 Lead 后委派。 |
| F10 会议资料与纪要行动 | [P26 / #39](https://github.com/benz-ai-x/dsh-24-PA/issues/39)、[P27 / #40](https://github.com/benz-ai-x/dsh-24-PA/issues/40) | F09 | 会前收到有出处的资料包，会后把文字材料整理成纪要，选择行动创建任务或日程。 |
| F11 审核笔记的行动与综合查询 | [P34 / #41](https://github.com/benz-ai-x/dsh-24-PA/issues/41)、[P35 / #42](https://github.com/benz-ai-x/dsh-24-PA/issues/42) | F07、F10 | 从已审核笔记中单独授权执行行动，查询可信历史决定，并在今日概览和晨报中看到等待及待审事项。 |
| F12 运行维护与数据恢复 | [P37 / #43](https://github.com/benz-ai-x/dsh-24-PA/issues/43)、[P38 / #44](https://github.com/benz-ai-x/dsh-24-PA/issues/44)、[P39 / #45](https://github.com/benz-ai-x/dsh-24-PA/issues/45) | F11 | 查看健康和预算、处理会话归档及计划，完成配置/JSON/PG/会话/原稿/审核快照联合备份恢复；明确发现缺失数据、授权失效和能力降级。 |

F06 是最早可实际使用的手写完整流程：收图、识别、写文档、待审通知、本人批准/退回、修改失效均交付；F02 合并后可与任务/日程/提醒分支并行推进。F07 增加多页增强和集中复核。常规助理和全部手写能力均属于 v1。

F04 使用 F03 的实际任务查询呈现日程变更的关联影响，外部操作底座由 F01 的备忘流程建立。F09 的周回顾读取 F08 等待项；F10 会前准备复用 F09 智能 Schedule。F12 汇总运维能力，各早期功能仍须自行交付基础迁移和恢复说明，不把可靠性拖到最后。

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
- 记录对应真实飞书验证的结果和边界。全量 30–50 页手写评测及完整试运行由 P40 汇总，各功能自己的验证仍在合并前完成。
- 合并到默认分支后，该功能无需等待其他未合并 PR 才能工作。数据库升级与恢复方式随相应变更交付，避免把数据恢复能力留作口头承诺。

## 发布验收 P40

F01–F12 全部合并并通过各自验收后，[P40 / #46](https://github.com/benz-ai-x/dsh-24-PA/issues/46) 汇总真实服务器安装、飞书兼容性、S01–S26、30–50 页手写样本及至少覆盖一次周回顾的试运行结果。检查工作区配置与 JSON 维护、至少五项真实 Worker、版本审核、固定 profile、无 SQLite I/O、模型不可用时固定提醒及联合恢复。

该票没有预设独立 PR；验收中的代码缺陷按受影响功能修复。各功能从自身 PR 起交付安装包和说明；全量验收不用于补齐前面缺失的功能。缺少真实凭据、授权或样本时明确未验证，原型边界模型结果不能替代真机验收。

## GitHub 发布与推进

工单统一标记 ready-for-agent，关联父规格 #1 并建立原生阻塞关系。父规格正文、状态与评论保持不变；其历史阶段的“暂不发布工单”已由用户本次直接发布要求取代，其他实施/部署边界继续有效。

每张实施票只有一个主交付功能 PR，正文写明组别与同组/跨组推进规则；真实 PR 建立后再补 PR 链接。工作从无技术前置的 P01 开始，但仅在正式开发另行获准后领取；发布工单不会自动领取、开分支或创建 PR。
