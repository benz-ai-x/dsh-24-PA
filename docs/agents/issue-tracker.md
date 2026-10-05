# Issue tracker: GitHub

本项目的事项与规格使用 GitHub Issues，通过 `gh` CLI 操作。

## 仓库定位

已由用户确认的目标仓库：`benz-ai-x/dsh-24-PA`，网页地址为 https://github.com/benz-ai-x/dsh-24-PA，Git SSH 地址为 `git@github.com:benz-ai-x/dsh-24-PA.git`。当前目录尚未配置 Git remote 时，使用 `--repo benz-ai-x/dsh-24-PA` 显式操作该仓库。

从 `git remote -v` 确定目标 GitHub 仓库。没有远程地址或目标不明确时，先向用户确认仓库 URL 或 `owner/repo`；确定后可用 `--repo <owner/repo>` 显式指定。此配置不授权自动创建远程仓库。

## 常用操作

- 创建：`gh issue create --title "..." --body-file <path>`。
- 读取：`gh issue view <number> --comments`，需要结构化结果时使用 `--json`。
- 列出：`gh issue list --state open --json number,title,body,labels,comments`，按任务增加标签或状态筛选。
- 评论：`gh issue comment <number> --body-file <path>`。
- 标签：`gh issue edit <number> --add-label "<label>"` 或 `--remove-label "<label>"`；名称遵循 `triage-labels.md`。
- 关闭：需要说明时先发表评论，再执行 `gh issue close <number>`。

多行正文先保存到临时文件，使用 `--body-file` 保留换行与字面内容。

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
