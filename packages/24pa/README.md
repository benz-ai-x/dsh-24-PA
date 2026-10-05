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

## 数据与备份/恢复

| 数据 | 位置 |
|---|---|
| 业务账本（收件/事项/操作/Outbox/绑定/备忘） | PostgreSQL `pa24` schema |
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
