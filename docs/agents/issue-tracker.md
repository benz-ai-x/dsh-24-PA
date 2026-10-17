# Issue tracker: GitHub

本项目的事项与规格使用 GitHub Issues，通过 `gh` CLI 操作。

## 仓库定位

已由用户确认的目标仓库：`benz-ai-x/dsh-24-PA`（`git@github.com:benz-ai-x/dsh-24-PA.git`）。当前目录尚未配置 Git remote 时，用 `--repo benz-ai-x/dsh-24-PA` 显式操作；此配置不授权自动创建远程仓库。

## 操作约定

- 多行正文一律先存临时文件、用 `--body-file` 传入，保留换行与字面内容。
- 关闭需要说明时，先发评论再关闭。
- 标签名称遵循 [triage-labels.md](triage-labels.md) 的角色映射。

## 技能指令的含义

- “publish to the issue tracker”：创建 GitHub Issue。
- “fetch the relevant ticket”：读取指定 Issue 及评论。
- GitHub 的 Issue 与 PR 共用编号；编号来源不明确时先辨别类型，再操作。

## 实施 Issue 与功能 PR

领取、推进或关闭实施 Issue 前，按 [PR 交付计划](../planning/24PA-v1-PR交付计划.md) 判定同组与跨组依赖。Issue 是实施任务，功能 PR 是合并单位；完成单票后记录提交和验收结果，继续所属功能分支。该规则也适用于下方 Wayfinding 的 frontier 与 resolve，防止同组工单互相等待关闭。

## Pull requests as a triage surface

**PRs as a request surface: no.**

只有用户将此值改为 `yes` 后，外部 PR 才进入事项分类队列；届时读取正文、评论和 diff，并使用对应的 `gh pr` 操作及同一标签映射。

## Wayfinding operations

供 `wayfinder` 使用：

- Map：一个带 `wayfinder:map` 标签的 Issue，保存 Notes、Decisions-so-far 与 Fog。
- Child：每张工单一个子 Issue，关联 Map，并标注 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`。不支持子 Issue 时，在 Map 中维护任务列表，并在工单顶部写 `Part of #<map>`。
- Blocking：优先使用 GitHub 原生 Issue 依赖；不可用时在工单顶部记录 `Blocked by: #<n>, #<n>`。实施票按 PR 交付计划判断依赖满足；独立调研票按前置结论及关闭状态判断。
- Frontier：按 Map 顺序选择第一个未关闭、依赖已满足且未分配的子工单；实施票先定位其功能分组。
- Claim：开始工作前，用 `gh issue edit <n> --add-assignee @me` 领取。
- Resolve：独立调研票记录答案后关闭；实施票先记录实现和验收进度，在所属功能 PR 合并且本票验收通过后关闭，再按需同步 Map。
