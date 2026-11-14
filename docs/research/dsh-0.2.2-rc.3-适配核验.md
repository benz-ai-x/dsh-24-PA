# dsh 0.2.2-rc.3 适配核验（插件 0.2.2-rc.3.1）

2026-11-14。上一适配基线：`dsh 0.2.2-rc.1` / 插件 `0.2.2-rc.1.8`。目标为 npm `next` 的 `0.2.2-rc.3`，候选插件版本 `0.2.2-rc.3.1`；不使用版本豁免。

## 官方来源与范围

- 官方仓库：[rc.1](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1)＝`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`，[rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.2)＝`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`，[rc.3](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3)＝`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。三标签已与 GitHub 远端核对；[累计 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.2-rc.1...dsh-v0.2.2-rc.3)。
- npm：`@deepseek-ai/dsh@0.2.2-rc.3` 发布于 2026-11-13，`next=0.2.2-rc.3`，`latest=0.2.2-rc.1`；`dsh-web-app`、`dsh-schedule`、`dsh-mcp-client`、两个 subagent provider 和 Agent Teams 新包均有 rc.3。宿主 `engines.node>=24.9.0`。
- rc.1、rc.2、rc.3 的 npm 清单都为 Cordis `~4.1.0`、Schemastery `~3.19.0`、loader/include `~1.1.0`、timer `~1.2.0`。本产品旧 Cordis/Schemastery alpha peer 属于既有声明漂移，不是 rc.2 新增变化。
- rc.1→rc.2 是大范围发布累计差异，不能只按文件数推断本插件影响；以下按24私助实际消费面核对。rc.2→rc.3 主要新增 DeepSeek 对话导入、Sidebar/Workspace 组合调整及桌面修复。

## 确定性适配

| 消费面 | 官方证据 | 24私助影响与处置 |
|---|---|---|
| `startActivation` | [`SubagentActivationSpec`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/subagent/subagent/src/types.ts#L29) 直接继承任务选项；commit `575606a3567cd2050a643e660f1be5502aa7763d`；[迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.2/subagent-activation-options/guide.zh.md) | `runtime.ts` 和 `host.ts` 仍用嵌套 `request`，所有新 Worker 会失败。改为扁平 `parent/prompt/maxDepth/agentOptions`，同步 mock。`persona/toolFilter` 不在公开请求类型中，不能当作宿主能力透传；实际权限继续由24私助门禁执行。 |
| 直接子级目录 | commit `86d4c75516347889c9670c9d5461d2b2bdbbe9ad` 删除服务 `listChildren/drainChildren/list`；[迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.2/subagent-service-methods/guide.zh.md) | `skill-run-host.ts` 与 `model-budgets.ts` 必须改。采用 `sessionQuery.observeSession(parentId)` 的持久 `subagentCatalog` 核验直接边，释放 observation；缺失服务或 projection 失败关闭。`listDescendants` 保留递归发现，不用它代替全部直接查询，避免遍历无关子树。 |
| 运行时归属 | commit `b3d4933f39ff33733f7f5d6a422addec62168fc9` 删除 `AgentRegistry.isOwnedBy/roots`；[迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.3/subagent-runtime-ownership/guide.zh.md) | 新 `subagents.rootOf()` 证明活动运行树。`agent/created` 先于 Activation 注册（`manager.ts` materialize 顺序），不能直接同步替换；创建时先按持久 parentId＋账本建立候选，模型/工具执行前再完成 `rootOf`＋持久直接父子核验。冷恢复允许直接创建者不在线。 |
| 用户中断 | [`SubagentInterruptAuthority`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/subagent/subagent/src/types.ts#L76) 的用户分支只剩 `{kind:'user'}`；[迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.2/subagent-user-controls/guide.zh.md) | 删除 `parentSessionId` 参数。宿主不再替调用方复核父级，停止前必须用真实 catalog/tree 自行复核，补 wrong-parent 负例。 |
| 局部停止 | rc.3 `drainDescendants` 只接受精确子代理树根；普通 member 被忽略，见 `packages/subagent/subagent/src/manager.ts` | 普通 Worker 用中断＋live `whenIdle`。业务 Skill 对自身及原生后代逐一中断并核对静止，不能把业务子会话当树根 drain，也不能误停兄弟运行；本地顶层运行才 drain 整棵树。 |
| 工具目录 | 标准预设为 `tool-subagent-control` 增加 `interrupt:false`，新增 `wait_agent`；[迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.2-rc.1/subagent-interrupt-default/guide.zh.md)。`tools.restrict()` 对未知 allow 名称抛错 | 从 `STANDARD_CODING_TOOLS` 删除 `interrupt_agent`、加入 `wait_agent`，更新 f13 预期。产品自己的中断服务 API 不受模型工具关闭影响。 |
| 标准预设 | rc.3 `standard.patch.yml` 新增 `skill-filesystem.customSkillDirs`、Office 工具行和上述 interrupt 配置 | 以 rc.3 `dsh-web-app` pin 重跑生成器并审查锚点，不手工复制生成物。Office 工具有 Host 用户权限，本轮不加入24私助白名单，不将上游能力自动扩为产品授权。 |
| Agent relay 消息信封 | rc.3 `createAgentMessage` 以模型侧树名生成 `Agent lead sent a message: `，旧版使用 `Agent <sessionId> sent a message: `；可信身份仍在 `source.senderSessionId` | 初版恢复逻辑逐字要求旧前缀，会把补充和恢复输入误判为外来。统一以 senderSessionId＋消息体验证，允许新旧显示名，兼容 rc.1 持久数据。 |
| 优雅停止与补充恢复 | rc.3 Activation 可因父树退休留下 `aborted/parent`；新补充采用 `next-step`，消息体仍按 senderSessionId 核验 | 原运行若已持久进入等待，宿主关闭不等于主人取消；重挂后从执行控制记录的等待历史恢复该事实。用户取消仍停止，不删除取消证据；移除了阻断冷启动采用的“未挂载即返回”。本地／业务崩溃与优雅重启均验证原输入只采用一次。 |
| 工具最终结果通知 | rc.3 `ToolExecutionPipeline.prepare()` 可在 `tools/execute` 前完成 guard 拒绝，`notifyResult()` 异步发布 `tools/result`；通知可能晚于 execute 包装返回 | `WorkerRuns` 在结果边界补记未经过 execute 的真实拒绝，按运行＋callId 关联已有执行，避免成功结果被重复记为 unknown。确定性 `businessExecuted=false` 仍是 failed，不冒充未知；Office 权限不开放。 |
| `exit_plan_mode` 渐进披露 | 当前 `plan-mode` 仅在已选或已进入计划模式时注册 exit 工具，普通首回合不展示 | f13 改为普通回合不期待 exit 工具；不把渐进披露误判为能力删除。 |
| 元数据 | 官方 `apps/cli/package.json` / npm 清单 | 插件改为 `0.2.2-rc.3.1`；engines.dsh、dsh/dsh-schedule peer、web-app devDep 精确 rc.3；Cordis `~4.1.0`、Schemastery `~3.19.0`；Node `>=24.9.0`；锁文件同步。 |

## 静态上无需修改的调用

- **Schedule**：rc.1→rc.3 的 `packages/schedule/schedule/src` 无源码差异。`create(request,actorSessionId?)`、`edit`、`history` 和 `plan-time.ts` 构造器保持；`schedule-bridge.ts` 不改业务时间模型。
- **SessionController**：空数组 prompt 是特定失败回合的 retry，不是通用恢复；24私助没有空调用，现有恢复 marker 保留。原生 Worker 仍由 `origin:'subagent'` 拒绝普通 `resolveAgent`，继续走 `sendMessage`。
- **ToolGuard/NativeToolExecutor**：guard 可返回结构化 denial，但原字符串仍规范化到同样结果；executor 构造、`describe/execute` 未变。现有字符串 guard 和 executor 包装保持。
- **微信专属会话**：`agents.create/resume` 未传已删除的 parent/owner 参数；`weixin-session.ts` 已拒绝 parent/subagent 微信会话。清理其他位置已失效的 `Agent.parentAgent` 类型依赖即可。
- **其余宿主服务**：SessionPersistence、AgentPreset、SkillRegistry 的所用签名未变；Jobs/FS/Attachment 主要是错误类型增强；Workspace 新增归档事件不影响现有 create/list/get/attachSession。
- **浏览器 Slot**：`sidebar.panellist` 仍在 `SlotMap` 中，`ctx.slots.inject` 可继续注册；`uiWorkspace.openSession` 的 `SessionTarget` 保持不变。Sidebar 新增 Factory 和滚动 hook 不要求24私助改注册代码，但需真实浏览器验收。

## 验证要求与边界

实施后以隔离官方 npm rc.3 CLI 运行构建、完整测试、SQLite/PostgreSQL 真实 Host、桌面浏览器及最终 tarball 冒烟。重点覆盖扁平派发、wrong-parent 拒绝、原生 Skill 子任务、业务/本地冷恢复、预算唤醒、局部停止、微信归属和 Schedule。

同版本重启不能证明跨版本恢复：需保留一份由 rc.1 正式旧插件产生的隔离数据，在 rc.3＋候选插件上启动，核验原 session、父 ID、输入只消费一次及投递目标。真实飞书/企微/微信账号、生产 8010 和发布状态不在本轮授权内，不以隔离桩替代真实账号结论。

## 实测记录

以下真实宿主测试均显式使用隔离安装的官方 `@deepseek-ai/dsh@0.2.2-rc.3` CLI（`--version` 已核对），测试 Node 为 `v26.4.0`。模型、飞书、企微和微信均使用隔离桩，没有真实账号操作、生产 8010 升级、commit/push 或 npm/GitHub Release。

- **构建与单元测试**：`npm run build`、`npm run preset:check` 通过。`run-control.test.mjs` 102/102、`worker-run.test.mjs` 36/36（两种数据库）、`subagent-access.test.mjs` 14/14 通过；覆盖实际等待回合、显式取消、错误父级、释放 observation、guard 拒绝、异步结果去重、迟取消和明确未执行分类。
- **SQLite 真实宿主**：`manticore-run-control.e2e.mjs` 19/19、`f06.e2e.mjs` 8/8、`weixin.e2e.mjs` 11/11 通过。覆盖本地／业务崩溃与优雅恢复、权限拒绝、跨入口工具范围、联合备份与退休隔离。另已验证 `f01` 8/8、预算 9/9。
- **PostgreSQL 真实宿主**：`f01`＋`manticore-run-control`＋`manticore-budget`＋`weixin` 共 47/47 通过。
- **跨版本**：`host-upgrade.e2e.mjs` 使用 rc.1 官方 CLI 和旧正式插件 `0.2.2-rc.1.8` 先产生等待数据，再由 rc.3＋候选包恢复；原工作编号、运行编号、父会话、投递目标及两条输入均采用一次。最终 tarball 安装后的独立 Worker／Skill 冒烟及对应测试见命令记录：跨版本 1/1，SQLite `f01`＋运行控制 27/27，PostgreSQL 运行控制 19/19；同一 tarball 另通过手写权限 8/8 与微信 11/11。
- **桌面**：真实 rc.3 Host 中检查24私助侧栏、首页、运行记录、交办详情和真实 Worker 子会话；工具回执及原会话入口可打开。1280×800、1440×900、1920×1080 桌面视口和明暗主题均检查；方向键／Enter 可切换分类与详情，Escape 关闭后焦点回到原运行条目。查阅没有改变运行状态。
- **候选制品**：`artifacts/benz-ai-x-dsh-24pa-0.2.2-rc.3.1.tgz`，159 个文件，压缩约 712.6 kB，解包约 2.7 MB。`package.json` 为 `0.2.2-rc.3.1`，engines.dsh 精确 rc.3，包含生成后的 `cordis.patch.yml` 和最新 `lib`，不包含测试或本机凭据。SHA-256：`9c34f4f6ad5042148ce309aa0f886a84598a7e90e32b9df32d47be3a2ba163e5`。从该 tarball 新建隔离 DSH_HOME/profile，readiness 显示 dsh rc.3＋插件 rc.3.1，普通 Worker 和受管 Skill 均返回指定结果。

主要命令（真实宿主命令均同时设置 `DSH_BIN`；跨版本另设旧 CLI、旧包和最终候选包）：

```sh
npm run build
npm run preset:check
PA24_E2E_STORAGE=sqlite DSH_BIN=<rc.3-cli> npm test
PA24_E2E_STORAGE=postgres DSH_BIN=<rc.3-cli> npx vitest run tests/e2e/f01.e2e.mjs tests/e2e/manticore-run-control.e2e.mjs tests/e2e/manticore-budget.e2e.mjs tests/e2e/weixin.e2e.mjs
PA24_E2E_PACKAGE=<final-tarball> PA24_E2E_STORAGE=sqlite npx vitest run tests/e2e/f01.e2e.mjs tests/e2e/manticore-run-control.e2e.mjs
```

### 未决与明确边界

- 提交 `ddcf61f` 的完整 `npm test`：2007 通过、1 失败、2 跳过。提交 `e1d8d44` 的最终全量为 2010 通过、1 失败、2 跳过；微信 `WX-06/09/10` 出现一次 40 秒投递等待超时，随后完整 `weixin.e2e.mjs` 复验 11/11 通过，未持续复现。首页跨日边界在同一最终轮通过。首页 `manticore-home.e2e.mjs` 在晚间出现一条时间边界失败：夹具把第二个日程固定为“两小时后”，跨日后预期两条、实际一条。该用例已单独复现，与本次适配改动无关，未修改产品代码或测试来隐藏。
- 公开 `startActivation` 不支持 `persona/toolFilter` 透传；旧请求中的这两个字段没有有效宿主作用。权限继续由24私助自己的目录和执行门禁收紧，模型路由继续走公开 `agentOptions`，不臆造新的宿主参数。
- 不验证真实飞书／企微／微信账号、生产部署或 npm 发布状态；`0.2.2-rc.3.1` 是本地候选，registry 安装命令不作为当前可用入口。
- 后续新增功能与兼容性变更只针对 SQLite；PostgreSQL 暂停开发。本文 PG 结果仅证明本轮历史验证，既有实现与历史数据兼容保留，不表示继续新增 PG 专项能力。
