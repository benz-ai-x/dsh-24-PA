# 24私助（24PA）正式插件

`@benz-ai-x/dsh-24pa` 是 24私助的正式 dsh bundle：一个「24私助」预设同时承接事务交办与工作区维护，业务账本使用 PostgreSQL，飞书接入采用官方 SDK 长连接＋受控 lark-cli 执行器。

## 安装与启动

```sh
npm install && npm run build          # 构建 lib/
dsh --profile <你的 profile> plugin add <本目录> --ignore-scripts
dsh --profile <你的 profile>
```

环境变量（值由服务器启动环境提供，文件只保存名称）：

| 变量 | 用途 |
|---|---|
| `PA24_PG_DSN`（默认名，可在 AGENTS.md 改） | PostgreSQL 连接串；业务账本位于独立 `pa24` schema，应使用受限账户 |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | 飞书自建应用凭据（feishu 模式） |
| `PA24_WORKSPACE` | 首次启动时绑定的工作区绝对目录（也可在面板选择） |

首次绑定目录若没有 `AGENTS.md` 会生成模板；已有文件不覆盖。AGENTS.md 中唯一的 json 块是配置源：`mode`（demo/feishu）、`larkProfile`、`ownerOpenId`、`folderToken`、`tasklistId`、`calendarId`、`timeZone`、`pgDsnEnv`、`maxWorkers`、`enabledWorkers`、`workerModels`。凭据与连接串只写环境变量名。

## F02 增量（并行事项与记忆维护）

- 五类专业角色注册于 `src/roles.ts`：memo 可用；calendar/tasks/reminders/handwriting 已注册、未交付前委派时明确拒绝。维护者可经管理端点注册新职责（如 digest 资料摘要），沿用统一 WorkItem/并发/回传/恢复边界。
- 飞书回复旧消息固定路由到原事项（`pa24.message_route` 持久路由）；未知引用明确告知，不回退新工作。
- 重启对账：`processing` 收件重派（requestId 幂等）、`admitted` 未交付行提示重发、运行中事项按恢复代次（`work_item.recovery_gen`）续办、已停止事项不复活。
- JSON 记忆权威：工作区 `.24pa/memory.json`（schemaVersion/revision/records）＋审计 `memory-log.jsonl`＋可撤销变更集 `.24pa/changesets/`；写入/整理/撤销仅限本地24私助会话（expectedRevision 原子提交），检索对所有角色开放；无任何定时/后台整理。面板「结构化记忆」页展示正文、来源、筛选与分页。

## F03 增量（任务与项目清单）

- tasks Worker 正式可用：`task_create`（幂等键＋staged 操作，结果未知不自动重试）、`task_update`（截止时间与计划投入/估时分开记录，每任务串行门）、`task_complete`（明确动作，不从对话推断）、`task_get`（尽力远端刷新投影）、`task_list`。
- 项目/个人清单：`project_create` / `project_adopt`（本人采纳后才创建真实飞书任务并关联）/ `project_progress`（进展取自实际任务状态；不订票、付款或对外提交）。
- 本地表：`pa24.task`（飞书为权威的投影，含 due/planned/estimate 与同步时间）、`pa24.project`、`pa24.project_task`。平台无任务删除接口：取消以修改＋说明处理，如实告知。

## 数据与备份/恢复

| 数据 | 位置 |
|---|---|
| 业务账本（收件/事项/操作/Outbox/绑定/备忘/消息路由） | PostgreSQL `pa24` schema |
| 长期记忆权威、审计与变更集 | 工作区 `.24pa/`（memory.json / memory-log.jsonl / changesets/） |
| 工作区规则与配置 | 工作区 `AGENTS.md` |
| 原生会话日志与附件 | dsh `$DSH_HOME/sessions`（原生 JSONL，不使用 SQLite） |

备份：`pg_dump --schema=pa24 <dsn> > pa24.sql` ＋ 工作区目录 ＋ `$DSH_HOME/sessions`。
恢复：先恢复 PG（`psql < pa24.sql`）再恢复目录，重启 Host；启动即核对绑定与进行中事项，`needs_reconciliation`/失败事项由人工核对后续办，不自动重放外部写入。
单 Host：同一状态目录（`$DSH_HOME/24pa`）第二个活跃进程会被锁拒绝。

## 测试

```sh
npm run build
npm test        # 单元（真实隔离 PostgreSQL 集群）+ e2e（真实 dsh Loader/Host）
```

测试边界（与工单一致）：真实 Loader、原生 Session/子代理、隔离 PostgreSQL、真实 lark-cli 子进程（飞书侧为桩）；仅替换模型（本地 Messages 兼容 mock）、外部网络与注入时钟。需要相邻的 `deepseek-harness` checkout（`../deepseek-harness`，含已构建 `lib/`）与 Homebrew PostgreSQL（`initdb`/`pg_ctl`）。

## 边界

真实飞书租户联调、真实模型质量与生产部署尚未验收（按工单另记实测/未验证状态）。
