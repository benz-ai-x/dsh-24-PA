# F18 研究：QwenNote 听记接入（钉talk 录音卡 · dsh-mcp-client 通道）

日期：2026-10-07。研究先于实现完成；本文记录来源、已核验事实与取舍。背景：用户提出「在24PA 直接使用钉talk（QwenNote A2）录音卡」，并确认先完善设计与工单、开发后置。本文分两类陈述：**已核验**（有源码/官方页面证据）与**真机待验**（需首次授权后实测回填）。

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

- **OAuth 形态**：401 的 `WWW-Authenticate`/发现端点、授权服务器（预计钉钉登录页）、mcp-remote 兼容性——未实测（计划模式探测被权限拦截）。
- **工具面**：tools/list 清单、参数语义、只读还是有写工具（设计按只读定位，出现写工具则评估是否放行）。
- **token 生命周期**：access/refresh token 寿命；若不签发 refresh token，过期后需人工重授权——诊断 nextSteps 必须覆盖。
- **配额与会员**：A1 权益为每月 1000 分钟转写＋10GB；MCP 读取是否消耗/受限于配额未知。
- **数据边界**：「转后即焚」下 MCP 暴露的实体（预计仅转写文本/纪要/待办提炼，无音频）。
- dsh-mcp-client 与 mcp-remote 断线重连叠加行为（harness reconnect vs mcp-remote 自身重试）在长稳实例上的表现。
