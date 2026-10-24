# GitHub 事项操作

本项目的事项与规格使用 GitHub Issues，通过 `gh` CLI 操作。

## 仓库定位

目标仓库为 `benz-ai-x/dsh-24-PA`。操作时显式指定 `--repo benz-ai-x/dsh-24-PA`，避免依赖当前目录的 remote；这里仅指定既有仓库。

## 读取与写入

1. **定位**：按用户给出的 URL／编号读取目标正文与评论。Issue 与 PR 共用编号，类型不明确时先核实再选择命令。
2. **准备变更**：以当前正文为底稿，仅修改任务范围内内容；保留编号、评论及未要求变更的状态、标签、负责人和原生阻塞关系。多行正文先存临时文件，再用 `--body-file` 传入。
3. **执行**：分类、标签或状态变更前读 [标签映射](triage-labels.md)；实施票还须满足下方交付条件。关闭需要说明时，先评论说明再关闭。
4. **回读**：写入后核对正文、状态、标签及受影响关系；回读结果与预期一致才算完成，未成功的项单独报告。

## 技能指令的含义

- “publish to the issue tracker”：创建 GitHub Issue。
- “fetch the relevant ticket”：读取指定 Issue 及评论。

## 实施 Issue 与功能 PR

领取、推进或关闭实施 Issue 前，读 [交付流程](delivery.md)，按其中的依赖判定与关闭条件执行；功能归属查 [PR 交付计划](../planning/24PA-v1-PR交付计划.md)。下方 Wayfinding 的 Frontier、Claim 与 Resolve 使用同一规则。

## PR 分类入口

**PRs as a request surface: no.**

外部 PR 默认不进入事项分类队列。用户将此值改为 `yes` 后，读取 PR 正文、评论和 diff，使用对应的 `gh pr` 操作及同一标签映射。

## Wayfinding

使用 `wayfinder` 组织探索任务时，按以下对象与动作执行：

- Map：一个带 `wayfinder:map` 标签的 Issue，保存 Notes、Decisions-so-far 与 Fog。
- Child：每张工单一个子 Issue，关联 Map，并标注 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。不支持子 Issue 时，在 Map 中维护任务列表，并在工单顶部写 `Part of #<map>`。
- Blocking：优先使用 GitHub 原生 Issue 依赖；不可用时在工单顶部记录 `Blocked by: #<n>, #<n>`。实施票按交付流程判断依赖满足；独立调研票按前置结论及关闭状态判断。
- Frontier：按 Map 顺序选择第一个未关闭、依赖已满足且未分配的子工单；实施票先定位其功能分组。
- Claim：开始工作前，用 `gh issue edit <n> --repo benz-ai-x/dsh-24-PA --add-assignee @me` 领取。
- Resolve：独立调研票记录答案后关闭；实施票按交付流程记录进度并判断是否可关闭，再按需同步 Map。
