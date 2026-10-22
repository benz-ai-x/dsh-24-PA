# Manticore M01b：手工 Skill 运行研究

日期：2026-10-20。用途：为 #214 下一轮开发保留可核验基线；本轮只研究，不改产品源码、正式规格、TODO 或 Issue。本研究采用 research 与 codebase-design 技能。

## 结论与证据范围

M01a 的目录、详情和单文件导出可复用，不能直接把“面板调用现有 delegate”当作 M01b 的通用手工运行。现有 Worker 仅有业务工具，Skill Worker 甚至只注册了 `skill_run` 读取动作；本地完整编程能力属于本地顶层会话。两种执行路径必须分别兑现，不能给 Worker 增加 Shell 来消除差异。

最小方案是：由一个运行模块统一拥有版本、参数、授权、接纳、归因、恢复和运行记录，内部接入确定性模板、本地原生会话、业务 Worker 三种真实执行路径。包版本模块提供不可变定义及资源。现有 WorkItem、外部动作账本、Outbox 保持各自职责。

| 项目 | 本次固定值及限制 |
| --- | --- |
| 24PA 源码基线 | `91aff7c96a59cab2cf00fa2eaf379008079d55a2`，分支 `codex/manticore-skills`，已含 M01a / #225 |
| 宿主一手源码 | 本机官方 `deepseek-ai/deepseek-harness` checkout，commit `1600d8a1e140dcde43a1a0941940a0480712c011`；以下宿主契约均指这一固定版本 |
| 已读约束 | 根 AGENTS、product、domain、GLOSSARY、ADR-0001、SPEC §16、Manticore 产品定稿及实施计划 |
| 证据层级 | 先完成源码核查；用户继续开发后完成本文末节的 7 组真实 Loader/Session 隔离验证。平台和模型替身与真实宿主行为分别注明 |
| 兼容性限制 | 固定官方源码契约不等于当前已安装宿主完全同版；开发前需核对实际包版本、挂载工具及原生事件 |

规范依据：[产品定稿](../planning/24PA-Manticore-产品定稿.md)、[SPEC](../24PA-v1-SPEC.md)、[ADR-0001](../adr/0001-workspace-session-boundaries.md)。历史证据：[执行能力核查](2026-10-20-Manticore-Skill与执行能力核查.md)、[M01a 验收](2026-10-20-Manticore-M01a-实施验收.md)。这些材料不构成 M01b 已经实现的证明。

## 已有代码可复用到什么程度

下表的代码链接固定到 24PA 基线，避免后续实现改变行号后混淆结论。

| 对象 | 可复用能力 | M01b 必须补齐 |
| --- | --- | --- |
| SkillCatalog | 内置和工作区来源、agent/template 分类、拒绝 persona/setup 普通执行 | 当前 `resolve` 丢失资源定位，只保留正文和 metadata；没有不可变包、参数 schema 和完成契约。[skills.ts:388](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/skills.ts#L388) |
| M01a 管理模块 | 来源明确的 selection、身份、fingerprint、详情和导出 | 导出只含说明文本；不能以名字重新 resolve 替代用户选中的来源，尤其内置原版被同名工作区 Skill 覆盖时。[skill-management.ts:70](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/skill-management.ts#L70) |
| delegate | 原工作区校验、实际父会话、排队、Skill 正文快照、固定回传位置 | 每次新建随机 WorkItem；没有独立 Run、请求防重、参数和完成标准。Skill role 的 actions 只有 `skill_run`，不能据此执行任意已有业务动作。[runtime.ts:495](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L495)、[1667](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L1667) |
| Worker 启动与继续 | 通过原父会话启动或冷恢复；使用已保存正文 | 当前工具固定放行 `pa24_work`、`pa24_memory` 和角色工具；metadata.tools 只检查是否声明越权，并未缩窄工具面或 action。[runtime.ts:1755](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L1755)、[1827](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L1827) |
| 原回合结算 | 执行标识先落库、匹配原输入/原父子/代次、读持久会话，成功结算与 Outbox 同事务 | WorkItem.execution_id 会在继续时替换，是输入结算身份，不是完整产品运行历史；不得直接改名为 Run。[repo/work.ts:64](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/repo/work.ts#L64)、[work-completion.ts:55](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/work-completion.ts#L55) |
| Digest | 内置晨报等的确定性事实读取、渲染、回执 | `digestRunNow` 按已存在计划运行，并非任意 Skill 手工执行；会议准备/跟进等有各自管线，不能套同一个 renderer。[digest-service.ts:421](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/digest-service.ts#L421)、[533](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/digest-service.ts#L533) |
| 外部动作 | 原操作 pending/failed 才能认领；未知阻止重发；已得远端结果可只修本地投影 | 普通动作键含 WorkItem.id，换 WorkItem 能获得新动作键；目前只有候选行动有跨 WorkItem 的稳定授权身份，不能当作通用防重已完成。[external-operations.ts:15](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/external-operations.ts#L15)、[44](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/external-operations.ts#L44) |

## 本地手工能力与 Worker 的冲突应怎样解开

### 已核实的原生路径

本地 24PA 顶层会话已有标准编程工具、平台 Shell，并按配置追加 QwenNote 等工具；飞书和 Worker 仍按业务白名单运行。[local-tool-access.ts:4](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/local-tool-access.ts#L4)

面板可以通过真实的 `sessionController.resolveAgent(sessionId)` 取得本地顶层 Agent，再经 `sessionController.prompt({sessionId, requestId, mode:'queue', content})` 提交。服务端必须重新检查当前工作区、真实 Agent 身份和 `roleFor(agent) === 'local-robot'`；客户端传入一个 sessionId 不等于有资格使用该会话。现有 `openLocalSession()` 返回固定本地入口，不能把它描述成“当前浏览的会话”。当前面板只使用 `robot.open` 及导航；宿主 `UiWorkspace` 的公开 navigation interface 未提供“当前会话 ID”读取方法，若要“在当前会话运行”，需从受支持的会话 UI 上下文显式传入并验证。[runtime.ts:1211](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L1211)、[宿主 navigation.ts:38](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/client/ui-workspace/src/client/navigation.ts#L38)

`prompt` 回执只有 `{accepted:true}`，表示输入已接纳。requestId 被保存为用户消息的 `source.rpcId`；宿主会检查 pending inbox 和已消费消息来识别同 requestId。业务模块仍应持久化 requestId、序列化自己的提交并核对未知接纳结果，不能从这段代码推断任意并发/崩溃场景下无条件 exactly-once。[宿主 types.ts:344](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/api/session-controller/src/types.ts#L344)、[index.ts:462](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/api/session-controller/src/index.ts#L462)、[commands.ts:319](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/api/session-controller/src/commands.ts#L319)、[584](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/api/session-controller/src/commands.ts#L584)

原生 Skill 的最小真实入口是用户输入首行 `/<skill-name>`：`tool-skill` 在 `agent/pre-step` 检查用户来源，加载 user-invocable 的定义并注入带 `skill-invocation` 来源的说明和资源位置。模型也可经 `skill` 工具加载可模型调用的 Skill。这是加载说明后由当前 Agent 执行，不是独立的 Skill Run 引擎；普通注册表查找读取的是当时获胜定义。[宿主 tool-skill:128](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/tool-skill/src/index.ts#L128)、[165](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/tool-skill/src/index.ts#L165)

### 可实现的受控运行与尚缺的隔离验证

可以以“真实 Session＋持久 rpcId＋已消费输入＋turn/step”关联本地执行，以 `tools/pre-execute`、单调 `tools.guard`、工具结果及持久 Session events 记录动作。`ToolExecution` 有 agent、callId、rootCallId，**没有 SkillRun.id**；因此这些挂载点提供实现材料，并不自动提供每次 Skill 的隔离。[宿主 tools:327](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L327)、[1134](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1134)

两个具体约束不能漏掉：

1. 一个 step 会消费所有 next-step 输入，并在必要时额外取一个 next-turn 输入；用户 steer、系统注入或其他入口可能与 Skill 输入同轮。不能把该会话的所有后续工具调用或最后一条回复直接归给 Run。[宿主 inbox.ts:103](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/src/inbox.ts#L103)
2. 宿主先 assembly 工具 schema，才进入 pre-step。若到 pre-step 才装 restrict，首个模型请求的工具展示不一定已缩窄。限制和恢复闸门应在提交/恢复输入前就位，pre-step 用于确认本轮输入归属；逐调用 guard 仍必须存在。pre-step reject 会消费所认领输入，不能以 reject 代替保留输入的暂停。[宿主 agent.ts:267](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/src/agent.ts#L267)、[runtime-types.ts:309](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/runtime-types.ts#L309)

建议下一轮在以下两种形态中选择并实测，选择过程不改变已批准的本地能力：

- **复用用户选定的本地顶层会话**：运行期间建立持久占用关系；只接纳属于该 Run 的输入/继续，其他输入必须可恢复地等待或明确不被计入。验证并发 steer、旧 inbox、宿主重启和权限恢复。不能靠提示词要求模型“只做这次运行”。
- **明确展示的独立本地顶层运行会话**：在同一工作区使用现有 24PA preset，记录原来源会话和实际执行会话；它仍是本地会话，不能伪装成 Worker。干净会话减少历史和并发混入，但仍需逐工具授权、版本恢复和输入归属校验，也不能声称 Shell 被沙箱隔离。

在这组验收完成前，面板仅可诚实提供“在本地会话打开/提交原生 Skill”，显示“待发送”或“已提交”。它可成为引导入口，但**不能抵扣 M01b 完整本地手工运行闭环验收**；本轮不建议用该引导替代产品需求。

### 业务 Worker 的原生契约

`startActivation` 必须使用 `resolveAgent` 返回的 exact live parent，不能合成一个仅 id 相同的对象。reserved childId 仅适用于 local provider，并保证接纳后的 messageId。继续须由原实际父 Agent 调用 `sendMessage`；宿主支持 direct child 冷恢复，持久 child descriptor 保留 persona/toolFilter。[宿主 subagent index.ts:255](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/index.ts#L255)、[310](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/index.ts#L310)、[README:50](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/README.md#L50)

因此，业务 Skill 需显式组合可用业务 action、资源范围及参数校验；开放 `pa24_work` 这个工具名不自动赋予其全部 action。保持 Worker 无任意文件、Shell、听记和配置维护能力。原生 subagent 的接纳、结果发布和持久结算是不同阶段，沿用现有 WorkItem 生命周期恢复策略，不新增另一套调度器。

## 工具声明如何真正收紧

当前 `assertToolDeclaration` 对非数组、空数组直接返回；只拒绝数组中越出角色范围的字符串。这不是完整 schema 验证，也没有执行时交集。[skills.ts:315](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/skills.ts#L315)

建议在包发布时验证声明，在运行时计算 `有效工具 = 当次执行模式允许 ∩ 当前工作区授权 ∩ 当前宿主挂载 ∩ Skill 声明限制`。没有声明与显式 `[]` 的语义必须文档化并兼容旧包；建议新格式中前者不额外缩窄、后者不允许业务工具，不能沿用旧代码静默把空数组当全部放行。宿主 `allow:[]` 本身会拒绝所有继承工具；未知工具名会导致 restrict 拒绝，不能把不存在的工具塞进去。[宿主 tools:758](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L758)、[1098](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1098)

工具展示 filter 与服务端执行检查都要有：restrict 约束继承工具，该 scope 自己注册的工具有豁免；guard 的单调拒绝不能被后续监听者重新放行。尤其 `pa24_work` 需要再验证 action、目标资源、Run 状态和当前权限，不能只验证工具名。恢复时旧快照保留原申请权限，但不恢复已经撤销的现实授权。[宿主 tools:1167](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1167)、[runtime.ts:1886](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L1886)

## 不可变包：DB 权威、目录投影可行

当前 filesystem provider 在 get 时读取实际文件，并返回 directory resourceBase；保存旧正文不会固定脚本、reference 或 asset。[宿主 skill-filesystem:206](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L206)

“全部已校验文件内容/base64 存 DB，再投影到可恢复目录”适合当前规模，能避免数据库提交与外部目录原子发布耦合。建议版本记录包含稳定 Skill 身份、版本 id、定义、manifest、每文件规范相对路径/字节数/hash/内容、包整体 hash。限制文件数、单文件和解压后总量；验证路径、重复路径及链接，二进制按 base64 计入膨胀后的存储上限。版本发布只追加；Run 引用版本 id，不读“当前目录”。

磁盘投影以运行/版本定位，原子生成后核验 hash；丢失可从 DB 重建，运行输出放另一个位置。原生 Skill 可用运行会话 scoped registration 指向该快照 resourceBase；官方 registry 支持按 agent scope 注册和读取。具体注册、卸载、冷恢复及同名覆盖顺序仍需真实宿主验证。[宿主 skill:379](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L379)、[439](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L439)

DB 不可变版本是内容权威，目录 chmod 不是同用户 Shell 的安全沙箱。允许任意本地脚本后不能声称目录绝不被改或所有读写都可复现；应记录内容校验失败并停下核对，必要时每运行独立投影。快照也不包含模型、网络、授权、工作区其他任意文件的完整历史环境；旧快照重跑遇依赖缺失必须明确失败。

### 现有 SQLite / PostgreSQL 的真实写法

- 所有 repo 依赖 `PaDb/PaQueryer`，在 `db.ts` 的共享 MIGRATIONS 添加 `pa24.<table>`、`jsonb`、`timestamptz`，使用 `$1` 参数、显式 transaction 和 `returning *`；不另建裸数据库连接。[db.ts:11](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/db.ts#L11)
- SQLite 适配器将 schema/table、类型及占位符转换，并从迁移定义推导 JSON/布尔/时间列的读取类型。新增 JSON 列需沿用这个受支持格式，repo 继续 `JSON.stringify` 写入；不要假定任意复杂 PG SQL、跨表别名返回都会自动正确转换。[sqlite.ts:29](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/sqlite.ts#L29)、[82](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/sqlite.ts#L82)、[191](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/sqlite.ts#L191)
- 可用 JSONB manifest/content 实现有上限的全包版本，JSONB 在 SQLite 为 text；base64 的存储增加是明确成本。DB 内包会随账本备份，仍需验证恢复后目录重建、Run 引用和配额；不能据此宣称整个 M09 备份功能完成。
- 真实 PG 验证应沿用 `tests/helpers/pg.mjs` 的临时 cluster、随机端口和非超级用户 app role；SQLite 用临时文件和生产 SqliteDb。既有双后端结算测试覆盖真实 Loader、SQL 故障、重启、外部调用次数；不是模拟 repo 的同名测试。[pg helper](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/tests/helpers/pg.mjs#L26)、[work-settlement e2e](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/tests/e2e/work-settlement.e2e.mjs#L19)

## 最小深模块方案

这是实施建议，不是新增产品范围或已完成设计。

| Module / seam | 小 interface | 该模块必须隐藏的 Implementation |
| --- | --- | --- |
| SkillPackages | 发布/读取不可变版本、导出、为运行解析资源 | 来源选择、包验证、identity/version/hash、DB 内容、磁盘投影、同名处理、恢复和引用保留 |
| SkillRuns | prepare、start、control、inspect | 预览与模式判断、参数与完成标准、当前授权、幂等提交、Run/原输入/动作/投递关联、等待/停止、继续/重跑、unknown 门禁和恢复 |
| SkillRuns 内部宿主 seam | 提交受控执行、继续原执行、读取可信结算 | 模板 adapter 不进模型；本地 adapter 处理顶层 Session/guard/原生 Skill；Worker adapter 复用 WorkItemLifecycle。调用者不拼原生会话或动作幂等键 |

运行模块保持独立 Run 身份和不可变输入，至少记录：来源请求及幂等键、工作区、Skill/version/resource hash、typed 参数和完成标准、trial/正式、执行路径、来源与实际执行会话、可空 WorkItem/计划关联、父运行/原目标关联、时间与等待、执行状态、结果证据及动作关联。原生每次输入另外记录 rpcId/messageId、turn/代次；不能覆盖历史 Run。结果投递引用该 Run，用独立状态和稳定 dedup key；不要用投递失败覆盖执行成功。

模板按明确 executor kind 注册，仅模板声明不足以运行任意正文。复用现有 digest 的确定性读取/渲染，但不要为手工运行偷偷创建启用的定时计划。结果直接进入运行档案/面板，选择投递才走对应 adapter。现有本地 Outbox 会 `prompt` 原父会话并触发模型；若模板默认也走这条路，“模板不进模型”就不成立。[runtime.ts:184](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/runtime.ts#L184)

## 参数、结果和接续的具体规则

| 操作 | 运行语义 |
| --- | --- |
| 预览 | 校验定义、typed 参数、依赖及权限，展示将做什么；没有安全预览能力就明示。不创建一次假成功执行 |
| 试运行 | 真实执行、独立 Run，显式 trial；实际写入/投递仍需记录。不能把“试运行”解释成默认 dry-run |
| 正式运行 | 参数缺失、无效、资源不全或权限不足在接纳前明确返回；通过才固定版本、参数、完成标准并提交 |
| 等待后继续 | 同一未结束 Run，新增输入及事件；总实际执行时间不清零。停止后不自动复活 |
| 已结束后接续 | 同一 WorkItem 的明确后续办理创建新 Run，保存 parentRun；新目标才是关联的新 WorkItem |
| 按原快照重跑 | 新 Run 使用原版本/参数/资源/标准，重新检查现实授权与依赖；不得重新从当前目录取旧版本资源 |
| 按当前配置重跑 | 新 Run 明确显示变化并固定当前版本/参数；仍属于原请求的重跑关系，不得借新身份绕过 unknown |
| 判定完成 | 原生 turn completed 只证明模型回合结束。标准可区分文本结果、实际业务对象回执、待人工处理、部分完成；未知外部动作优先阻止“业务成功” |

当前 metadata.params 是各模板使用的普通值记录；应增加明确、版本化的参数描述与完成标准格式，并验证必填、类型和默认值。参数作为数据与 Skill 正文分开保存；兼容旧模板原 params，不能无迁移改变其含义。结构化完成声明可以作为结果入口，但仍须用实际动作账本/对象证据验证。

## unknown：快照不能解决的另一条 seam

当前普通动作键是 `action + WorkItem.id + hash(paramsKey)`。同一旧 key 的 running/unknown 会阻止执行，而新 WorkItem 形成新 key；“重跑”若直接走当前 delegate 就可能绕过未知结果。这是 M01b 必须先修的恢复缺口，不是要求产品放弃重跑。[external-operations.ts:44](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/external-operations.ts#L44)、[repo/work.ts:186](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/repo/work.ts#L186)

最小修正是在原目标/接续链中保留动作 intent 身份：同一目标的继续、原快照重跑、当前配置重跑均先查未决动作；同一动作恢复复用原 key、渠道、目标与授权快照。成功动作只修本地回执或补投；未知先对账，显示原操作和需核实的信息。不能用“已经点击重跑”“换配置”或“新建 WorkItem”证明原操作未执行，也不建议以全局模糊文本 hash 锁住所有类似的新业务。

本地任意 Shell、脚本或第三方工具不一定经过 ExternalOperations。宿主工具事件可以证明某次调用及其返回，不能证明脚本内部任意远端写入的幂等性。受控本地 Run 需要在实际调用前持久记录调用意图/归属，记录结果；失联或开始后无可靠结果保守标记待核对，禁止自动重放该运行链。业务适配器的可信回执与不透明工具输出应分别描述。工具退出码 0 或模型说“完成”都不能直接转成任意外部对象的成功凭据。

DB 包版本解决“执行的是什么内容”，稳定动作 intent 和原生输入结算解决“哪些动作已做过”。两者必须关联，但不能互相替代。

## 下一轮验证门槛与交付验收

初次研究时用户要求先处理冲突再开发，以下列出完整交付门槛。随后用户授权继续开发，末节补充了本地宿主关键路径实测；它不等于这些产品级验收均已完成。

| 门槛/功能组 | 最小可交付验收 | 依赖 |
| --- | --- | --- |
| L1 本地实际执行 | 面板选择经核实的本地顶层会话；真实原生 Skill 加载快照资源；实际工具动作、结果和所属 Run 可查。仅 accepted 不显示成功 | 宿主实际安装版本、Session UI 上下文或明确的固定/独立入口决策 |
| L2 本地隔离与恢复 | 验证旧 pending、并发 steer、两个 Run、首步 schema/guard、重启前权限恢复；不吞输入、不把普通对话计入 Run、不放过被撤销权限 | 受控本地会话形态；真实 Loader 事件验证 |
| P1 包版本 | Markdown/ZIP 校验、完整导出、同名更新、旧版本保留；删投影后从 DB 重建；在途任务继续读取旧资源，不能读到更新文件 | SkillPackages、SQLite/PG 迁移及配额 |
| T1 确定性模板 | 内置模板手工产生真实结果/Run，模型请求数为 0；不创建假计划，不向本地父会话自动 prompt | 模板 adapter、结果与投递分离 |
| W1 业务 Skill | 授权 action 真正可执行；声明缩窄工具和动作，Worker 无 Shell/QwenNote；继续冷恢复沿用原父与快照 | 明确 action 能力表、现有 WorkItemLifecycle |
| R1 参数与状态 | 缺必填拒绝；trial 明示实际动作；完成标准可核验；等待/停止/继续/两种重跑关系正确 | SkillRuns、版本与授权快照 |
| U1 未知与防重 | 外部已成功但本地回执失败、提交回执丢失、进程重启、换 Run/WorkItem/当前配置均不再次写入；核实成功只修复/补投 | 持久原生输入、动作 intent、跨运行未决查询 |
| D1 双后端闭环 | SQLite 文件与临时非超级用户 PG 同组验收；事务故障不造成一边显示完成另一边丢失结果；恢复可追踪同一原输入 | 生产 PaDb adapter、既有真实 Loader 测试样式 |

未决项集中为：本地会话隔离形态及真实事件验证、实际宿主挂载契约、参数/完成标准的新格式兼容、包体配额与投影生命周期、普通 Skill action 能力表、跨 Run 未知动作身份。它们应在对应 Implementation 前解决，不需要再重开已经确认的产品定位，也不应扩成新的通用编排框架。

## 追加：独立本地顶层会话隔离实测

用户授权继续按 TODO 开发后，本轮采用“每次运行创建明确展示的本地顶层会话，关联原发起会话与运行档案，默认结果留档”的方向验证。它是 `pa24` preset 的 local-robot，不是 Worker；未改变 ADR 权限。本节替代上文对本地首步挂载、隔离和原生恢复契约的“尚待验证”判断。

### 环境、可复现文件和结果

- 固定官方宿主：`1600d8a1e140dcde43a1a0941940a0480712c011`，通过该 checkout 的 `apps/cli/lib/bin.js` 启动实际 Web Host、Loader、Session、AgentLoop、文件工具和持久化。24PA 工作树 HEAD 为 `4f8d5af5cb1e1dc3890ec04e6545e11fe35fab91`；期间主代理进行 M01b 包模块开发，故本探针证明原生运行契约与既有 preset 角色，不冒充新 M01b 产品代码验收。
- 独立 `DSH_HOME`、profile、store、SQLite 工作区和 `/tmp` 文件。模型为本仓库 SSE fake；未使用真实平台账号。探针运行 journal 为 `/tmp` JSON，**没有验证未来 SkillRun repo 的 SQLite/PG 事务**。
- 全部探针保留在 [/tmp/pa24-m01b-local-isolation-6uoj2lhb](/tmp/pa24-m01b-local-isolation-6uoj2lhb)：[伴随插件](/tmp/pa24-m01b-local-isolation-6uoj2lhb/plugin/index.mjs)、[主体脚本](/tmp/pa24-m01b-local-isolation-6uoj2lhb/run.mjs)、[恢复与停止补测](/tmp/pa24-m01b-local-isolation-6uoj2lhb/followup.mjs)、[7 组结果](/tmp/pa24-m01b-local-isolation-6uoj2lhb/report.json)。`events.jsonl`、`a-session.json`、`b-session.json`、`a-session-after-restarts.json`、`d-session-after-restart.json`、`e-stop.json` 保留原生证据。macOS 下这些路径的 realpath 为 `/private/tmp/...`。

| 验证 | 实测结果 |
| --- | --- |
| 首步挂载 | 新会话 role 为 local-robot，无 parentSession。prompt 前完成 scoped provider、restrict、guard；第一个模型请求工具只有 `bash/read/skill`，未暴露其他本地工具 |
| 固定 Skill 与资源 | scoped `PINNED_VERSION_A` 覆盖工作区同名 `LIVE_VERSION_B_DO_NOT_USE`；真实 `read` 返回快照中的 `PINNED_RESOURCE_A` |
| 逐调用门禁与防重 | `bash` 虽在模型工具面内，但被 guard 拒绝，未进入 tools/execute；只有一个 read body。重复相同 rpcId 后模型请求数不增加，原 rpc 输入和 turn 均为 1 |
| 挂载等待与重启 | 在 `agent/created` 尚未返回时，以真实 controller 接纳输入并 flush 后硬杀。重启冷恢复先等待挂载；首步未抢跑。恢复原 pending message 后消费 1 次，保留原消息 ID 和 rpcId，产生 1 个 turn |
| 输入碰撞 | 同一初始化屏障内提交原 queue 输入和另一条 steer；pre-step 同批看到两条。探针先保存两条完整输入再 reject，0 个模型请求、0 个工具 body，turn/end 为 blocked |
| 已返回但回执未落档 | 真实 read 返回后、journal 保存结果前硬杀。新 Session/Run 沿用同 intent 被 admission 拒绝；原会话冷恢复也先设 blocked/needsReconciliation，未再执行。宿主原 turn 修复为 interrupted |
| 持久结算与顶层停止 | A 经多次重启冷读仍为原 rpc 输入 1 条、completed turn 1 个，0 个新模型请求。另一个会话在工具 wrapper 等待中被 controller cancel；等待 whenIdle 并 flush 后 turn/end 为 aborted/user，工具结果为 `tool call aborted before dispatch` |

初次探针曾因把 `/tmp` 别名传作 cwd 而未通过现有角色校验；改用已绑定工作区规范路径后通过。新 Session 应优先使用已知 Workspace 身份或当前绑定的规范路径，不能把任意字符串目录当作同一工作区。

另外，冷恢复**不会自动唤醒**旧 pending inbox；重投同 rpcId 会被 controller 去重早退，也不会唤醒。第一次据“resolve 后会自动运行”作的等待超时已保留为 `attempt1-failure.json`，后续按公开消息方法恢复并通过。此差异必须落实到恢复逻辑。

### 可直接采用的挂载契约

以下代码展示已实跑的宿主调用形状；`runStore`、校验和状态缓存需由正式运行模块实现，不是宿主提供的功能。完整可执行版本见探针插件。

```ts
// 必须先把预定 sessionId -> Run / version / 输入 / 原来源绑定持久化。
await runStore.prepareBinding(binding);
const created = await ctx.sessionController.create({
  sessionId: binding.executionSessionId,
  cwd: binding.workspacePath, // 已规范化且与当前绑定一致
  agentPreset: 'pa24',
});
// 命名 Session 有冲突时宿主可以返回另一个 ID；核对，不继续猜测。
if (created.sessionId !== binding.executionSessionId) throw new Error('会话绑定不一致');

// 在 host plugin apply 中同步注册此监听者；不要等首个 prompt 后才安装。
ctx.on('agent/created', async ({ agent, source, signal }) => {
  const binding = await runStore.bindingForSession(agent.id);
  if (!binding) return;
  // 核对工作区、实际顶层身份、版本、未决动作及当前授权；恢复未就绪须拒绝，
  // 不能带着一个尚未加载的异步权限缓存先放行输入。
  await validateAndRestore(binding, agent, source, signal);
  await agent.ctx.plugin({
    name: 'pa24-skill-run-scope',
    inject: ['skills', 'tools'],
    apply(scope) {
      scope.skills.registerProvider(() => ({
        name: 'pa24-run-version',
        list: async () => [{ ...definition, rank: 0, locator: binding.versionId }],
        get: async () => definition,
      }));
      scope.tools.restrict({ allow: effectiveToolNames });
      scope.tools.guard(exec => currentDenial(binding, exec)); // 同步，string | undefined
      // 在同一个 scope 注册 pre-step、pre-execute、execute 监听者。
    },
  }).await();
});
```

`agent/created` 是 serial async 生命周期，创建和恢复都等待回调完成，queued work 被屏障挡住；回调不得 await 自己的 `agent.whenIdle()`。初始消息和后续唤醒在安装完成后驱动。[官方 AgentFactory:172](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/index.ts#L172)、[announce:539](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/index.ts#L539)、[created 类型:247](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/runtime-types.ts#L247)

确切类型来自 `@deepseek-ai/dsh-agent` 的 `Agent/PreStepDecision/SessionStartSource`，`@deepseek-ai/dsh-skill` 的 `SkillDefinition/SkillCandidate/SkillProvider`，`@deepseek-ai/dsh-tools` 的 `ToolExecution/ToolDispatchExecution/ToolExecutionResult/PreToolDecision/PostToolDecision`。`definition` 必须包含 name、description、source、provider、invocation、content；资源使用 `{kind:'directory', path}`。provider.list 的 candidate 再加 rank、locator；get 返回完整 definition。探针使用 scoped provider rank 0，并实测同名工作区内容未替代它；正式实现应只返回该运行固定定义，不重新委托当前 registry 查名字。

查看模型工具面使用 `ctx.tools.schemas(agent)`；单独 `agent.ctx.tools.schemas()` 的默认参数仍是全局视图，不适合判断本地 Agent 实际可见工具。

### 工具动作的持久时点

| Hook | 确切形状与用途 |
| --- | --- |
| `tools/pre-execute` | `async (exec: ToolExecution, next: () => Promise<PreToolDecision>)`。在 guard 前，适合 await 授权/状态准备；尊重 signal。此时尚不等于 body 会调用 |
| `tools.guard` | `(exec: Readonly<ToolExecution>) => string \| undefined`。最终单调拒绝，同步。异步 DB 授权不能直接塞进 guard；使用已验证状态及代次，过期/未就绪拒绝 |
| `tools/execute` | `async (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>)`。所有 pre 与 guard 后进入；调用 next 前 await 持久 intent/dispatching，调用后 await 保存原始必要回执，再 return result。guard 拒绝不会进入此 hook |
| `tools/post-execute` | `async (exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>)`。仍可能修改结果投影；不是不可变业务结算凭据 |
| `tools/result` | `(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => undefined`。同步最终通知，监听者失败被包含；不能在此 fire-and-forget 唯一的 DB 成功结算 |

`ToolExecution` 提供 agent、callId、rootCallId、name、arguments、signal，嵌套调用还有 parent token；没有 Run.id。Run 应由真实 Agent 绑定与当轮输入归属推导，callId/原生消息 ID 不可由模型自由填入。`ToolExecutionResult` 区分 `isError:false/value/content` 与 `isError:true/error/content`；canonical value 不完整复制到 Session 日志，所以必要业务回执应及时保存。[官方工具 hooks:143](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L143)、[结果类型:573](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L573)、[guard 与 dispatch 顺序:1511](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1511)

`tools/execute` 内部如果 await 落库，等待期间授权可能变化；next 前还需验证当前代次/停止状态，尊重原 signal。probe 把“body 返回”记为 returned，最终日志与业务凭据另核；生产不可把 returned 一律记成业务成功。未知状态应在原运行恢复和新运行 admission 两处拦截，不能只隐藏重跑按钮。

### pre-step、持久结算与停止

pre-step payload 是 `{agent, messages, turn, step, signal}`，messages 是该 step 从 inbox 取走的批次。正式逻辑需要持久 input ledger：严格匹配已登记 rpcId/原 messageId 和真实 Session，记录 turn 归属。探针覆盖了 user queue/steer 碰撞；生产还须明确处理 agent-message、未知来源及已授权子代理的回传，不应像简化 probe 那样仅检查 user 后忽略其他来源。

所有 `user/message` 不能都当成主人输入：Skill 说明、工作区规则等也使用 user-role 上下文。实测同一个 Skill 可以出现多条 `skill-invocation` 注入，而原用户 rpcId 只有一条。按 source.kind、rpcId 和确切已登记输入识别，不按消息角色或一段文本标记判断。

结算由 native events 证明：唯一原 rpcId 对应的 input/messageId，消费它的 turn，属于该 turn 的 tool/call、tool/result、assistant/message，最后是同 turn/end；先 flush，再读自身持久事件，并验证工作区和执行 Session 归属。`turn/end completed` 仍不等于业务标准已完成；interrupted/blocked/aborted 等独立处理。原 Run 结算不能用“会话已 idle”或“最后一条 assistant”替代。

顶层停止已实测的路径：

```ts
await runStore.markStoppingAndCloseAdmission(runId);
const resolved = await ctx.sessionController.resolveAgent(executionSessionId);
if ('error' in resolved) throw resolved.error;
ctx.sessionController.cancel({ sessionId: executionSessionId }); // accepted 只确认取消请求
await resolved.agent.whenIdle();
await ctx.sessions.flush(resolved.agent.session);
// 再按原输入/原 turn 结算 stopped，保留未决动作；明确处理仍在 inbox 的输入。
```

Controller 实际调用 `agent.cancel({kind:'user'}, {keepInbox:true})`；pending 不会被清掉，停止状态和逐调用 guard 必须持久，否则后续唤醒可能继续。顶层不调用 `subagents.interrupt`。本次停止验证的是取消发生于 wrapper 等待、body 尚未启动；它不证明任何任意脚本的外部副作用可撤销。[官方 cancel:497](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/api/session-controller/src/commands.ts#L497)

### 原 pending 输入的恢复

实测可用公开 `runMaintenance`＋Inbox＋followup 原消息唤醒；只适用于已证明“唯一原输入仍 pending、尚无消费/工具证据”的情况。已消费后失联属于原回合核对，不能套这个流程重放。

```ts
await agent.runMaintenance(async signal => {
  const message = requireUniqueUnconsumedOwnedPending(agent, run);
  await runStore.prepareRedispatch(run.id, message); // 先持久完整原消息和恢复状态
  signal.throwIfAborted();
  if (!agent.inbox.remove(message.id)) throw new Error('原输入已变化');
  agent.followup(message); // 相同 id、source.rpcId、content；不生成第二条用户输入
  await ctx.sessions.flush(agent.session);
  await runStore.markRedispatched(run.id, message.id);
});
```

`runMaintenance` 只从真实 idle 进入，期间 later waking input 进入 inbox，退出后才驱动；不得在其中等待 agent.whenIdle。`Inbox.remove` 与 `followup` 是两次原生事件，**不是跨数据库/会话的原子操作**。正式恢复必须处理中间再崩溃：已有 redispatch intent 时区分原消息仍 pending、已消费、完全缺失，验证所有证据后再修复，不能盲目移除重入。探针覆盖正常恢复后仅消费一次，尚未在 remove 与 followup 之间做硬杀测试。[公开 Agent 方法](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/runtime-types.ts#L193)、[Inbox 方法](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/runtime-types.ts#L48)

### 对开发的最终约束

本地独立顶层运行路径已证明可实现，首步挂载与重启前安装不存在需要扩权 Worker 的宿主阻断。剩余工作集中在正式 Run ledger/权限代次、输入全部来源的归属、恢复间隙、真实双后端事务、产品完成标准、分离投递及包版本生命周期。任意本地工具的外部副作用仍不能由宿主自动提供业务幂等；unknown 门禁由 24PA 的原目标/动作账本承担。此研究允许开始对应实现，不允许把 7 组探针视为完整 M01b 验收。
