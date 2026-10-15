# F18 研究：QwenNote 听记接入（钉talk 录音卡 · dsh-mcp-client 通道）

日期：2026-10-07（2026-10-12 二次调研更新：OAuth 真机结论回填、WP1/WP2 交付后的剩余面规划、诊断观测面核验）。研究先于实现完成；本文记录来源、已核验事实与取舍。背景：用户提出「在24PA 直接使用钉talk（QwenNote A2）录音卡」，并确认先完善设计与工单、开发后置。本文分两类陈述：**已核验**（有源码/官方页面证据）与**真机待验**（需授权后实测回填）。

## 一、需求定位与规格约束

1. 用户需求：主人的 QwenNote A2 录音卡产生的听记（会议转写、纪要、速记），成为24私助可直接读取的资料来源——本地24私助会话可查听记、取纪要，并把其中行动按既有「候选行动 → 行动授权」流程提炼（对齐 F06/F10 术语体系）。
2. 规格定位：规格 1.7 新增（用户 2026-10-07 提出，用户故事 125）；本票 F18 / P50，单票单 PR。
3. 边界沿用 ADR-0001 与「标准模式完整编程能力」的口径：听记工具仅对**本地24私助会话**（local-robot 角色）开放；飞书入口会话与 Worker 不放行（MCP 凭据为机器级，听记含敏感内容）。

## 二、服务本体（来源与版本，已核验）

- **硬件**：钉talk 录音卡＝钉钉 2025 年 DingTalk A1，2026-09 云栖大会升级为 **QwenNote A2**（千问办公生态，钉钉科技有限公司，售价 1199 元；67g、6 麦克风、4G 独立联网、「转后即焚」——转写完成后原始音频物理删除，仅保留文字与纪要）。官网 qwennote.cn，帮助中心 docs.qwennote.cn。
- **云端**：录音卡同步到钉钉「AI听记」（官方接入页 n.dingtalk.com「AI听记 · 连接你的AI工具」，JS 渲染 SPA）；速记 API 域 `minutes.qwennote.cn`。
- **MCP 端点**：`https://minutes.qwennote.cn/mcp`。已观测：未认证请求返回 **401**（OAuth 保护）；根路径与 `/.well-known/oauth-protected-resource`（含路径插入变体）均 404，公开渠道**无工具文档**。官方接入页提供逐客户端接入话术（用户转述的连接指令即来自该页）。
- **结论**：工具清单、参数、配额、token 形态均**以授权后 `tools/list` 实测为准**，见「五、真机待验」。

## 三、dsh 侧契约（源码核验，2026-10-07）

**dsh harness 内建 MCP 客户端，24PA 无需自研。** 核验位置：npm 全局包 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh@0.2.1-alpha.1`（含 `dsh-mcp-client`/`dsh-mcp-resources` 编译产物与 `@modelcontextprotocol` SDK）；源码 checkout `/tmp/dsh-baseline/packages/mcp/`（0.2.1-alpha.1）；`~/DSH-Space/dsh-rc2`（0.2.0-rc.2）同构。24PA 所用两基线版本均随包发布。

**接入方式**：profile 的 `cordis.patch.yml` 追加条目（README 官方示例同款）：

```yaml
- id: mcp-qwennote
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: qwennote          # 工具名前缀 → mcp__qwennote__<rawName>
    transport: stdio
    command: npx
    args: ['-y', 'mcp-remote@<锁版本>', 'https://minutes.qwennote.cn/mcp']
```

**Config schema 要点**（`mcp-client/src/index.ts:119-142`，schemastery union）：

| 项 | stdio | streamable-http |
|---|---|---|
| 必填 | `command`/`args` | `url`/`headers`（默认 `{}`） |
| 可选 | `env`/`cwd` | — |
| 公共 | `serverName`（`[A-Za-z0-9_-]{1,32}`，全局唯一）、`toolCallTimeoutMs`（默认 60s）、`failOnStartupError`（默认 false）、`maxInstructionBytes`（默认 32KiB）、`reconnect{enabled,initialDelayMs,maxDelayMs,maxAttempts}` | 同左 |

**关键行为**：

- 工具以 `mcp__<serverName>__<rawName>` 注册进 `ctx.tools`（超 64 字符或非法字符附 12 位 SHA-256 后缀）；服务器工具列表变更整代换/整代回滚；激活前完成首次连接＋工具同步。
- **streamable-http 仅静态 headers，无 OAuth 交互流程**——OAuth 保护的远程 MCP 必须经 stdio 子进程桥接。
- stdio 子进程环境做密钥清洗：丢弃匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*` 的宿主环境变量后合并配置 `env`（密钥只能走 config.env，不能进 command/url）。
- `dsh-mcp-resources`（list/read resource 三工具）随 `dsh-base` bundle 常驻，配置任意 mcp-client 条目后自动出现；`serverName` 冲突在加载期抛错。
- 与 24PA 白名单的交互：`tools.restrict()`（agent scope）拒绝 allow 名单中不存在的工具名——`packages/24pa/src/tools.ts:59` 将 `extraLocalTools` 原样并入 allow，**无存在性过滤**；provider 委派工具（subagent_codex 等）靠「provider 已装＋配置显式点名」两层条件避免炸裂（README 已述）。mcp__qwennote__* 引入同样的两层条件。

## 四、设计取舍

1. **通道＝harness 原生 mcp-client ＋ mcp-remote OAuth 桥**，不自研 MCP 客户端、不引新依赖进 packages/24pa。`mcp-remote`（npm 社区标准 OAuth 桥）以 stdio 子进程运行：首次授权自动打开浏览器（本地回调），token 缓存 `~/.mcp-auth` 并自动续期，实例重启免登录。**版本锁定**（args 写死具体版本号）而非 `-y` 拉最新，控供应链风险；候选升级路径是 profile 内 vendored 安装。
2. **备选通道**：若实测 QwenNote 支持长效静态 token（如 PAT 页面或长寿命 access token），可改 `streamable-http` + `headers`，省一层子进程；以实测为准，本票不预设。
3. **放行走 `extraLocalTools`**（复用既有字段，语义由「provider 级外部 CLI 委派工具」扩展为「本地会话显式放行的额外已注册工具名」），GLOSSARY 词条同步改写；不新增平行字段。**附带设计决策**：extras 并入 allow 前按 agent scope 已注册工具做存在性过滤，消除「列了 mcp__qwennote__* 但 profile 未配 mcp-client → restrict() 抛错」的炸裂路径（对 subagent_* 同样受益）；实现属本票，行为变化写入测试。
4. **角色范围仅 local-robot**：机器级凭据＋听记敏感内容，飞书入口与 Worker 首版不放行；后续有真实需求再按域评估（同 F13 的边界哲学）。
5. **教学层进 `src/prompts.ts`**（F14 单一来源）：业务域节补「听记资料」规则——主人提及录音卡/听记/速记/会议纪要时查 `mcp__qwennote__*`；引用听记内容须带来源（听记标题/时间）；行动提炼走既有候选行动→审核→行动授权流程，不因来源是听记而跳过确认。工具 description 由 MCP server 自带，插件不重复包装。
6. **接入向导**：`初始化指南`新增「听记接入」节（patch 条目、首次授权由本人浏览器完成、诊断三态：未配置/未授权或过期/正常）；是否升级为随插件分发的 `minutes-setup.md` + `pa24_connection` 三件套（仿 F15/F16），实施时按篇幅裁决。
7. **存储零改动**：听记是按需读取的外部资料，不落 PG 投影（无同步账本、无迁移）；候选行动一旦创建即走既有事项/审核数据流，与来源解耦。

## 五、未决 / 真机待验（本票第一步实测后回填本文）

### 2026-10-12 终报：WP0 真机打通完成（ali 生产实例）

- **授权成功路径（踩坑后定稿）**：宿主反复重连会把 mcp-remote 堆成多实例（曾达 3 个）——多实例抢 8905 时，回调实例换到的 token 会被服务实例的连接竞争拒绝（`Unauthorized`），且 dsh-mcp-client spawn 时吞掉 mcp-remote 的 stderr（systemd journal 与 nohup 日志均拿不到授权 URL）。**可靠方案＝独立授权进程**：清全部实例后手动 `setsid nohup …/mcp-remote https://minutes.qwennote.cn/mcp`（HOME 指向实例 home，stderr 落文件）——单实例打 URL、用户浏览器经 SSH 隧道 `-L 8905` 完成授权、token 落共享缓存后进程自退；随后 systemd 重启宿主，新 mcp-remote 读缓存 token 直连成功（`Proxy established`，journal 可见）。
- **结果**：本地24私助会话创建后 `extra-local-tools` 快照显示**通配展开放行 16 项**（16 个 `mcp__qwennote__*` 工具挂载且全部进入 allow）——通道、放行、教学三层全部生效。ali 实例已恢复 systemd（pa24.service）常态。
- **工具明细已盘点**（2026-10-12，独立进程 tools/list 实测，16 个）——**只读 11**：`list_my_minutes`（跨来源最近听记列表）、`get_minutes_basic_info`（标题/时长等）、`get_minutes_transcription`（逐段转写）、`get_minutes_ai_summary`（AI 全文纪要 Markdown）、`get_minutes_keywords`（AI 关键词）、`batch_get_minutes_details`（批量基本信息）、`list_minutes_by_tag`/`list_minutes_tags`（按标签）、`list_minutes_todos`（AI 提炼的待办）、`get_minutes_media_url`（限时音视频直链）、`list_hot_words`（热词与配额）；**写 5**：`add_personal_hot_word`、`replace_minutes_text`（全文查找替换，改转写）、`replace_speaker`（改说话人归属）、`update_minutes_summary`（覆写纪要）、`update_minutes_title`（改标题）。**边界裁定**：extraLocalTools 放行通配则写工具同样进入本地会话工具面——按「本地24私助会话＝主人本人操作面（ADR-0001 标准编程能力口径）」放行不做工具级裁剪，但听记教学的提示词规则明确「修改类操作须主人明确指令」（prompts.ts「### 听记资料」节已有「行动走既有确认」约束）；配额与 token 寿命待长稳观察。

### 2026-10-12 更新：OAuth 形态已真机核验（ali 生产实例，WP0 首轮）

- **动态客户端注册**：`minutes.qwennote.cn/mcp` 走 OAuth 2.0 动态注册，实测获得 `client_id: qnmcp-fa7cef0f8e814761ba9a7699f1f3e094`；授权请求带 **PKCE S256 ＋ state ＋ resource 参数**——授权 URL 只能用 mcp-remote 发起的那一条（手工重构缺 state 会被拒），且轮换周期约 4–5 分钟；
- **回调端口**：本地回调 `http://127.0.0.1:8905/callback`（端口由 server URL 推导）——意味着**宿主上必须由 mcp-remote 进程持有回调监听**，授权必须发生在「宿主已启动 mcp-client 条目、且由主人浏览器可达宿主」的场景（ali 实例经 magic-proxy 隧道不转发 localhost，需在宿主本机或 SSH 端口转发下完成）；
- **scopes**：`qwennote:read` / `qwennote:write`；**refresh_token 已签发**（`~/.mcp-auth/mcp-remote-v1/` 下 token 缓存实测存在）——过期自动续期预期成立，剩余寿命待长稳观察；
- 孤儿 mcp-remote 进程（ppid=1、持有 8905）会卡住重新授权，处置＝`pkill -f "npm-cache/_npx.*mcp-remote"` 后重启宿主；
- 授权完成后待办：`tools/list` 盘点（工具清单/参数/只读性/配额）、token 寿命观察、长稳断线重连表现——仍是「五」原有待验项。

### 2026-10-12 更新：诊断三态的观测面（源码核验 dsh-mcp-client）

WP3 诊断三态（未配置/未授权或失效/正常）的数据源核验（`@deepseek-ai/dsh-mcp-client` lib/index.js）：

- mcp-client **不向 registry/reflect 暴露任何服务**（export 仅 Config/apply/createMcpToolDefinition/inject/name）——插件侧无 `ctx.get('mcp-…')` 可查连接状态；连接世代/outage 是插件内部状态；
- 对 24PA 可观测的只有两处：①**宿主工具面**——`tools.schemas()` 中 `mcp__qwennote__*` 前缀的存在性（tools.ts 的存在性过滤已用同一数据源）；token 失效→重连失败→工具列表「整代回滚」→前缀消失；②systemPrompt 的 `mcp:<server>` instructions section（不适合做诊断源）；
- **三态设计**（WP3 实施）：`extraLocalTools` 配置（AGENTS.md）× 工具前缀存在性（tools.schemas()）× token 缓存文件存在性（`$DSH_HOME/.mcp-auth/mcp-remote-v1/` 目录探测，只看存在与 mtime，不读内容）三信号合成——配置在＋前缀在＝正常；配置在＋前缀无＋缓存无＝未授权（首次授权未完成）；配置在＋前缀无＋缓存有＝连接失败或 token 过期；配置无＋extraLocalTools 未配＝未配置（不出诊断项）。挂在既有 `extra-local-tools` health capability 上（WP1 已建）。

### 2026-10-12 更新：架构落点（F28–F33 之后）

WP1/WP2 已交付（PR #95，2026-10-10 合并）：`extraLocalTools` 通配/精确放行＋存在性过滤＋`resolveExtraLocalTools`＋`extra-local-tools` health capability＋听记教学（prompts.ts「### 听记资料」节）。剩余＝WP0 真机授权（上述）＋WP3 诊断三态（挂 health capability 扩展）＋WP4 指南「听记接入」节——初始化指南现为阶段 0–5＋飞书下一跳结构，听记节按「阶段 5 后的可选接入」并列（对齐 F16 企微接入的同款定位），不做 minutes-setup.md 三件套（2026-10-11 已裁决）。

---


- **OAuth 形态**：401 的 `WWW-Authenticate`/发现端点、授权服务器（预计钉钉登录页）、mcp-remote 兼容性——未实测（计划模式探测被权限拦截）。
- **工具面**：tools/list 清单、参数语义、只读还是有写工具（设计按只读定位，出现写工具则评估是否放行）。
- **token 生命周期**：access/refresh token 寿命；若不签发 refresh token，过期后需人工重授权——诊断 nextSteps 必须覆盖。
- **配额与会员**：A1 权益为每月 1000 分钟转写＋10GB；MCP 读取是否消耗/受限于配额未知。
- **数据边界**：「转后即焚」下 MCP 暴露的实体（预计仅转写文本/纪要/待办提炼，无音频）。
- dsh-mcp-client 与 mcp-remote 断线重连叠加行为（harness reconnect vs mcp-remote 自身重试）在长稳实例上的表现。

## 六、2026-10-15 调查终报：「宿主内工具未挂载」三因叠加与修复（#70 收尾）

**调查方法**：本地 checkout 加 [f18dbg] 补丁（syncTools/global-view/agent-view 三探针）完整复现＋ali 同款补丁实测，时间线铁证定位。

**三因叠加**：
1. **结构性时序竞态（主因）**：宿主启动即自动创建本地 agent（解析 extraLocalTools 时刻 mcp=0），而 mcp-remote 连接链（OAuth 发现→连接→tools/list→注册）需 30s+——**解析永远先于注册**，该 agent 生命周期内 qwennote 条目被过滤（journal 证据：`pa24-agent view: total=12 mcp=0` → `syncTools listed=16` → `global-view visible=16`）。本地复刻能成功只因新会话的 agent 创建晚于注册。
2. **WP3 mounted 信号选错 ctx**：runtime 插件 ctx 的 `tools.schemas()` 视图**看不到** mcp-client 注册层（dsh-scope 层级；本地实证：agent 解析 16 项时该探测仍 false）。
3. **token 异地轮换失效（放大器）**：本地成功连接后 refresh token 轮换写回本地缓存、旧 token 作废——ali 持旧 token 走 sign-in，授权 URL 被吞（部分 mcp-remote 实例 stderr→/dev/null）→ 持 8905 死等 → 多实例协调死锁后续实例；且宿主重启遗留孤儿 mcp-remote（上游 dispose 不杀子进程）使死锁常态化。10-12 的 13:47 唯一成功＝恰好清干净全部实例的窗口。

**修复（24pa 侧，PR fix/f18-mounted-signal）**：
- tools.ts：agent 解析前，配置了 qwennote 且未挂载时**有界等待**（2s×30 轮）注册完成再解析——结构性竞态消除；
- runtime.ts：mounted 信号改用 **agent 解析快照**（extraToolResolution.active 前缀匹配，同源可见）；无快照→info「未验证」；warn 态 nextSteps 补「重启后等通道正常再开会话」。

**ali 实测终态**：`extra-local-tools ok 放行 16 项` ＋ `qwennote-channel ok 听记通道正常`（还原 mcp-client 补丁后重启保持）。

**遗留上游问题**（deepseek-harness，待报）：① mcp-client dispose 不终止 mcp-remote 子进程（孤儿堆积）；② spawn 链 stderr 偶发 /dev/null（sign-in URL 不可见）；③ 多实例 sign-in 死锁无超时让位。运维兜底：宿主重启后如听记通道卡「连接失败」，清 `bin/mcp-remote` 进程后重启宿主。