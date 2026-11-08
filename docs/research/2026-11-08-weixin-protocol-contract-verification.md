# 微信 ClawBot / iLink 协议契约核验

日期：2026-11-08。归属：#279 的 WX-R01 检查点。结论性质：官方公开客户端源码核验；尚未登录、收信或发送，**Gate A 未验证，通知条件 B 未验证**。

## 1. 版本、范围与证据边界

本次通过 GitHub 连接器重新查询 Tencent/openclaw-weixin：默认分支为 `main`，HEAD 仍为 **`874637a0dbc24050f72d1385add4fc6170a2d726`**，提交时间 `2026-10-13T03:31:48Z`，tree 为 `899317ae48f1768d2cba52f9c7f7294cf72d3040`。与上一轮固定版本比较为 `identical`，新增提交和变化文件均为 0。包版本为 **2.4.10**；本次不是新协议版本升级，而是同版本关键路径的完整审读。[版本提交][commit]、[固定版本比较][compare]、[包元数据][package]

已读最新微信 Spec、AGENTS、产品/领域/交付指引、GLOSSARY 和 ADR-0001。按已确认路线自行实现 HTTP 传输，随24私助包交付；本研究没有安装或依赖 dsh-im、OpenClaw，没有运行下载的代码，没有读任何真实密钥，也没有请求微信 API。研究产物只写本文件，主 Spec 和业务代码不变。

源码快照位于 `/private/tmp/24pa-weixin-protocol-research-20261108`，从固定 commit 逐文件获取。完整阅读 13 个实现/类型文件、协议文档和 package.json，以及 4 个测试文件，共 19 文件、6014 行；清单见第 8 节。本次没有安装依赖或执行上游测试，测试源码只证明其断言范围。

官方协议文档自己明确区分“线格式”“客户端行为”“集成建议”：可选字段不证明服务端允许省略，类型字段不代表功能已实现，示例不是已经验证的最小请求。因此下文的 API 契约是**供隔离探针验证的最小候选调用集**，不是完整服务端承诺。[协议说明 7–19][protocol-scope]

## 2. 已可由源码确定的调用契约

### 2.1 公共请求字段

二维码从 `https://ilinkai.weixin.qq.com` 发起；一般 API 使用账号登录结果保存的 `baseurl`，缺失时官方客户端回退默认地址。普通 JSON API 是 HTTPS POST，扫码状态为 GET。[地址与传输][protocol-transport]、[账号解析 374–400][account-resolution]

| 字段 | 此固定版本发送的值/来源 | 自研探针处理 |
|---|---|---|
| `iLink-App-Id` | `bot` | 记录所用兼容标识 |
| `iLink-App-ClientVersion` | 版本 `major<<16 \| minor<<8 \| patch` 的十进制；2.4.10 为 `132106` | 如对齐此客户端，用该值并记入证据；不能假定任意版本值都被服务端接受 |
| `Content-Type` | JSON POST 为 `application/json` | 与真实 JSON body 一致 |
| `AuthorizationType` | JSON POST 为 `ilink_bot_token` | QR POST 也带此字段 |
| `Authorization` | 已登录 API 为 `Bearer <bot_token>` | QR 申请/状态不发送 bot token |
| `X-WECHAT-UIN` | 随机 uint32 → 十进制字符串 → UTF-8 base64 | 是客户端随机请求字段，不能当主人微信身份 |
| `SKRouteTag` | 可选配置路由标签 | 未指定不猜测、不读取其他实例配置 |
| `base_info.channel_version` | 当前客户端包版本 `2.4.10` | 对齐探针明确记录兼容版本；不要照抄文档示例的 `2.4.8` |
| `base_info.bot_agent` | 默认 `OpenClaw`，可配置 ASCII `Name/Version`，清洗后最多 256 字节 | 可自声明 `24PAProtocolProbe/0.1`；文档明确它用于观察，不是认证或路由凭据 |

QR 状态 GET 只有应用头及可选路由标签，没有 POST 的 `AuthorizationType`、UIN 或 Bearer。QR POST 没有 `base_info`。其余 bot POST 的 body 均加 `base_info`。[头与版本构造 89–107、202–254][api-headers]、[协议头差异 34–65][protocol-headers]

### 2.2 二维码与身份

| 操作 | 请求 | 响应/状态 |
|---|---|---|
| 获取二维码 | `POST /ilink/bot/get_bot_qrcode?bot_type=3`；JSON `{"local_token_list":[]}` | `qrcode` 用于后续轮询，`qrcode_img_content` 用于显示二维码 |
| 等待扫码 | `GET /ilink/bot/get_qrcode_status?qrcode=<编码后的 qrcode>` | `wait`、`scaned`、`confirmed`、`expired` 等 |
| 输入必要验证码 | 上一 GET 增加 `verify_code=<编码后的本人输入>` | `need_verifycode` 要求输入；`verify_code_blocked` 表示需停止或刷新 |
| 登录完成 | `status: confirmed` | `bot_token`、`ilink_bot_id`、`ilink_user_id`、`baseurl`；除 status 外这些字段在客户端类型中可选 |
| 服务端区域跳转 | `scaned_but_redirect` + `redirect_host` | 客户端改用 `https://<redirect_host>` 继续状态轮询 |
| 已绑定 | `binded_redirect` | 客户端视为“此前已连接”，不取得新凭据；不是一个可凭空建立的新24私助绑定 |

官方新装没有本地账号时发送空 `local_token_list`；有账号时会读取并发送最多最近 10 个本地 bot token。隔离探针使用空列表，不借用或枚举已有实例凭据。[QR 请求与类型 31–105][qr-request]、[状态处理 323–475][qr-status]

官方 QR 函数对 `confirmed` 只强制检查 bot ID，外层保存还要求 bot token；扫码主人 ID 则仍可缺失。当前旧账号兼容授权在 allowFrom 为空时允许普通消息。**24私助不能继承这个宽松条件**：登录只产生候选身份；必须取得可核验的扫码主人、机器人账号及后续来信对应关系，再由主人启用。缺主人证据时不以第一条来信、昵称或模型猜测认主。[完成条件 450–475][qr-confirm]、[保存条件 442–459][channel-save]、[旧账号授权 19–22][authorization]

原始 `ilink_bot_id` 是平台身份，OpenClaw 的 `normalizeAccountId` 是本地文件/配置键；不能将两者混为一个平台 ID，也不能反向替换主人 ID。24私助应保留原值，以独立内部键和持久绑定代次管理状态。[账号保存 442–451][channel-save]、[兼容键说明 20–33][account-id]

客户端 QR 单次状态请求超时为 35 秒、活跃二维码本地时限为 5 分钟、等待默认 480 秒、刷新计数上限为 3；这些是客户端策略，不是服务端二维码有效期保证。取消、刷新、跳转后的旧请求应受探针自身代次约束；新地址须先验证 HTTPS 与目标主机再发送凭据，不能接受不受控地址拼接。[QR 常量][qr-request]、[QR 等待 285–323][qr-wait]

### 2.3 收信与游标

```json
{
  "get_updates_buf": "<上次已持久接纳批次的游标；首次为空串>",
  "base_info": { "channel_version": "2.4.10", "bot_agent": "24PAProtocolProbe/0.1" }
}
```

请求路径为 `POST /ilink/bot/getupdates`。响应包含可选 `ret`、`errcode`、`errmsg`、`msgs`、`get_updates_buf`、`longpolling_timeout_ms`。当前构造器只发送 `get_updates_buf`；废弃 `sync_buf` 仍在类型中，但当前监控循环不把它当响应回退。正的服务端 timeout 值被用于下一次轮询。[请求与超时处理 438–487][api-getupdates]、[响应类型 211–232][types-updates]、[监控循环 94–155][monitor-errors]

必须无损保留 `message_id`、item 的 `msg_id`、引用的 `svr_id`。线上可能使用 uint64 JSON 数字，先 `JSON.parse` 成 JavaScript number 再转字符串已经太晚。当前源码在解析前将这些数字词法转换为字符串；单测覆盖 `18446744073709551615`。协议文档的表格还写 `message_id: number`，这里以当前代码与测试为准。[无损解析 518–576][api-lossless]、[类型 147–208][types-message]、[无损测试 194–254][api-id-tests]

入站需记录 transport 账号、原始 `from_user_id`、可选 `to_user_id/session_id/group_id`、消息类型/状态、消息/项目 ID、正文以及清洁后的引用关系。官方入站 helper 优先取顶层 message ID，再取首个项目 ID；同时另生成一个随机的本地 `MessageSid`。**随机 SID 不是平台去重键**；首版要求的可靠 ID、私聊/最终消息形态及扫码主人映射，必须由本人账号样本核验。缺可靠 ID 的消息隔离留证，不按正文哈希或临时 UUID 冒充去重。[入站 ID 202–209、250–272][inbound-id]

官方 monitor 在处理本批消息前就保存新游标；它不能作为24私助“先耐久接纳/拒绝再推进游标”的实现依据。自研保持旧游标直到清洁信封及逐项准入结果已耐久保存；有界轮询失败仍使用该游标，重投由可靠消息 ID 去重。服务端旧游标可重读多久、断点/空游标是否跳过历史、同时两个消费者如何处理，源码无法证明。[官方保存顺序 152–182][monitor-order]、[游标文件实现 32–81][sync]

### 2.4 文字发送与上下文

候选请求为 `POST /ilink/bot/sendmessage`，采用已核验账号的 Bearer token：

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<已核验的本人平台 ID>",
    "client_id": "<本条出站在派发前固定的本地请求标识>",
    "message_type": 2,
    "message_state": 2,
    "context_token": "<同账号、主人、会话和绑定代次的上下文>",
    "item_list": [{ "type": 1, "text_item": { "text": "<明确标注的测试文本>" } }]
  },
  "base_info": { "channel_version": "2.4.10", "bot_agent": "24PAProtocolProbe/0.1" }
}
```

`run_id` 可在调用方提供时加入，最小文字探针不依赖它。当前文字 builder 一条请求包含一个 TEXT 项；`sendMessageWeixin` 每次调用生成新 client ID，返回的 `messageId` 正是此本地 ID，`serverMessageId` 才对应可选的 `response.message_id`。24私助自研应先保存自己的请求标识与原目标，不能把 helper 的返回名直接映射为平台回执。[文字构造 52–79][send-builder]、[发送返回 103–137][send-result]

`context_token` 来自入站，官方按 account+user 更新最新值并写盘，启动时恢复；直接回复使用当前入站的 token，独立出站工具从同账号/用户的缓存读取。类型没有有效期、可用次数或主动发送许可字段。[token 存储 17–128][token-store]、[采用入站 token 291–306][process-token]、[独立出站读取 267–279][channel-outbound]

无 token 时官方 helper 只记警告仍发送，但文档明确这不能证明服务端接受。首版 A 先验证有真实入站 token 的即时及实际延迟发送；不能从这两个成功样本推导任意时刻可发。Outbox 固定目标，发送时只在同绑定中解析最新 token 引用；token 不写入业务信封/普通日志/研究报告。[缺 token 边界][protocol-context]

官方渠道声明只支持 `direct`，`group_id` 的类型存在不能证明群功能；`textChunkLimit: 4000` 是客户端交给宿主的分段设置，不是服务端已验证的字符/字节限制。首版探针先用短纯文本，不据此承诺 4000 中文字或任意长文。[direct 与分段设置 229–279][channel-outbound]、[类型边界说明][protocol-message]

### 2.5 不属于最小文字路径的接口

官方另有 `getconfig`/`sendtyping`、CDN 上传下载及 `notifystart`/`notifystop`。渠道启动/停止会 best-effort 调用后两个；失败只记录警告，不等于账号认证或收发成功。探针应记录是否调用，不能宣称服务端一定允许省略，也不能以通知成功替代 Gate A。typing 与媒体不是首版 A 的必要产品能力。[API 598–662][api-aux]、[生命周期 519–575][channel-lifecycle]

## 3. 成功、拒绝、未发送和 unknown 的判定

以下是适合24私助的保守探针判据；其中更严格的输入校验和持久证据要求是本产品设计，不能反过来声称官方客户端已实现。

| 观察 | 应记录的事实 | 后续动作 |
|---|---|---|
| HTTP 2xx、完整合法对象、明确数值 `ret:0`，且无矛盾业务错误 | 平台接纳响应及可选原生消息号；本地 ID 另存 | 落账即可，不要求原生号必填；仍不等于设备送达/已读 |
| 响应没有 ret，仅 `{}`、未知形态或矛盾错误字段 | 当前协议解释不足，保留脱敏形状与原请求关联 | 不照搬客户端宽松成功；unknown，待本人核对/明确协议证据 |
| 有已核验的非零业务错误码 | 平台报告拒绝及具体码 | 只对已证明“未发送且可重试”的码开放有界补试；其他码不自动重发 |
| 已派发后的超时、连接中断、HTTP 5xx、截断/解析失败、响应丢失 | 是否已接纳未知 | unknown；不得仅换 client ID 或沿原 client ID 自动重发 |
| 明确在任何网络派发前被本地归属/参数/授权校验拒绝 | 本次未发送 | 修复后按原目标、原出站明确重试；不伪造平台失败回执 |
| 已读到接纳响应，随后本地保存失败 | 外部已接纳，本地账本未完成 | 仅补账，不重新发送；探针将最小脱敏回执保留在独立恢复证据中 |
| 本人在原测试会话核对唯一测试编号，确认已收到 | 人工核对事实、时间与原出站 | 记为本人确认依据；无原生号也可记录，不编造平台号或 ret 值 |

官方 `sendMessage` 只在非零 ret 时抛错，缺 ret 会返回成功，单测还显式断言 `{}` 成功。这是客户端行为证据，不是服务端省略 ret 的普遍成功保证。[发送响应 579–596][api-send]、[空响应/错误测试 182–214][api-send-tests]

网络错误分类只用于诊断。官方将 `UND_ERR_SOCKET` 等归入 tls 类，不能据此断定请求尚未发出；单纯看到 DNS/TCP/TLS 名称也不能替代传输阶段证据。HTTP 状态与业务码分开记录，通用 4xx/5xx 不能统一当可重试未发送。发送 wrapper 没有自动重试，且已读公开客户端未提供按 client ID 查询发送结果的 API；未知结果不能借未证实的服务端幂等消除。[网络分类 256–304][api-network]、[HTTP 传输 389–436][api-post]、[公开端点表][protocol-endpoints]

getupdates 的超时是读侧控制流：官方会合成 `ret:0,msgs:[]` 并保留原游标，取消则交由监控退出。自研应保留“真实成功响应/本地超时/主动取消”的区别，不能用合成成功刷新“最近真实收信/连接已验证”。发送超时不使用这条空成功规则。[轮询超时 472–483][api-getupdates]

`-14` 是源码明确识别的 bot session 失效码（检查 ret 或 errcode）；官方暂停该账号一小时。普通轮询错误前两次间隔 2 秒，连续第三次等待 30 秒。这些是客户端退避策略，不是服务端 token 有效期、发送额度或自动恢复承诺；探针应准确记为失效/受限并停止依赖该凭据的业务探测。[监控错误分支][monitor-errors]、[session guard][session-guard]

## 4. Gate A 的最小真实账号检查清单

本表是待执行计划，当前各项均未验证。使用主人明确用于测试的 ClawBot 私聊与独立状态目录；不导入生产账号，不读取其他插件凭据，不启动24私助业务 Worker，不向其他联系人发送。使用新的测试编号区分消息，不把内容相同当重复身份。

| 检查点 | 本人账号需观察的过程 | 必须留下的脱敏证据 |
|---|---|---|
| A1 二维码与候选身份 | 主人主动申请并扫码；如需验证码由本人输入；取得 bot、扫码主人及 API 地址 | 版本、时间、状态序列、字段是否存在、不可反推出凭据的账号标识；缺身份证据不启用 |
| A2 入站身份/正文/消息号 | 本人发带探针编号的短文字；核对 from 与扫码主人，核对账号及实际 to/session/type/state/item 形态 | 精确保留的原消息 ID、正文校验值、清洁信封、token 是否存在、同批 msgs 与 cursor 的形状 |
| A3 游标与去重观测 | 先保存清洁消息再保存游标；停启后用保存的游标继续；必要时在同一测试账号观察原游标重读 | 每次请求使用的游标摘要、响应游标摘要、原消息号是否重现；不要并开两个消费者验证 |
| A4 一次即时文字回复 | 只向 A2 的已核验本人回一条“24私助协议测试”及唯一编号 | 派发前固定 client ID、HTTP/业务返回形态、平台接纳与可选原生号；本人端该编号可见的核对 |
| A5 一次实际延迟回复 | 保存 context/游标，停止并恢复探针；在没有新来信的一个明示间隔后，仅发送一次延迟测试结果 | 实际间隔、最近来信时刻、有无新 token、账号/主人相同、发送响应及本人可见核对；例如实测 60–120 秒只证明该间隔 |
| A6 停止与留证 | 结束后停止消费/发送；保留清洁证据和受保护的必要状态 | 无第二消费者；报告无 QR、验证码、bot/context token；每次出站能对应唯一请求与结论 |

A3 若未实际观察到服务端重投，须写“本次没有观察到”，不能把离线重放称为服务端重投证据。可靠 ID 的样本、游标恢复行为与本地去重机制分别描述；不能用一个成功周期证明无限历史保留或端到端恰好一次。[官方游标与消息模型依据][types-updates]

超时后不重发、缺字段隔离、重复信封、迟到响应、保存失败和崩溃窗口，先用离线传输替身检查分类与记录，不为制造 unknown 在本人账号反复发消息。真实 A 只验证必要的登录、入站、即时回复和延迟回复；完整 SQLite/PG/Loader、Outbox、业务授权与恢复验收仍属 #279 后续实现，不能被此探针替代。

若 A1–A5 的关键身份、可靠消息标识、响应判据或延迟条件仍不明确，记录具体未决点，Gate A 保持未通过/未验证。本人确认收到可提供人工证据，但不能凭此把未知响应格式提升成普遍成功契约。A 通过后才进入正式 F53/F54 集成；通过不代表 #279 已可关闭。

## 5. 仍需账号探针或进一步官方依据的问题

| 未决问题 | 为什么源码不够 | 对首版/后续的处理 |
|---|---|---|
| 实际 QR 是否总返回扫码主人、返回地址/账号形态 | 类型可选；官方兼容路径允许缺 owner | A 的身份门槛；缺失不自动认主 |
| message ID 是否稳定、在哪一层、哪些消息状态会出现 | 类型与 parser 只能描述可接受格式 | A 实测，缺可靠 ID 不能业务准入 |
| 游标重读、保存期限、空串重置与并发消费者行为 | 客户端只保存 opaque cursor，无完整服务端说明 | A 记录实际观察；自研仍做持久去重和单消费者 |
| 成功是否可能省略 ret、是否有原生号 | 当前发送类型可选，客户端接受空对象 | 按观察冻结可解释响应；无依据保守 unknown |
| context token 有效期/轮换/旧 token 是否仍可用 | 本地缓存没有 TTL，发送缺 token 也会尝试 | A 仅声明所测延迟；其他条件留 B |
| 无近期来信/无 token/长期计划主动发是否可用 | 代码存在发送路径不等于服务端许可 | B；不写死“24 小时/10 条”或无限可发 |
| 同 client ID 重发是否服务端幂等、是否有查询接口 | 没有公开客户端实现或契约证明 | 不测试性重发去碰运气；unknown 先人工核对 |
| 文本实际长度、中文/emoji 计量、分段顺序限制 | 4000 只是客户端配置 | A 使用短文本；长文本在 F53 专项验证 |
| 账号续期/重绑是否保留 bot ID、原凭据何时失效 | QR 成功和本地清理不能证明外部授权可回滚 | 绑定代次按已定产品规则；真实切换另留证据 |
| typing/start/stop 的失败是否影响真实投递 | 客户端按 best-effort 处理 | 不拿这些调用的成功替代收发验证 |

群、媒体、微信语音、联系人/朋友圈/全聊天历史均不属于此次文字探针，不因上游类型或 README 项目存在而宣称可用。通知结论 B 可为“未验证”并明确范围，不能阻止 A 范围内完成首版，但不能据此开放 F55。

## 6. 源码中不能直接照搬的行为

1. **收件顺序**：上游先存 cursor 再处理消息；24私助先耐久记录逐项接纳/拒绝。不是假定已观察到上游生产丢消息，而是二者的恢复契约不同。[监控保存顺序][monitor-order]
2. **身份宽松兼容**：旧账号 allowFrom 为空可收普通消息；24私助缺主人证据必须拒绝。已有账号清理还会按同 userId 删除旧账号数据，不能替代24私助未决工作/未知投递结清流程。[兼容授权][authorization]、[旧账号清理 83–109][account-cleanup]
3. **凭据与日志**：QR 状态函数直接 debug 前 200 字符响应、二维码流程输出完整链接；token cache 为普通 JSON 文件。24私助探针先提取凭据到专用受保护存储，再生成清洁信封/日志；不能将这些调试输出接进业务日志或报告。[QR 状态日志 128–157][qr-poll]、[token 持久化 41–80][token-store]
4. **HTTP 超时**：上游 wrapper 在取得响应对象后清除计时器，随后才读 body；自研应将读取完整响应纳入同一有界截止时间。超时不改变发送 unknown 判定。[POST 413–425][api-post]
5. **客户端成功返回**：本地 ID、空 ret 宽松判断、缓存写失败只告警，均不能替代24私助持久平台接纳证据；状态字段必须按实际观察分别保存。[文字返回][send-result]、[发送 API][api-send]
6. **上下文缓存**：上游 account+user 缓存可作接口参考，但没有24私助的工作区/会话/持久代次；发送目标不得由“当前仅一个账号”或“哪个账号恰好有 token”推断。[账号推断 69–116][channel-account]、[token store][token-store]

## 7. 探针记录建议

报告记录：源码 commit、探针版本、观察时间/间隔、协议字段形状、脱敏账号标识、请求关联、清洁消息 ID、文本校验值、HTTP 状态、明确的 ret/errcode、是否有原生号、接纳/未知/本人确认三类证据、游标与 token 的存在/变化事实。凭据不属于研究证据正文。

记录“已登录”“有真实入站”“平台接纳响应”“本人确认可见”“测试结束”五个独立事实。不要用 HTTP 200、轮询进程存活、notifyStart 成功或本地 client ID 填充其余状态。未知结果保留原出站关联；本人确认不生成假的平台消息号。

本研究已经给出离线准备所需的请求结构和判据，尚未满足 A 的真实账号证据。下一步是主审在已授权隔离范围内执行该探针，补充可复现记录，再判断是否进入正式集成。

## 8. 完整阅读清单

| 文件 | 原文件行数 | 关注内容 |
|---|---:|---|
| src/auth/login-qr.ts | 497 | QR 请求、验证码/跳转、候选身份、超时与返回条件 |
| src/api/api.ts | 662 | 头、版本、GET/POST、取消/超时、无损 ID、业务码 |
| src/api/types.ts | 293 | 消息、回复、游标、context 与回执类型 |
| src/monitor/monitor.ts | 224 | getupdates 循环、游标时序、错误退避和退出 |
| src/messaging/send.ts | 404 | 文字构造、client/server ID、上下文和发送结果 |
| src/messaging/inbound.ts | 408 | token 缓存、平台/本地 ID、引用隔离 |
| src/auth/accounts.ts | 400 | 原始/内部账号 ID、凭据保存、旧账号清理 |
| src/storage/sync-buf.ts | 81 | 游标路径、旧格式回退与持久化 |
| src/api/session-guard.ts | 58 | -14 与一小时客户端暂停 |
| src/messaging/authorization.ts | 42 | owner/allowFrom 及旧账号兼容 |
| src/auth/pairing.ts | 62 | allowFrom 的存储边界 |
| src/messaging/process-message.ts | 595 | 实际授权/会话/上下文采用及回复链路 |
| src/channel.ts | 633 | direct 能力、分段、独立发送、登录保存及启停 |
| docs/protocol.md | 490 | 线格式与服务端契约的明确区分 |
| package.json | 74 | 2.4.10、bot app ID 与运行时依赖声明 |
| src/api/api.test.ts | 565 | 替身下的 HTTP/ret/无损 ID/取消行为 |
| src/messaging/send.test.ts | 385 | client/server ID 分离及缺 context 的客户端行为 |
| src/messaging/context-token-store.test.ts | 35 | account+user 隔离与覆盖 |
| src/storage/sync-buf.test.ts | 106 | 游标读写与兼容回退 |
| **合计** | **6014** | **19 个文件；只读，未执行** |

[commit]: https://github.com/Tencent/openclaw-weixin/commit/874637a0dbc24050f72d1385add4fc6170a2d726
[compare]: https://github.com/Tencent/openclaw-weixin/compare/874637a0dbc24050f72d1385add4fc6170a2d726...874637a0dbc24050f72d1385add4fc6170a2d726
[package]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/package.json#L1-L74
[protocol-scope]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L7-L19
[protocol-transport]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L21-L30
[protocol-headers]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L34-L65
[protocol-endpoints]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L152-L164
[protocol-context]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L248
[protocol-message]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol.md#L380-L402
[api-headers]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L89-L254
[api-network]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L256-L304
[api-post]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L389-L436
[api-getupdates]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L438-L487
[api-lossless]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L518-L576
[api-send]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L579-L596
[api-aux]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts#L598-L662
[api-send-tests]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.test.ts#L182-L214
[api-id-tests]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.test.ts#L194-L254
[qr-request]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/login-qr.ts#L31-L105
[qr-poll]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/login-qr.ts#L128-L157
[qr-wait]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/login-qr.ts#L285-L323
[qr-status]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/login-qr.ts#L323-L475
[qr-confirm]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/login-qr.ts#L450-L475
[account-id]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/accounts.ts#L20-L33
[account-cleanup]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/accounts.ts#L83-L109
[account-resolution]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/auth/accounts.ts#L374-L400
[authorization]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/authorization.ts#L19-L42
[types-message]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/types.ts#L147-L208
[types-updates]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/types.ts#L211-L232
[monitor-errors]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/monitor/monitor.ts#L94-L155
[monitor-order]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/monitor/monitor.ts#L152-L182
[sync]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/storage/sync-buf.ts#L32-L81
[session-guard]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/session-guard.ts#L3-L48
[inbound-id]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts#L202-L272
[token-store]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts#L17-L128
[process-token]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/process-message.ts#L291-L306
[send-builder]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.ts#L52-L79
[send-result]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/send.ts#L103-L137
[channel-account]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L69-L116
[channel-outbound]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L229-L279
[channel-save]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L442-L459
[channel-lifecycle]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/channel.ts#L519-L575
