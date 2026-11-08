# F55 微信周期结果通知：官方协议复核与通知结论 B 的验证边界

研究日期：2026-11-09（Asia/Shanghai）；在线版本复核时间：2026-11-09 01:00（UTC+8）。本次仅研究公开源码及仓库规格，未登录、未读取真实凭据、未收发微信、未改产品代码或 Issue、未执行官方项目代码。

## 1. 结论与版本

**官方客户端已经实现供定时任务调用的独立发送出口，但公开资料仍不足以承诺任意时间、任意频率的微信周期通知。通知结论 B 仍须通过本人账号、实际目标条件的独立测试建立；此前 391132 ms 的延迟回复属于 A 的证据，不能自动提升为 B。**

本次 GitHub 在线读取 `Tencent/openclaw-weixin` 的 `main`，仍为 `874637a0dbc24050f72d1385add4fc6170a2d726`，tree 为 `899317ae48f1768d2cba52f9c7f7294cf72d3040`，提交时间 `2026-10-13T03:31:48Z`；与已固定版本比较为 `identical`，新增提交和变化文件均为 0。包版本仍是 `2.4.10`。因此没有新公开协议改变先前证据边界。[官方提交](https://github.com/Tencent/openclaw-weixin/commit/874637a0dbc24050f72d1385add4fc6170a2d726)、[包版本](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/package.json#L1-L7)

24私助规格核对基线为功能工作树 `/private/tmp/24pa-weixin-279-20261108` 的 `48d20b818b9f0d5964562f4cdb273af8b79d868a`，读取时工作树干净；根目录的 `55d7c12` 滞后，不用于判断当前实施状态。已读 AGENTS、产品基线、领域约定、GLOSSARY、ADR-0001 及微信规格相关章节。现规格要求 B 覆盖拟交付通知场景之后才放行 F55，且明确禁止把少量成功推导为无限有效。[F55 要求](https://github.com/benz-ai-x/dsh-24-PA/blob/48d20b818b9f0d5964562f4cdb273af8b79d868a/docs/planning/24PA-%E5%BE%AE%E4%BF%A1ClawBot%E6%8E%A5%E5%85%A5-SPEC.md#L104-L110)、[A/B 门槛](https://github.com/benz-ai-x/dsh-24-PA/blob/48d20b818b9f0d5964562f4cdb273af8b79d868a/docs/planning/24PA-%E5%BE%AE%E4%BF%A1ClawBot%E6%8E%A5%E5%85%A5-SPEC.md#L140-L148)

## 2. 上下文与延迟发送：能确定什么

| 问题 | 官方证据 | 可采用的结论及限制 |
|---|---|---|
| 能否由定时器发起发送，而不等待下一条入站？ | `channel.ts` 明确提供 cron 投递指引；`outbound.sendText` 直接取缓存 token 并调用发送。 | **客户端路径可以**。这证明无需同一入站处理栈，也无需等待新消息才发 HTTP；没有证明服务器在任何延迟下均接受。 |
| 定时结果发给谁？ | cron 指引要求显式 `delivery.to` 和 `delivery.accountId`；多账号推断存在无匹配和歧义错误。 | 24私助应固定已授权账号、主人及绑定代次，不依赖最近会话或自动猜账号。 |
| `context_token` 是否必填？ | 官方指导回复时原样回传；请求类型可选；发送函数缺失时警告但仍请求。 | 不能据可选字段或单测声称无 token 可发。F55 可采用“缺失则受限”的保守产品策略；这不等于已证实服务端绝对必填。 |
| token 如何更新及恢复？ | 处理入站后按 `accountId + from_user_id` 覆盖缓存并落盘；启动恢复；发送时重新取值。 | 可复用“同一身份最新上下文”的思路。缓存恢复只说明本地仍有值，不说明服务器仍认可。 |
| token 是否有 TTL？ | 缓存只存字符串，没有签发时间、过期时间或次数；所谓 active token 只检查 `Map.has`。 | **官方缓存不能判断有效期**；不能把存在、在线、可轮询或已登录显示为“通知一定可用”。 |

证据：[cron 与账号选择](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L69-L116)、[cron 指引与发送出口](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L247-L279)、[缓存、恢复与存在检查](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts#L17-L127)、[入站更新](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/process-message.ts#L291-L294)、[启动恢复](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L493-L496)、[官方上下文说明](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L248)

两种 token 不能混同：请求鉴权使用 `bot_token`；`context_token` 随消息提供，用于回复上下文。已公开的 `-14` 被源码注释为 **bot token stale/expired**。客户端收到它后暂停该账号一小时；这是一项客户端冷却策略，既不是 `context_token` 一小时 TTL，也不是平台主动发送窗口。CHANGELOG 还明确把原 `SESSION_EXPIRED_ERRCODE` 更名为 `STALE_TOKEN_ERRCODE`，以避免把它解释成会话过期。[鉴权](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L32-L48)、[错误码和冷却](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/session-guard.ts#L3-L27)、[轮询处理](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/monitor/monitor.ts#L111-L126)、[更名依据](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/CHANGELOG.md#L40-L49)

本次检查的官方 README、中英文协议、CHANGELOG 和相关实现**没有明确给出**回复 token 的服务端寿命、无新入站主动发送时间窗、每个 token 可发送次数、每日额度或按账号/接收人限频表。没有据此建立“24 小时”“10 条”规则，也没有据此证明无限制。协议明确说客户端类型与行为不是完整服务端契约，额外服务端要求需另行核验。[协议解释边界](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L7-L19)、[官方 README](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/README.md)、[更新记录](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/CHANGELOG.md)

特别避免混淆两个现有数字：QR 请求最近 **10 个本地 bot token** 是登录去重识别数据；出站 `textChunkLimit: 4000` 是客户端分段配置。二者都不是微信周期通知额度。[登录 token 列表](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L87-L102)、[文本分段](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L267-L279)

## 3. 文本发送、错误与回执契约

发送使用 `POST /ilink/bot/sendmessage`，消息包含目标用户、客户端生成的 `client_id`、BOT/FINISH 类型、文本项以及可用的 `context_token`；公共元信息在 API 层补入。它不是独立的“订阅通知”接口，周期发送与普通回复使用同一出口。[请求构造](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.ts#L56-L79)、[API 调用](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L579-L596)

| 观察结果 | 官方实现依据 | 24私助可采用的记录口径 |
|---|---|---|
| HTTP 成功，`ret: 0`，有原生号 | `ret` 非零才抛错，返回 `message_id`。 | 平台接纳，记录真实原生号；未证明本人已读。 |
| HTTP 成功，只有有效 `message_id`，省略 `ret` | 发送函数直接返回该原生号；单测专门模拟了这一形态。 | **可作为平台接纳依据**，保留“无 ret、有原生号”证据；不能沿用早期探针的严格 ret 策略，要求服务端必须给 ret。 |
| HTTP 成功，明确 `ret: 0`，无原生号 | 协议发送示例即该形态；类型中原生号可选。 | 已接纳但缺少原生号；不可拿本地 `client_id` 冒充平台号，也不可伪造原生引用关系。 |
| HTTP 成功但明确非零 `ret` | `sendMessage` 抛错；HTTP 与业务结果分别检查。 | 记录平台业务拒绝及脱敏原因。不要把任意非零码都命名为“上下文过期”。 |
| HTTP 成功但空对象/形态不明 | 官方客户端甚至在 `{}` 单测中直接通过，这是其宽松行为。 | 不能仅凭不抛错提升为已接纳；24私助可保持未知并核对。 |
| 超时、断网、异常正文或非成功 HTTP | fetch wrapper 抛错，没有提供发送状态查询或幂等证据。 | 分别记录传输事实；可能已发出但拿不到可信响应时保留未知，不盲重试。 |

依据：[响应字段](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/types.ts#L239-L244)、[回执与本地 ID 分离](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.ts#L103-L137)、[只有原生号的发送单测](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.test.ts#L105-L134)、[ret 与空对象测试](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.test.ts#L182-L213)、[无原生号的响应示例](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L239-L248)、[HTTP 处理](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L412-L435)

原生 `message_id` 在线上可能是 uint64，应无损保留；官方解析器在普通 JSON 数值解析前保护这类字段。`sendMessageWeixin().messageId` 是本地产生的客户端 ID，真正服务器号另名 `serverMessageId`；官方高层通道还只向宿主返回前者。24私助自行接协议时必须保留这一区别。[无损解析](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L518-L576)、[返回字段](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.ts#L127-L132)、[高层通道返回](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L154-L180)

官方列出的接口中没有消息送达/已读查询接口；`getUpdates` 的收信重试与 `sendMessage` 的重发是两回事。`client_id` 是客户端标识，公开参考未给出服务端去重范围、保存时长或重放保证。因此“接口返回”“平台接纳”“本人看到”“业务完成”必须分别记账；未知投递不能靠重新执行计划来解决。[公开接口列表](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L150-L164)、[逐操作错误语义](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L67-L84)

## 4. 对哪些周期计划可以形成条件性支持

下表是接入建议与待验证条件，不是已经完成的能力验收。

| 计划条件 | 本次能给的判断 | 放行前证据与运行边界 |
|---|---|---|
| 固定本人绑定、已有上下文，短间隔文本结果 | 官方路径支持发起；服务端实际可用性待 B。 | 在原对话已结束后独立定时发送，保持无新入站并核对本人可见。 |
| 每日晨报/日终复盘 | 不能由一次分钟级成功推断。 | 需要覆盖真实隔夜/日间空闲间隔、预计连续次数及内容分段；实际延迟包括免打扰、离线和排队。 |
| 每周回顾、长时间未聊天 | 本次没有该年龄上下文的可用证据。 | 需要相应长间隔样本或新增服务端契约；不能以每天聊天或短间隔样本代替。 |
| 多计划集中到点、长结果多段 | 客户端有分段，平台额度不明。 | 按拟开放的实际集中次数/段数验证；一次单段不能证明多段或高频。不要通过压力轰炸推测额度。 |
| 重启后使用持久上下文 | 官方有本地恢复设计；实际接受仍待验证。 | 至少一次无新入站的恢复后独立通知；身份与绑定代次相同，不能换号后借旧 token。 |
| token 缺失、账号停用/换号、授权撤销 | 不具备可承诺的微信目标。 | 本地阻断/受限，结果仍保存且电脑端可查；恢复新授权后按明确核对流程处理，不能静默改投。 |
| 语音计划迁往微信 | 超出 F55 首版文本范围。 | 主人明确选择文本或保留原渠道；不可因为微信有语音字段而自动开放。 |

这与现行规格的“明确选择结果目标、固定身份、在途保留快照、结果先保存、免打扰与有效期、失败不重办业务”一致，不需要因官方存在 cron 代码而删除 B 门槛。[F55 契约](https://github.com/benz-ai-x/dsh-24-PA/blob/48d20b818b9f0d5964562f4cdb273af8b79d868a/docs/planning/24PA-%E5%BE%AE%E4%BF%A1ClawBot%E6%8E%A5%E5%85%A5-SPEC.md#L104-L110)

如果仅取得短间隔 B，结论应写为“该账号、该版本、该上下文年龄和发送序列下有条件可用”，不能直接开放任意日/周计划。可以设定由实测支持的本地保守使用边界，但必须标明它是产品准入策略，不是已知的腾讯窗口/额度；不能把缺少证据伪装成平台规定。

## 5. 通知结论 B：最小真实测试矩阵

本矩阵供主审在已授权的本人隔离会话执行；本研究没有执行其中任何一项。测试消息须有唯一测试编号、明确文字和可核对的计划/运行标识。采用真实定时触发或独立调度探针，不能仍由原入站处理函数延迟回复来冒充周期通知。

| 编号 | 必要场景 | 最小做法 | 能够证明的范围 |
|---|---|---|---|
| B1 | 原对话结束后的独立通知 | 获取本人有效上下文并完成原交互；记录结束时间；无新入站时由独立定时器生成一条纯文本结果，核对响应与本人可见。 | 已脱离原回复调用栈的主动发送路径可用；只覆盖实测 token 年龄。 |
| B2 | 连续周期发送，无新上下文 | 按拟开放频率至少观察两个独立到点触发，期间不刷新 token，不夹带本人来信；记录每次段数、响应和可见结果。可与 B1 的两次触发合并。 | 对该具体连续序列有证据；两次不是“平台额度≥2”的永久政策证明。 |
| B3 | 目标最长空闲间隔及恢复 | 根据拟开放的晨报/复盘/周回顾选择真实最晚间隔，纳入计划允许的免打扰/排队推迟；其间重启恢复，再独立发送。全程记录是否有新入站或 token 更新。 | 仅覆盖该年龄和重启条件；可与 B2 的后一个到点合并，不必为每一项另发消息。 |
| B4 | 条件失效或拒绝的真实解释 | 若自然遇到明确拒绝，记录原始业务码/脱敏文本及 token 年龄；必要时由本人发一条新消息，再对“明确未接纳”的同一保存结果按已授权流程补投。 | 可证明该次拒绝与刷新后的行为；不能仅由 -14 或文案猜测 context TTL。没有出现则标未观察。 |

**其中 B1–B3 是拟开放场景的正向最小证据；B4 是遇到异常时的判定要求，不要求为研究故意破坏真实账号。** 对“每日”用途，分钟级压缩测试不替代真实隔夜/跨日观察；对“每周”用途，隔夜结果不替代长间隔观察。任何有限测试都不是长期服务保证，应保留发送时检查和真实受限状态。

如果首版选择始终要求已有 token，则“无 token 直接向服务端发送”不是必要正向实验：使用离线边界测试证明本地拒绝即可。不要为了穷举未知服务端限制而删除真实 token、伪造他人身份、扫频或连续探测额度。

B 的每个样本至少保存以下脱敏证据：

- 本人测试账号和目标的稳定摘要、工作区/绑定代次、24私助与协议版本、API 主机、测试编号及计划/运行标识。
- 最后一次有效入站时间、原交互结束时间、token 最后更新时间与不可逆摘要；每次发送时的 token 年龄、距上次发送间隔、累计请求数与分段数。
- 无新入站的观察起止、轮询是否连续、期间重启和游标恢复情况；只能说“监测期间未观察到新入站”，不能由空轮询证明服务端绝对没有消息。
- 计划触发时间、结果保存时间、实际发送时间；HTTP 状态、`ret/errcode` 是否存在及值、脱敏错误、客户端 ID 与真实原生 ID 分列。
- 平台接纳/拒绝/未知判定、本人可见确认时间；未知时的人工核对结论和操作保留，不覆盖历史记录。

该证据记录不包含 bot/context token、二维码授权或完整敏感平台 JSON。每份 B 结论必须列出适用与未覆盖条件，例如“已测文本单段、该账号、最长间隔 X、连续 N 次、无新入站、重启一次；更长间隔、更多次数、多段及失效恢复未验证”。这沿用 WX-R01 B 的现行定义，不用一个全局 `supported=true` 掩盖条件。[B 定义](https://github.com/benz-ai-x/dsh-24-PA/blob/48d20b818b9f0d5964562f4cdb273af8b79d868a/docs/planning/24PA-%E5%BE%AE%E4%BF%A1ClawBot%E6%8E%A5%E5%85%A5-SPEC.md#L140-L148)

## 6. 真实平台证据与工程测试分开

可以离线完整验证的工程边界包括：已保存结果与投递状态分离、目标快照与绑定代次、停用/换号阻断、缺 token、明确拒绝、unknown 不自动重发、分段只补未发、免打扰/过期、重启恢复及补投不重跑业务。这些应走现有真实 Loader/Session、SQLite/PostgreSQL 与外部替身验证；它们不能替代 B 的服务端接受和本人可见证据。[WX-17–21](https://github.com/benz-ai-x/dsh-24-PA/blob/48d20b818b9f0d5964562f4cdb273af8b79d868a/docs/planning/24PA-%E5%BE%AE%E4%BF%A1ClawBot%E6%8E%A5%E5%85%A5-SPEC.md#L132-L138)

此前 A 的 391132 ms 延迟发送记录应保持原结论：它验证了一次当时条件下的异步回复及本人可见，不自动证明独立周期触发、跨日/跨周、重复发送额度或长期上下文有效。早期探针因要求 `ret` 而保留 unknown 的实验记录也应保留；当前官方源码允许“省略 ret、给原生号”，可以修正正式判据的解释，但不能改写历史探针实际观察。[既有 A 记录与边界](https://github.com/benz-ai-x/dsh-24-PA/blob/48d20b818b9f0d5964562f4cdb273af8b79d868a/docs/planning/24PA-%E5%BE%AE%E4%BF%A1ClawBot%E6%8E%A5%E5%85%A5-SPEC.md#L27-L30)

## 7. 研究覆盖与尚未取得的证据

本次在线复核 main/compare/tree、README、CHANGELOG、中英文协议；对固定源码快照复读 `src/channel.ts` 的账号选择、cron、发送和启动恢复部分，`inbound.ts` 的完整 context store，`process-message.ts` 的 token 更新，`session-guard.ts` 全文，`monitor.ts` 错误处理，`api.ts` 的 HTTP/无损 ID/发送逻辑，相关 `types.ts` 与 `send.ts`，并检查 `api.test.ts`、`send.test.ts` 中对应单测。未宣称通读官方全仓或执行其测试。

读取的本地快照为 `/private/tmp/24pa-weixin-protocol-research-20261108`；上述 12 个核心文件与当前官方 tree 的 Git blob 逐一匹配（早期连接器快照有的仅追加一个末尾空行，行号不变）。测试源码是客户端行为证据，缺上下文也“不抛错”的 mock 不是真实平台通过记录。[相关 mock](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.test.ts#L46-L69)

仍未知：服务端 context token 寿命、缺失时接受规则、发送配额/窗口/限频、旧 token 与新 token 的同时有效性、不同账号/后端策略差异、服务端重放去重语义，以及更长空闲或持续重复时的实际可用性。当前资料不能补齐这些事实；需要新的第一方契约或相应条件的本人账号记录。

**本报告本身的通知结论 B：未验证。** 可据此设计最小探针并评审 F55 的条件范围；不能据此关闭 #281、标记真实通知验收通过，或改变 #279 尚待本人真实验收的状态。
