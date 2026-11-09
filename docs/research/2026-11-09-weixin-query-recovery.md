# 微信只读待办查询：参数拒绝与运行恢复

关联 #279；目标为修复真实验收发现的阻塞，不增加微信权限或周期通知能力。

## 真实现象与边界

2026-11-09 09:19（Asia/Shanghai），主人确认发送“微信修复验收”只读待办查询。8010 使用已发布的 `0.2.2-rc.1.5`，基线为 dsh `0.2.2-rc.1`。

- 微信输入已接纳，建立一项真正的 tasks WorkItem。Lead 工具目录只有 `pa24_delegate / pa24_jobs / pa24_memory`，Worker 只有 `pa24_work / pa24_run / pa24_memory`；本次没有再调用宿主 Team 工具。
- `pa24_run progress` 成功；随后 `pa24_work {action:"task_list",status:"incomplete",limit:50,offset:0}` 返回“待办状态筛选无效”。对应运行进入 `needs_reconciliation`，关联平台动作数为 0，没有新结果投递。
- 本次只证明权限修复已进入真实业务链，未证明业务查询或微信结果回传完成。输入、原调用回执和运行均保留，不要求主人重发以绕过未知记录。

## 可重复的诊断

在 `todo-public-tool.test.mjs` 通过真实 ToolRuntime、真实 PaRuntime、WorkerRuns 和 SQLite 重放同一查询参数，断言运行保持可继续、错误被记为明确失败、没有调用平台，并在原运行纠正为 `open`。

```sh
cd packages/24pa
npm run build
npx vitest run tests/unit/todo-public-tool.test.mjs -t '待办筛选参数拒绝'
```

修复前连续两次失败：预期 `running`，实际 `needs_reconciliation`；用例本身约 50 ms。修复后同一调用链通过，并能执行纠正后的查询。

核验的三个解释：本地参数校验被误判未知、宿主 schema 提前拒绝、来源权限/网络失败。实际公共 schema 接纳了 `incomplete`，错误来自 `SourceTodo.query` 的前置筛选校验，早于来源读取；不是平台或网络错误。WorkerRuns 对普通 handler 异常保守记为未知是既有保护，不能通过放宽这条保护修复。

## 修复范围

- `SourceTodo` 用专用 `TodoQueryValidationError` 标识来源访问前的筛选/分页参数拒绝，附允许值和纠正提示。
- 仅 `task_list` 适配器将这类明确前置拒绝返回为 `{status:"rejected",businessExecuted:false}`。其他错误继续抛出；不按错误文字或动作名称推断“未执行”，不把外部未知写入改成失败。
- 沿用既有 WorkerRuns 的业务拒绝记账：失败调用保留，同一运行可以读取回执并纠正。未修改未知回执、停止、核对和接续门禁。
- 模型参数说明、tasks brief/persona 明示 `all/open/completed/canceled`；未完成用 `open`。共享 `status` 参数仍兼容其他业务动作，不用待办枚举误限制它们。提示集为 `1.13.2`，tasks brief 版本为 4。

这是既有“明确未执行与未知结果分开”的实现纠正，不改变 SPEC/ADR 的产品要求。现有 `SourcePreparationError` 的主人补充流程不变。

## 隔离验证

本轮运行于独立分支 `codex/weixin-query-recovery`，基线 `cb9f09420a1c58e3ae6af64f1357267ac4fdaeb2`；主工作区未提交改动保持原样。

- build、preset:check 通过；版本/预设守卫另 5 项通过。
- 9 个定向单元文件共 178 项通过：公共待办工具、schema、提示、运行记录、微信工具范围、来源权限/待办查询、计划来源权限及企微 CLI 契约。
- 真实 dsh Loader/Session，安装官方 Agent Teams profile，SQLite 与隔离 PostgreSQL 各 13 项通过（微信 7 + 普通交办 6）。新增场景包含真实微信入口 → 无效筛选拒绝 → 同一运行纠正为 `open` → 结果关联原输入和绑定代次 → 微信 Outbox 接纳；没有平台待办写入。
- 既有真实写入后回执丢失、重启不重做、停止与核对后接续用例继续通过。来源权限和绑定策略未放宽。

```sh
DSH_BIN=/path/to/deepseek-harness/apps/cli/lib/bin.js \
PA24_E2E_STORAGE=sqlite \
PA24_E2E_EXTRA_PLUGINS=@deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-rc.1 \
npx vitest run tests/e2e/weixin.e2e.mjs tests/e2e/manticore-work-run.e2e.mjs
# PostgreSQL 使用同一命令，将 PA24_E2E_STORAGE 改为 postgres。
```

发布候选为 `0.2.2-rc.1.6`。审查、远端发布及 8010 部署/原交办恢复须另留实际证据；以上隔离测试不替代真实账号验收。#279、#281 保持打开，F55 通知实验未因本次只读查询获得额外范围。
