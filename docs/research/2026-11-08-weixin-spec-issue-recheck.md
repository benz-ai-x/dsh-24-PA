# 微信 ClawBot 接入：逐文件代码、Spec 与 Issue 复核

日期：2026-11-08。范围：微信接入直接影响的完整运行链路与既有业务复用边界。结论：需要修订 Spec，但不需要增加工单。首版合并为 #279（WX-R01/F53/F54）；#281 保留后续条件通知。当前没有实现微信功能，没有真实账号测试或部署。

## 复核依据与覆盖边界

- 当前远端 main：`2527f5d2c711e946f4d5b6e67b7de6c18de0a821`，插件 `0.2.2-rc.1.3`、宿主目标 `0.2.2-rc.1`。
- 阅读副本 `/private/tmp/24pa-release-20261108` 的 HEAD 为 `e48983c7d2865890621db4c37b00eb3f3f8c0478`；两者 tree 同为 `f1ba4e6b1cbbef78c2fc2536e0f83f7cc47a812a`。主工作区仍停在较旧提交且有未提交文档，本轮保留这些修改，没有 pull/reset/stash。
- 使用 research 协作完整复核计划链路；主审完整阅读 runtime、入口/权限、收件/出站、配置、账本及联合恢复。codebase-design 用于判断必要接入接口，domain-modeling 用于同步持久身份与远程会话边界。计划子报告已逐段复核，见[计划链路报告](2026-11-08-weixin-plan-code-review.md)。
- 覆盖表中的“完整”均指第 1 行到末尾；不是搜索命中代替阅读。client.js 只完整阅读受影响函数，没有宣称读完全部界面。未逐行审读所有其他业务实现，也没有全仓无缺陷保证。

完整文件共 **66 个、15680 行**：**52 个实现文件、14 个测试文件**。runtime.ts 的 **4484 行**已完整阅读；详细清单在文末。

## 判断与必要修订

### 1. 接入不是只加一个发送器，也不需要新建通用 IM 平台

当前收件、远程会话登记、主人原文、帮助/错误回复、普通回合结果、Worker 结果和恢复提示仍有飞书专用分支。微信需沿现有 runtime 管理生命周期，提取必要的消息信封、入口绑定和固定结果目标；业务账本、Worker、来源与计划服务继续复用。长轮询不能一直持有工作区切换锁；返回后才在绑定校验和短事务内接纳。全局 notifyOwner 的原默认通知出口不因微信入口替换。

[src/runtime.ts:1968](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L1968)、[src/runtime.ts:2051](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L2051)、[src/runtime.ts:2205](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L2205)、[src/runtime.ts:1914](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L1914)、[src/workspace-execution.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/workspace-execution.ts#L1)。已落实到 Spec 收件/执行、WX-02–05/07/10。

### 2. 持久绑定身份与界面临时标识不同

runtime 每次工作区激活都会生成新的 workspaceBinding；ledger-identity 才提供持久工作区身份。微信必须另有持久绑定代次：同身份重启/凭据续期保留，换号或解绑后重绑更新。原 WX-09 将续期与新代次混写，已纠正。退休接入会话还要保留远程分类，否则一般顶层 pa24 会话识别路径可能给它本地权限；不仅首次挂载，还需派发和业务调用复核。跨入口只读业务投影，不能直接暴露完整本地 Skill/运行档案。

[src/runtime.ts:1350](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L1350)、[src/ledger-identity.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/ledger-identity.ts#L1)、[src/runtime.ts:870](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L870)、[src/run-history.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/run-history.ts#L1)。已落实到入口 3–7、ADR-0001、WX-03/09/13。这里是新增入口必须堵住的路径，不声称当前产品已经存在微信越权漏洞。

### 3. 已接纳消息的重启恢复不能直接复用

InboxLifecycle.recover 目前重置 processing，并把所有 admitted 输入经中断回调后标为 rejected；runtime 回调固定用飞书提示“请重新发送”。这与“宿主可能已经接纳/消费、外部动作可能已经发生”的恢复承诺不同。微信要按原稳定输入查宿主持久事件、WorkItem 和 Outbox：已完成只补账，已排队或消费不再次提交，未知保留待核对。不能承诺每个模型回合自动续跑，也不能用重发提示绕过核对。

[src/inbox-lifecycle.ts:121](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/inbox-lifecycle.ts#L121)、[src/runtime.ts:1317](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L1317)、[src/repo/inbox.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/inbox.ts#L1)。已落实到收件恢复、WX-05；既有 transport-activation 测试还明确断言上述旧行为，因此新增测试不能只复跑原断言。

### 4. 微信接纳凭证不能用原生 message_id 代替

当前 DeliveryAdapter 要求 messageId；OutboxDelivery 将无号当 unknown，Outbox 恢复也用 message_id 判断是否仅补本地记录。腾讯参考实现的 messageId 返回 clientId，serverMessageId 才是可选平台号；协议示例 ret=0 并不要求返回号。新契约需独立保存平台接纳、可选原生号及人工依据，不能造一个本地号塞入原生字段。消息引用还需渠道/账号/代次作用域，结果关联不能再通过拆 dedup_key 推断；分段需稳定顺序与单段状态。

[src/outbox-delivery.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/outbox-delivery.ts#L1)、[src/outbox-delivery.ts:78](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/outbox-delivery.ts#L78)、[src/repo/outbox.ts:54](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/outbox.ts#L54)、[src/repo/route.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/route.ts#L1)。外部一手依据：[腾讯协议](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md)、[文本发送实现](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.ts#L103-L139)。本次重读固定版本原文，不将客户端文档等同完整服务端保证。已落实到 WX-06/07。

### 5. 首版人工核对必须覆盖普通回复，且不能永久卡住解绑

PlanResultRepo.repair 只接收计划或 Worker 关联的 Outbox，普通回复/状态通知会被拒；确认已收到还强制 messageId，UI 同样禁止空号提交。微信首版需扩展这些对象和证据，不应等 F55 再做。明确未发的投递可由电脑端放弃该次投递、保留结果及历史，避免受限 token 让解绑永远被 pending 阻塞；unknown 必须先核对，不能伪装未发或强制清空。

[src/repo/plan-result.ts:137](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/plan-result.ts#L137)、[client.js:1858](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/client.js#L1858)、[src/repo/outbox.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/outbox.ts#L1)。已落实到维护、投递、WX-09/12。不是自动重发机制，补投仍是单独明确动作。

### 6. 现有脱敏和物理备份不能自动保护微信令牌

secrets 当前只支持既有四类字段；diagnostic-redaction 与运行档案的脱敏没有覆盖 bot_token/context_token。用纯虚构字符串做本地探针，两个字段均原样返回。更关键的是 SQLite/PG 备份保存整个业务库，文件名排除 secrets.json 无法移除已写进 Inbox JSON 的 token。必须在持久收件前分离凭据，只保存清洁业务信封，扩展密钥/诊断/导出检查，并把凭据存储排除于业务备份。新绑定、游标、出站证据及尚无工作项的微信宿主会话仍需纳入联合恢复完整性检查；恢复实例不立即接管外发。

[src/secrets.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/secrets.ts#L1)、[src/diagnostic-redaction.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/diagnostic-redaction.ts#L1)、[src/run-history.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/run-history.ts#L1)、[src/backup.ts:15](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup.ts#L15)、[src/sqlite.ts:328](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/sqlite.ts#L328)、[src/pg.ts:103](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/pg.ts#L103)、[src/backup-restore.ts:101](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup-restore.ts#L101)。已落实到存储恢复及 WX-11。该探针不包含任何实际账号或凭据。

### 7. F52 可复用交互方式，但微信影响统计与版本契约仍要开发

configurationImpactKinds 现只识别 mode/owner/profile/app 等配置，健康影响统计为全局工作/出站/待审，没有微信账号代次或该绑定的 Inbox 范围。因此“直接复用 F52 原阻断”不准确。应保留只读预览、保存/生效分离和执行时版本复核，并加微信范围。无关飞书待审/出站不应自动阻断微信重绑，实际共享依赖仍需列明。停用除轮询/发送外也须挡住已排队未派发的微信输入。

[src/config-impact.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/config-impact.ts#L1)、[src/runtime.ts:1590](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts#L1590)、[src/repo/health.ts:1](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/health.ts#L1)、[client.js:3180](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/client.js#L3180)。已落实到维护、WX-09/10/12，不改变既有飞书保护。

### 8. F54 是常用计划管理，不是整个本地计划面板

完整审读证实：F50 已有真实原文、15 分钟预览、后续消息确认、重复请求复用和版本检查；飞书引用续办目前也携带 authority，旧研究疑虑不能继续当 bug。微信仍须完整接入首次委派、原引用、明确编号续办及实际采用原文。

新建只有 morning/evening/weekly/once；设置为 time/timeZone/weekdays/at/voice，依规则适用。部分 upgraded 计划 control 更宽，不能因可查到 ID 就开放任意本地 Skill。recentRun 只返回状态/时间等元信息，需要受限业务结果投影。暂停停止未来触发和未启动排队，不中断已开始运行。计划执行 context 沿用原后台会话，确认使用真实微信父会话；旧计划未冻结的通知语义不能假装已经是固定历史接收者。详见[计划链路复核](2026-11-08-weixin-plan-code-review.md)。已落实到 F54 与 WX-13–16，未新增需求编号。

### 9. 工单变少，但没有删除必要验收或提前放行通知

#279 统一承接协议检查点、接入及常用计划管理，一个主 PR；F53/F54 仍分别列需求验收，避免人为串行 PR 和临时能力门禁。#281 保留后续：需 #279 合并验收，且真实发送条件证据覆盖目标计划。原 #277/#278/#280 以归并原因关闭留档；关闭不是 A/B 能力通过或功能完成。

保持基础结论 A 的正式集成门槛；缺账号时可做隔离探针与离线契约，不能声称实测成功。通知结论 B 不足不阻碍基础范围内的首版完成。媒体、群聊、微信资料审核、远程 Shell/本地 Skill 及去飞书初始化仍不在首版。

## 文档和事项同步

- 主 Spec 2.20、微信专项 Spec、整体设计、Manticore 定稿、PR 交付计划、Issue 索引、产品导航与 ADR 同步，不改既有故事、场景与测试编号。
- #279 更新为首版实施及完整规格镜像；#281 改为依赖 #279 及实测通知条件；#1 仅同步受影响段落，保留其原状态及其他规格。
- #277/#278/#280 原正文保留为历史，先说明归并再关闭；#278 移除 ready-for-agent。原生父子/依赖回读后记录最终状态。
- 本轮没有修改 packages 下的业务代码，没有提交、推送、发布或生产操作。

## 运行验证

- `npm run build`：通过，退出码 0，在与 main 同树的阅读副本 `packages/24pa` 运行。
- 本轮既有定向验证：**12 个测试文件、145 项测试全部通过**，用时 636.78 秒。包含实际 SQLite、隔离 PostgreSQL、备份恢复及真实业务模块；没有连接真实微信账号。
- 文件：channel-reliability（42）、runtime-ownership（17）、transport-activation（14）、workspace-activation（14）、backup-recovery（19）、backup（13）、plan-conversation（6）、backup-panel（6）、config-impact（7）、diagnostic-redaction（4）、runtime-identity（2）、pg-backup（1）。执行命令为在 `packages/24pa` 下对以上 `tests/unit/<名称>.test.mjs` 运行 `npx vitest run`。
- 首次受限环境运行未能启动隔离 PG，停止该轮后在允许本机测试端口的环境完整重跑；以上计数仅使用最终成功运行。测试输出保留已有 React key 提示、测试宿主缺少 cwd 的诊断及主动注入的失败日志，不计为产品/微信真实验收。
- `git diff --check` 通过；WX-01–21 唯一且顺序完整；本次文档相对链接存在；packages 无业务代码差异。GitHub #1/#277–#281 的正文逐字回读匹配，未要求变化的负责人/里程碑/标签/评论均保留；#278 仅移除已不适用的 ready-for-agent。
- 原生关系已回读：#279、#281 的父项均为 #1；#281 blocked_by 为 [279]，#279 与已归并 #280 不再保留旧阻塞。#277/#278/#280 均为 CLOSED/not_planned，历史正文与归并说明保留。
- [验证记录](evidence/2026-11-08-weixin-recheck/validation.json)与[本轮完整测试日志](evidence/2026-11-08-weixin-recheck/tests.log)保存在仓库文档目录。

这些验证证明既有复用基础在所测范围通过，不证明新微信传输、角色/游标/回执迁移、真实 Loader 的微信装配或平台账号可用。微信新验收仍由 #279/#281 完成。

## 完整阅读清单

路径相对 packages/24pa，均以本报告固定提交为准。计划相关文件由 research 子项完整读后汇总证据，主审已审阅报告并交叉核对关键 runtime 入口。

| 实现文件 | 完整行数 | 阅读分工 |
|---|---:|---|
| [src/runtime.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/runtime.ts) | 4484 | 主审 |
| [src/index.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/index.ts) | 61 | 主审 |
| [src/roles.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/roles.ts) | 65 | 主审 |
| [src/tools.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/tools.ts) | 271 | 主审 |
| [src/host.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/host.ts) | 210 | 主审 |
| [src/host-turn.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/host-turn.ts) | 72 | 主审 |
| [src/local-tool-access.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/local-tool-access.ts) | 175 | 主审 |
| [src/feishu.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/feishu.ts) | 419 | 主审 |
| [src/inbox-lifecycle.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/inbox-lifecycle.ts) | 131 | 主审 |
| [src/repo/inbox.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/inbox.ts) | 112 | 主审 |
| [src/repo/route.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/route.ts) | 31 | 主审 |
| [src/outbox-delivery.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/outbox-delivery.ts) | 113 | 主审 |
| [src/repo/outbox.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/outbox.ts) | 89 | 主审 |
| [src/config.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/config.ts) | 457 | 主审 |
| [src/config-impact.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/config-impact.ts) | 24 | 主审 |
| [src/workspace-config.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/workspace-config.ts) | 64 | 主审 |
| [src/secrets.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/secrets.ts) | 89 | 主审 |
| [src/ledger-identity.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/ledger-identity.ts) | 35 | 主审 |
| [src/diagnostic-redaction.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/diagnostic-redaction.ts) | 23 | 主审 |
| [src/repo/state.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/state.ts) | 84 | 主审 |
| [src/backup.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup.ts) | 214 | 主审 |
| [src/backup-ledger.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup-ledger.ts) | 90 | 主审 |
| [src/backup-host.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup-host.ts) | 64 | 主审 |
| [src/backup-service.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup-service.ts) | 83 | 主审 |
| [src/backup-restore.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/backup-restore.ts) | 308 | 主审 |
| [src/repo/backup-inspection.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/backup-inspection.ts) | 59 | 主审 |
| [src/workspace-execution.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/workspace-execution.ts) | 75 | 主审 |
| [src/db-schema.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/db-schema.ts) | 55 | 主审 |
| [src/panel.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/panel.ts) | 334 | 主审 |
| [src/repo/work.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/work.ts) | 333 | 主审 |
| [src/repo/work-control.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/work-control.ts) | 42 | 主审 |
| [src/run-history.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/run-history.ts) | 150 | 主审 |
| [src/repo/health.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/health.ts) | 89 | 主审 |
| [src/db.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/db.ts) | 916 | 主审 |
| [src/sqlite.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/sqlite.ts) | 370 | 主审 |
| [src/pg.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/pg.ts) | 128 | 主审 |
| [src/repo/worker-run.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/worker-run.ts) | 231 | 主审 |
| [src/plan-conversation.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/plan-conversation.ts) | 153 | 计划链路子项 |
| [src/work-owner-input.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/work-owner-input.ts) | 38 | 计划链路子项 |
| [src/task-plan.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/task-plan.ts) | 122 | 计划链路子项 |
| [src/task-plan-settings.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/task-plan-settings.ts) | 47 | 计划链路子项 |
| [src/task-plan-migration.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/task-plan-migration.ts) | 53 | 计划链路子项 |
| [src/task-plan-service.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/task-plan-service.ts) | 274 | 计划链路子项 |
| [src/task-plan-access.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/task-plan-access.ts) | 95 | 计划链路子项 |
| [src/task-plan-engine.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/task-plan-engine.ts) | 154 | 计划链路子项 |
| [src/plan-lifecycle.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/plan-lifecycle.ts) | 240 | 计划链路子项 |
| [src/repo/task-plan.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/task-plan.ts) | 263 | 计划链路子项 |
| [src/plan-results.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/plan-results.ts) | 46 | 计划链路子项 |
| [src/repo/plan-result.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/repo/plan-result.ts) | 173 | 计划链路子项 |
| [src/source-access.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/source-access.ts) | 122 | 计划链路子项 |
| [src/worker-runs.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/worker-runs.ts) | 189 | 计划链路子项 |
| [src/work-item-lifecycle.ts](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/src/work-item-lifecycle.ts) | 295 | 计划链路子项 |

| 测试文件 | 完整行数 |
|---|---:|
| [tests/unit/channel-reliability.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/channel-reliability.test.mjs) | 544 |
| [tests/unit/runtime-identity.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/runtime-identity.test.mjs) | 44 |
| [tests/unit/runtime-ownership.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/runtime-ownership.test.mjs) | 209 |
| [tests/unit/transport-activation.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/transport-activation.test.mjs) | 283 |
| [tests/unit/workspace-activation.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/workspace-activation.test.mjs) | 219 |
| [tests/unit/config-impact.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/config-impact.test.mjs) | 96 |
| [tests/unit/diagnostic-redaction.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/diagnostic-redaction.test.mjs) | 65 |
| [tests/unit/plan-conversation.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/plan-conversation.test.mjs) | 148 |
| [tests/unit/task-plan-service.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/task-plan-service.test.mjs) | 515 |
| [tests/unit/plan-lifecycle.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/plan-lifecycle.test.mjs) | 199 |
| [tests/unit/plan-results.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/plan-results.test.mjs) | 165 |
| [tests/unit/plan-delivery-guards.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/plan-delivery-guards.test.mjs) | 99 |
| [tests/unit/work-item-lifecycle.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/work-item-lifecycle.test.mjs) | 76 |
| [tests/unit/worker-run.test.mjs](https://github.com/benz-ai-x/dsh-24-PA/blob/2527f5d2c711e946f4d5b6e67b7de6c18de0a821/packages/24pa/tests/unit/worker-run.test.mjs) | 204 |

另外完整阅读 client.js 的 PlanDeliveryControls、useConfigurationImpact、ConfigurationImpact、ConfigurationEvidence、ConfigFormDetail 函数；卡片注册表只做定位核对，不计整文件。已读 package.json、联合恢复与 PG 测试辅助入口。其他备份测试只做相关范围核对，不计入以上“完整测试文件”统计。

源码覆盖不等于测试覆盖；现有单测包含宿主/网络替身。真实 Loader 装配、双库微信迁移、微信延迟发送、账号授权及生产恢复仍是实施验收工作。
