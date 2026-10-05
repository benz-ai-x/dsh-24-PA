# 24私助（24PA）开发交接

交接日期：2026-10-06，Asia/Shanghai。用途：用户重启电脑后，在新会话继续技术研究与正式开发。本文仅记录接手位置和索引；产品定义、验收标准和工作流程以链接中的原件为准。

## 当前停在哪里

已确认的产品设计与规格已收敛，具备进入实施前技术研究的基础。现有实现是可丢弃原型；正式版并未完成。下一阶段是 **M0 兼容性核对＋F01「工作区助理与随手记」的 research**，关键问题解决后再进入 F01 开发。

用户要求交接后重启电脑，并随后明确授权提交、合并；提交和合并现已完成。本轮没有启动上述新研究或正式实现。下一会话按用户的继续指令推进，不重新要求用户复述已确认需求。用户对样例定位和先研究后开发的最新要求已经写入下方产品基线，必须先读。

## 权威材料与阅读顺序

| 接手时要知道什么 | 原件 |
|---|---|
| 仓库指令与条件化阅读入口 | [AGENTS.md](/Users/pc2026/DSH-Space/dsh-24-PA/AGENTS.md) |
| 先 research 再开发、样例定位、文档同步与授权范围 | [产品基线](/Users/pc2026/DSH-Space/dsh-24-PA/docs/agents/product.md) |
| 已确认的产品与技术契约 | [设计 v0.4](/Users/pc2026/DSH-Space/dsh-24-PA/docs/24PA-整体设计方案.md)、[Spec 1.2](/Users/pc2026/DSH-Space/dsh-24-PA/docs/24PA-v1-SPEC.md)、[GitHub 父规格 #1](https://github.com/benz-ai-x/dsh-24-PA/issues/1) |
| 词义、会话来源与权限 | [领域文档入口](/Users/pc2026/DSH-Space/dsh-24-PA/docs/agents/domain.md)、[GLOSSARY.md](/Users/pc2026/DSH-Space/dsh-24-PA/GLOSSARY.md)、[ADR 0001](/Users/pc2026/DSH-Space/dsh-24-PA/docs/adr/0001-workspace-session-boundaries.md) |
| 功能分组、依赖和合并标准 | [PR 交付计划](/Users/pc2026/DSH-Space/dsh-24-PA/docs/planning/24PA-v1-PR交付计划.md) |
| 现有工单与规格覆盖 | [GitHub 工单索引](/Users/pc2026/DSH-Space/dsh-24-PA/docs/planning/24PA-v1-GitHub工单索引.md)、[工单拆分与覆盖](/Users/pc2026/DSH-Space/dsh-24-PA/docs/planning/24PA-v1-工单拆分草案.md) |
| Issue 操作与状态规则 | 操作前读 [issue-tracker.md](/Users/pc2026/DSH-Space/dsh-24-PA/docs/agents/issue-tracker.md)；调整标签前读 [triage-labels.md](/Users/pc2026/DSH-Space/dsh-24-PA/docs/agents/triage-labels.md) |
| 原型运行方式和已验证范围 | [README](/Users/pc2026/DSH-Space/dsh-24-PA/README.md)、[原型说明](/Users/pc2026/DSH-Space/dsh-24-PA/prototypes/24pa-dsh/README.md)、[原型验收记录](/Users/pc2026/DSH-Space/dsh-24-PA/docs/prototypes/24PA-原型验收记录.md) |

本次交接只核对本地文件，没有重新读取远端 Issue 状态。继续工作时回读 #1 及 F01 所含 Issue 的当前正文和评论；不要把文档中的历史同步状态当成实时 GitHub 状态。

## 磁盘与 Git 状态

- 仓库：`/Users/pc2026/DSH-Space/dsh-24-PA`。
- 当前分支：`main`，跟踪 `origin/main`；本地与远端均为 `e904a81eefa5a9d8f4f3db7b1462324dfbd46b5c`。
- [PR #47：同步24私助设计基线与可体验原型](https://github.com/benz-ai-x/dsh-24-PA/pull/47) 已合并。提交内容和验证证据查看 PR，不在本交接复制 diff。
- 最近文档提交为 `ead191cb56bd14bec4de72bf302490d1294a90cf`，已推送并包含在上述合并内。原型分支 `prototype/24pa-dsh` 保留。
- origin：`git@github.com:benz-ai-x/dsh-24-PA.git`。
- PR #47 合并并同步 main 后，工作区干净；协作规则、README 和服务器样例分析均已纳入版本控制。随后按用户要求将本交接文档移到项目根目录，当前仅新增本文件，尚未提交。
- 本次是设计与可丢弃原型基线合并，正式功能的研究、实施和验收仍按原计划推进。后续正式工作从最新 main 按功能建立分支，具体规则见 PR 交付计划。
- `.prototype-runtime/`、`artifacts/` 等仍是忽略的本地辅助数据；本交接文档按用户要求保存在项目根目录 `HANDOFF.md`。

## 环境线索与研究入口

本地 dsh 源码位于 `/Users/pc2026/DSH-Space/deepseek-harness`。本机已配置 SSH 别名 `ali_code_agent`，本轮此前成功进行过用户授权的只读源码与运行元数据检查；本轮未改服务器配置、停启服务、连接生产数据库或发送飞书消息。

服务器源码路径、版本差异、样例运行方式、公开 API 线索及未验证范围均在[服务器样例分析](/Users/pc2026/DSH-Space/dsh-24-PA/docs/research/ali_code_agent-飞书bridge源码分析.md)。其中状态是采样时事实，继续研究时按需重新核对。原始快照位于忽略目录 `.prototype-runtime/ali-bridge/`，可能包含私有标识；对外只引用脱敏分析，不上传原始快照、凭据或私人日志。

先利用已有研究，避免从零重复探索：

- [dsh 源码与插件机制](/Users/pc2026/DSH-Space/dsh-24-PA/docs/research/dsh-源码与插件机制.md)
- [飞书接入与审核机制](/Users/pc2026/DSH-Space/dsh-24-PA/docs/research/飞书接入与审核机制.md)
- [存储与调度复用](/Users/pc2026/DSH-Space/dsh-24-PA/docs/research/第一轮审核-存储与调度复用.md)
- [多会话与恢复](/Users/pc2026/DSH-Space/dsh-24-PA/docs/research/第一轮审核-多会话与恢复.md)

这些既有材料提供线索；适用版本和正式接口契约仍按产品基线核验。

## 下一会话的执行起点

1. 读取 AGENTS.md、产品基线及上述关联原件，核对当前 Git 状态和用户最新指令；如重启后出现新的本地修改，保留并辨明来源。
2. 以 PR 计划中的 F01 为完整功能研究范围，从 [P01 / #3](https://github.com/benz-ai-x/dsh-24-PA/issues/3) 的兼容与装配条件入手，覆盖同组 [#4](https://github.com/benz-ai-x/dsh-24-PA/issues/4)、[#5](https://github.com/benz-ai-x/dsh-24-PA/issues/5)、[#6](https://github.com/benz-ai-x/dsh-24-PA/issues/6)、[#7](https://github.com/benz-ai-x/dsh-24-PA/issues/7) 所需的接口和完整用户流程。工单内容直接回读，不以本交接代替。
3. 调用 research，依据已确认设计调查一手来源并完成必要隔离验证。交付证据、版本、可复用公开能力、方案取舍、验证结果和未决问题，保存于仓库 `docs/research/`。M0/F01 研究尚未开始，样例分析不能充当其完成凭据。
4. 研究足以支撑关键路径后，根据用户启动指令和 PR 计划进入 F01 正式开发。出现影响已确认设计的冲突时，带证据处理变更。按既定功能分组交付，具体分支与验收规则查原计划。

本轮 handoff 不创建自动化，不安排后台继续运行；重启后由用户开启下一会话。

## Suggested skills

下个 Agent 在对应阶段通过 Skill 工具调用这些技能；若环境没有 Skill 工具，按路径读取 SKILL.md 并遵循其流程。按需加载，不一次全部执行。

| 阶段 | 建议技能 |
|---|---|
| 首先开展 M0/F01 一手资料研究 | [research](/Users/pc2026/.agents/skills/research/SKILL.md)；其流程要求使用后台研究 Agent，结论落到仓库 Markdown |
| 正式实现和验证业务行为 | [tdd](/Users/pc2026/.agents/skills/tdd/SKILL.md)，结合 Spec 已确认的测试边界 |
| 功能完成后的规范与规格审查 | [code-review](/Users/pc2026/.agents/skills/code-review/SKILL.md) |
| 编写功能 PR 描述 | [pr](/Users/pc2026/.agents/skills/pr/SKILL.md) |
| 必须调整协作指引或领域决策时 | [writing-for-agents](/Users/pc2026/.agents/skills/writing-for-agents/SKILL.md)、[domain-modeling](/Users/pc2026/.agents/skills/domain-modeling/SKILL.md) |

## 重启后可用的启动语

> 读取这份24私助交接文档及其引用的权威资料，从 M0＋F01 技术 research 开始。按照已确认设计核验 dsh 原生能力、飞书 SDK/CLI 和 PostgreSQL，关键问题解决后再推进 F01 开发。服务器 bridge 仅作样例；从已合并的 main 基线按功能 PR 计划交付。
