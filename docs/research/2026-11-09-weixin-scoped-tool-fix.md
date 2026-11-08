# 微信真实验收发现的会话工具权限缺口

日期：2026-11-09（Asia/Shanghai）。关联 [#279](https://github.com/benz-ai-x/dsh-24-PA/issues/279)，修复比较基线 `7a09b26969e59d4f570ad8e9c50ed4c714850054`。本记录补充首版验收，不关闭 #279，不把普通文字回复当成交办成功。

## 正式账号观察

本人完成 8010 扫码、候选身份核对和启用后，发送 `/24pa`；01:33:44 收到原输入，01:33:45 保存平台接纳。本人随后明确回复“帮助已收到，测试已发送”。帮助正文与正式代码一致，原账号、主人、代次、会话和输入关联匹配。平台返回 HTTP 200、19 位字符串原生消息号、省略 ret；按已核验协议记录 `native_message_id` 接纳，未冒充已读。

第二条固定测试要求创建“微信接入验收”交办，并给出三条整理桌面的建议。01:37:01 入站，01:37:52 回复被平台接纳；回复称已创建并完成 `task-1`。只读查询发现该微信父会话的 **24私助 WorkItem 数为 0**。原生会话记录表明模型先调用 `pa24_jobs new-goal` 两次，因缺原事项编号而失败，随后实际调用宿主 `team_task_create` 和三次 `team_task_update`（共四条团队任务事件）。这是宿主团队任务，不是24私助交办。

原生请求目录除三个微信业务工具外，还包含 `list_agents`、`spawn_teammate`、`send_message`、`interrupt_agent`、`wait_agent` 和四个 `team_task_*` 工具。隔离回归此前只使用默认 web profile，未覆盖正式实例额外安装的 Agent Teams profile；不能据此否认这次真实失败。

本人明确允许“暂时停止，修复后恢复”。01:41:47 通过正式预览/应用流程停止微信入口，保留原绑定代次、两条输入和两条投递；未修改或伪造其完成状态。第一次暂停请求被自动审批拒绝，取得上述具体授权后才执行。

证据：[收发及身份关联](evidence/2026-11-09-weixin-scoped-tools/formal-help-and-text.json)、[原生调用与缺失交办](evidence/2026-11-09-weixin-scoped-tools/formal-failure.json)。实际账号、会话和消息号以 SHA-256 记录；不导出凭据、完整系统提示、私人业务列表或模型推理。部署制品仍为 `f26d833` 开发包，业务代码与已发布 `.1.4` 相同；这份观察不代表修复已部署。

## 根因与接口依据

宿主 `dsh 0.2.2-rc.1` 的 [`ToolsService.restrict`](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/core/tools/src/index.ts) 仅过滤继承工具，当前 Agent 自己注册的工具免于此过滤。官方 [Agent Teams 工具](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/experimental/tool-agent-team/src/index.ts) 正是在 Agent 作用域挂载。服务器与本机 `dsh-tools/lib/index.js` 字节一致，SHA-256 为 `1889cbf718d64518dd83245d4dba1e1f080b2c5326259c3ed5b1be7a7666a2bd`。

可复用的公开接口为 `tools.guard` 和 `tools.setExecutor`；[`NativeToolExecutor`](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/core/tool-executor-native/src/index.ts) 提供模型目录生成和完整原生执行。`guard` 在可扩展审批规则之后检查，因此其他规则返回 allow 也不能扩大业务权限。未改宿主源码、注册表私有字段或微信协议。

### 发布兼容范围

增量 Standards 复审核对官方旧版 `dsh-v0.2.1-rc.5`（`b830ec950faba0a46dda564be3e2d854afed94f1`）：该版没有 `NativeToolExecutor` 包或 `ToolsService.setExecutor`。不能继续宣称新业务门禁兼容全部历史宿主，也不能回退到旧白名单来掩盖缺口。`.1.5` 的 `engines.dsh`、两个宿主 peer、锁文件、版本守卫、四份 README 和初始化指南均收窄为实际验证的 `0.2.2-rc.1`；旧宿主继续使用版本表中的既有插件与历史 dist-tag。新宿主若缺少要求的接口仍拒绝装配。

## 修复范围

- 微信 Lead 的模型目录限定为 `pa24_delegate / pa24_jobs / pa24_memory`；调用时再按当前角色及绑定状态检查。后来注册的会话工具和直接/嵌套调用同样受控。
- 所有受管业务 Worker 从创建起使用自身业务白名单，因此本地/飞书创建的交办被微信热续办时也不能扩大权限；原父会话、原编号和结果目标不变。未登记的微信子会话不获业务权限。停用/退休收紧 Lead；已经获得授权的在途 Worker 仍可完成原业务，结果保留原目标并由既有 Outbox 暂停发送。
- 业务作用域装配缺少公开执行门禁时失败，不退回旧限制方式。原生业务完成回传保留；不让宿主团队任务替代 WorkItem，也不让微信走本地编程子任务分支。
- 明确首次交办用 `pa24_delegate`，`pa24_jobs new-goal` 必须引用已有交办。没有适用角色时如实说明，不能把团队任务、todo 或自编编号称作交办。提示集版本 `1.13.1`。

界面、账本 schema、计划通知配置和凭据格式未变化；F55/通知结论 B 仍未验证。

## 验证与剩余验收

先用真实 Cordis / ToolsService / 原生执行器构造会话后挂载工具的回归：旧代码把 `team_task_create` 与未知会话工具暴露给模型，且停用检查未阻断；实际断言失败。修复后 6 项边界用例通过，包含模型目录、直接与嵌套执行、其他规则 allow、晚挂载、Worker、未知子会话、停用/退休及门禁缺失。

从 `packages/24pa` 执行构建和 `preset:check` 均通过；受影响的 10 个单元文件共 **143 项通过**。另有 5 项预设及宿主版本守卫通过。这是定向回归，未称为重跑完整历史单元集。[日志](evidence/2026-11-09-weixin-scoped-tools/unit.log)

真实 Loader / Session 矩阵均额外安装官方 `@deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-rc.1`，使用真实原生工具执行，只替换模型、微信和业务外部平台边界：

```sh
DSH_BIN=<已核验的 dsh 0.2.2-rc.1 CLI> \
PA24_E2E_STORAGE=sqlite\|postgres \
PA24_E2E_EXTRA_PLUGINS=@deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-rc.1 \
npx vitest run tests/e2e/weixin.e2e.mjs tests/e2e/manticore-work-run.e2e.mjs
```

上面的 `sqlite|postgres` 表示两次分别运行，不是一个实际参数。SQLite 和隔离 PostgreSQL 各有微信 **6/6**、普通交办 **6/6** 通过，包括微信 Lead 与跨入口热续办 Worker 故意调用未列出的团队工具后无 `team/task` 写入、常用计划原文确认、日程/待办、编号续办、unknown 核对、重启和联合恢复。[SQLite](evidence/2026-11-09-weixin-scoped-tools/sqlite.log)、[PostgreSQL](evidence/2026-11-09-weixin-scoped-tools/postgres.log)

首轮双轴审查固定头 `bfad4b9`：Standards 发现一项 P3 证据计数错误，已按完整事件改为三次更新；Spec 发现同项 P3 和一项 P1 跨入口热续办缺口。新增回归在旧实现明确失败（本地业务 Worker 仍向模型暴露 `team_task_create`），修复后通过；所有业务 Worker 从首次装配起落实既有角色白名单，不改父会话与结果目标。增量双轴复审、修复版本发布、8010 升级与正式账号复验尚待后续记录。#279 保持打开；真实业务交办/原编号续办及计划预览/原文确认未通过前不关闭。固定桌面建议请求不是日程/待办写入授权；后续真实外部写入仍须使用本人明确的测试对象和范围。
