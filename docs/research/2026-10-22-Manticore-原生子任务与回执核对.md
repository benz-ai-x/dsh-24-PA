# Manticore：原生子任务与回执核对

日期：2026-10-22。对应 M01b / #214。本文只研究宿主公开契约，不修改产品实现、正式规格或权限决策。

## 结论与证据范围

本地 Skill Run 可以保留标准 subagent、workflow、ralph 和 bash 后台作业能力。一个 Run 需要覆盖实际执行顶层 Session、它的原生子任务及作业，且可跨多个由真实通知唤醒的原生 turn。首次原输入的 `turn/end completed`、工具成功返回启动 ID、Session 不再驻留，均不能单独证明整个 Run 已完成。

| 项目 | 本次基线 |
| --- | --- |
| 宿主一手源码 | `deepseek-ai/deepseek-harness`，`1600d8a1e140dcde43a1a0941940a0480712c011`，package 版本 `0.2.1-rc.1` |
| 本地路径 | `/Users/pc2026/DSH-Space/deepseek-harness`；研究前后 `git status --short` 均为空 |
| 24PA 工作区 | `/Users/pc2026/.codex/worktrees/manticore/dsh-24-PA` |
| 已读约束 | product、domain、根 GLOSSARY、ADR-0001、[既有手工运行研究](2026-10-20-Manticore-M01b-手工运行研究.md) |
| 验证层级 | 源码核查＋372 项针对性宿主测试；包含真实服务、原生日志/持久化及受控模型/生产者替身，不等于24PA产品 E2E、真实业务账号验收或任意外部 CLI 副作用对账 |

本地顶层能力与业务 Worker 白名单仍遵守 [ADR-0001](../adr/0001-workspace-session-boundaries.md)。下文的“归属”用于记录和停止原生工作，不是给 Worker 扩大权限，也不修改子 Agent 的真实父会话。

本次重新核对了该 checkout 的源码和已构建 `packages/core/tools/lib/index.js`：导出的常量名 `TOOL_ABORTED` 的**实际 error code 值是 `ABORTED`**，`TOOL_ABORTED_BEFORE_DISPATCH` 的值是 `ABORTED_BEFORE_DISPATCH`；这与根代理当前真实宿主测试观察一致，不是版本漂移。不要拿导出变量名比较 `error.info.code`。本次未重新验证机器上其他 npm/global 安装版本；既有研究提过的旧安装包与此固定 checkout 不能混用。API 可用性和事件字段仍需以正式部署宿主实测确认。[源码常量](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L484)。

## 可直接使用的发现与读取接口

### 子任务目录

```ts
const rows = await ctx.subagents.listDescendants(root.id, signal);
// kind === 'child':
// { id, parentId, depth, mode, activity, hasChildren, label? }
// mode: 'continuable' | 'one-shot' | 'external'
// activity: 'running' | 'inactive'
// kind === 'diagnostic':
// { id, parentId, depth, reason: 'corrupt' | 'unsupported' | 'unavailable' }

const direct = await ctx.subagents.listChildren(parentSessionId, signal);
// { id, createdAt, mode, label? }[]；mode 还可能是 'unknown'
```

`listDescendants` 从父 Session 自己的 `subagent/catalog` 遍历，不枚举无关 Session、不创建或恢复 Agent。外部执行是无本地 Session 的叶子；不可读分支返回 diagnostic，根失败/服务缺失/取消直接 reject。必须保留 diagnostic，不能当空列表。`activity` 仅看 `ctx.sessions.get(id)` 是否存在：外部任务即使活跃也可能是 `inactive`，本地 idle Session 仍可显示 `running`。目录只证明成员身份，不证明执行结果。[公开服务](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/index.ts#L395)、[遍历实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/list-children.ts#L53)、[字段契约](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/control-types.ts#L26)。

### root 与本地子会话的只读历史

```ts
using observation = await ctx.sessionQuery.observeSession(sessionId, {
  signal,
  projectionMode: 'none',
});
const { header, inheritedEventCount, events, cursor, source } = observation;
// source: 'live' | 'prepared'
// cold prepared observation 另外提供 revision；不会唤醒 Agent。
const ownEvents = events.slice(inheritedEventCount);
```

它提供同一个不可变观察切面的 header、完整事件、继承事件数和 cursor。对本地子任务，核对 `header.id === row.id`、`header.parentSession === row.parentId`、`header.origin === 'subagent'`，只结算 own suffix；fork 的祖先 tool/job/catalog 不能算成子任务新动作。工作目录仍按实际宿主工作目录与 Run 授权范围核验，不应假定合法本地委派必然不能指定另一个 cwd。[观察类型/实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/session-query/session-query/src/observation.ts#L18)、[catalog 排除继承事实](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/catalog.ts#L120)。

冷读对崩溃尾部附加确定性的、仅内存中的 `interrupted` 和缺失工具结果，不写回。也可以使用既有 `sessionPersistence.open(id, 'read')`＋`handle.read(0)`＋`handle.close()`，但要自行处理原始未闭合尾部。不能为了读结果调用 `resolveAgent` 并意外改变生命周期。[冷读实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/session-query/session-query/src/cold-read.ts#L24)。

本地 child 结束时移出 live Agent/Session store；这不是删除持久文件。manager 会请求 final flush，失败只告警，因此“子任务结束”也不证明日志已经完整保存。历史 one-shot 仍可按目录读取持久 Session；缺失/损坏要保留未知状态。本次 `list-children` 测试覆盖 settled local/cold/one-shot 目录，而外部执行不应尝试读取不存在的 child Session。[AgentHandle 契约](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/index.ts#L146)、[best-effort flush](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/manager.ts#L1208)。

### 作业查询与归属

```ts
const owned = ctx.jobs.list(ownerId).filter(job => job.owner === ownerId);
const view = ctx.jobs.get(jobId, ownerId);
const output = ctx.jobs.readAt(jobId, fromByte, ownerId);
// output: { chunks: [{ at, text, channel?, gapBefore? }], next, lossy }
```

`list(ownerId)` 还会返回 unowned job，必须再按 owner 精确过滤；顶层 Run 要遍历自己及每个已核实本地 descendant 的 owner。`get` 返回 `JobView`：`id/kind/label/owner/status/progress?/detail?/startedAt/finishedAt?/output`。`output` 是 `{total, earliest, spillPaths?}`。JobView **没有** `toolCall`、`producerReported`、workflow 最终 `result`。[jobs 公开接口](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs/src/index.ts#L125)、[JobView](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs/src/view.ts#L84)。

每个 owner 的 own Session 事件提供更完整的归属：

```ts
// event.type === 'job/registered'
event.data = {
  jobId, owner, kind, label, startedAt,
  toolCall: { callId, rootCallId }, // producer 未经工具创建时可缺失
};
// event.type === 'job/settled'：上述字段外再加
event.data = {
  ...registration,
  finishedAt,
  status: 'completed' | 'killed' | 'failed',
  cause: 'producer' | 'kill' | 'teardown',
  producerReported: true | false,
  detail, // 可缺失
};
```

用 `(owner, jobId)` 关联作业，`toolCall.callId/rootCallId` 关联 Run 内工具调用。nested/PTC 调用也携带 rootCallId。不能从 jobId 字符串、label 或某一时刻目录差集猜创建调用。[事件类型](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs/src/types.ts#L16)。

`producerReported === false` 表示生产者拒绝或被注册表强制失败，不能声称底层资源已经释放。`true` 也只证明生产者提供了终态，不独立证明外部业务成功。bash 的非零退出码也映射为 job `completed`，失败信息在 `detail` 的 `exit code: N` 和工具输出中；`completed` 在此表示进程结束。[生产者契约](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs/src/types.ts#L196)、[bash outcome](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/shell/tool-bash/src/background.ts#L33)。

job 注册/结束先尝试追加 owner Session 事件，再通知 live subscribers；append 失败会被包含并告警，不能用 callback 出现反推落盘成功。`ctx.jobs` 是进程内注册表：重启后 live `get` 不存在不等于原 job 完成。已有 registration 无可靠 settlement 时不得自动重跑。[记录实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs-local/src/index.ts#L443)、[settlement 顺序](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs-local/src/index.ts#L603)。

`readAt` 不移动模型游标，适合面板/Run 记录。`read` 会消费游标，只有首次 terminal read 得到 `JobOutcome.result`（workflow 返回值）；观察者不能抢先消费它。正常运行的自动核对也不宜用 `jobs.wait`：settled 时会报告 `awaited:true`，宿主会认为结果已被读取而抑制给模型的 completion notice。停止时使用 wait 则合适。[read/wait](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs/src/index.ts#L143)、[通知抑制](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/tool-jobs/src/index.ts#L272)。

## 工具返回、生命周期与消息的确切形状

| 操作 | `tools/execute` 成功返回中的 `value` | 结算还需核对 |
| --- | --- | --- |
| 原生 subagent 工具 | `{kind:'activation', subagentId}` | 真实目录、child 自己的日志及 `subagent/end`；返回只确认已接纳 |
| bash 后台/前台超时晋升后台 | `{kind:'background', jobId, cwd}` | job 归属、结束回执和退出状态 |
| workflow 后台 | `{kind:'background', jobId, runId}` | job 结束、成员结果、workflow 返回值 |
| workflow 前台 | `{kind:'foreground', runId, agentsStarted, result}` | 工具最终结果与成员生命周期；内部脚本可处理失败 child 并返回正常值 |
| ralph | `{runId, agentsStarted, result}` | 正常返回的 `result.status` 为 `complete/blocked/budget-limited`；不等于独立验收通过。`round-failed` 被工具转换为 error |

来源：[subagent tool](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/tool-subagent/src/index.ts#L265)、[bash schema](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/shell/tool-bash/src/index.ts#L197)、[workflow schema/返回](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/workflow/tool-workflow/src/index.ts#L376)、[ralph execute](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/experimental/tool-ralph/src/index.ts#L434)。

前台 workflow 与 ralph 都基于 workflowEngine，并用 `delivery:'caller'` 启动子任务；这些子任务仍进入实际 parent 的 catalog，但不会向父注入 `subagent-settled`，结果由 workflow 收集。workflow 子的直接 parent 是启动 workflow 的 Agent。后台 workflow 使用独立 job 生命周期，不再受已返回工具 step 的 signal 控制。[workflow child](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/workflow/workflow-ptc/src/host.ts#L199)、[后台启动](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/workflow/tool-workflow/src/index.ts#L249)。

顶层 workflow 调用可在 parent own 日志读到 `tool-workflow/run-start {runId,name}`、`agent-start {runId,seq,label,phase?,childId}`、`agent-end {runId,seq,outcome}`、`run-end {runId,stopReason}`。它是额外证据：nested workflow 不保证有这些记录，ralph 没走该 recorder，记录失败也不会终止执行；不能以没有记录判定没有子任务。[记录类型](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/workflow/tool-workflow/src/types.ts#L14)、[recorder](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/workflow/tool-workflow/src/index.ts#L90)。

### 子任务生命周期

在每个已归属 Agent 的 scoped context 注册，闭包保留该真实 parent 与 Run，而非根据名字猜 parent：

```ts
scope.on('subagent/start', info => {
  // { runId, provider, id, local }
  // runId 是一次 activation 的身份；id 是 child Session/外部执行身份。
  recordStartForKnownParent(parent.id, info);
});
scope.on('subagent/end', info => {
  // { runId, provider, id, local, stopReason, lastAssistantMessage? }
  recordEndForKnownParent(parent.id, info);
});
```

`record*` 为24PA待实现的记录边界，不是宿主 API。两个事件用同一 delegating parent 作为 scope carrier，payload 不自带 parentId。回调是 emit、不会 await；同步异常和返回 promise 的 rejection 都被包含。须把持久写入纳入 Run 自己的待完成写队列/结算屏障；丢失回执时仍是未知。仅启动 ID/canonical value 可关联 child，不提供完成结果。[事件定义](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/index.ts#L144)、[配对字段](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/types.ts#L91)、[emit containment](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/lifecycle.ts#L53)。

`stopReason` 已知值为 `completed/aborted/error/max-tokens/refusal`，可扩展的未知值不能视成功。外部 provider 没本地 Session；`subagent/end` 的原始记录尤其必要。manager 在 cleanup 失败时把 end event 改成 error，但 parent settlement notice 仍可能携带此前捕获的 completed 结果，因此不能仅解析通知正文“finished”结算。[capture/cleanup/notify 顺序](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/manager.ts#L1094)。

### pre-step 与多轮归属

`agent/pre-step` payload 为 `{agent,messages,turn,step,signal}`。`messages` 是该步真实领取的 inbox 批次；先持久全部输入，再做归属判断，拒绝也不能丢失这批证据。通过 `next()` 返回的 `decision.messages` 还包含 runtime-context、time-context、skill-catalog 等宿主上下文，不能把所有 user-role 消息视为新的主人交办。[pre-step 实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/src/agent.ts#L267)。

| 来源 | 结构与归属检查 |
| --- | --- |
| root 首次输入 | `source.kind === 'user'` 且 rpcId/messageId 匹配 Run 已登记的原输入 |
| 原生初次 child 输入 | manager 用 `{kind:'user'}`，没有 rpcId；依据真实创建关系和当次 child admission 记录该 messageId，不能照搬 root rpcId 白名单 |
| 子/父模型消息 | `{kind:'agent-message',form:'relay',senderSessionId}`；核验真实直接邻接和 Run 子任务归属，内容仍是子代理报告 |
| 子结束通知 | `{kind:'subagent-settled',form:'notice',summary,senderSessionId}`；核验已知 child/activation 的结算依据 |
| 作业结束通知 | `{kind:'tool-jobs',form:'notice',summary}`；没有结构化 jobId，保存消息身份，并用本 owner 的 job 账本关联；不能靠正文猜 job 身份 |
| Skill 上下文 | `{kind:'skill-invocation',name,form:'instructions'}`；是宿主注入的说明，不是新增授权 |

来源：[初次 child admission](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/manager.ts#L458)、[agent-message 与 settlement source](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/continuation-messages.ts#L14)、[job source](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/tool-jobs/src/index.ts#L285)、[skill source](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L146)。

**实现建议（由上述事实推导）**：Run 输入表从单个原输入扩为“原输入＋经核验的原生回传”。每条保存 messageId、source、sessionId、是否接纳及消费它的 turn。只允许这些已登记输入引起同一 Run 的后续回合；额外 human queue/steer 仍留待核对，不并入原 Run。对已登记输入所触发的全部 turns 结算，最后结果取最新 Run-owned turn 的实际 assistant 输出，而非锁定第一次 turn 或全 Session 任意最后回复。

## 工具回执不能只看 isError

`tools/execute(exec,next)` 的 `next()` 返回 `ToolExecutionResult`：成功 `{isError:false,value,content,meta?,additionalContexts?,concludesTurn?}`，失败 `{isError:true,error:{message,info?},content,...}`。`exec` 有 `agent/callId/rootCallId/name/arguments/signal/token/parent?`；token 为 opaque Symbol，不应入库。调用前写 intent，调用后保留 canonical value，能够从 subagent/job 启动结果得到精确身份。[类型](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L387)、[结果联合](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L573)。

之后仍有 post-execute、内容投影和取消检查。`tools/result` 才是冻结的最终结果，但 listener 不被 await：

```ts
scope.on('tools/result', (exec, result) => {
  // exec: Readonly<ToolExecution>
  // result: Readonly<ToolExecutionResult>
  enqueueFinalReceipt({
    sessionId: exec.agent?.id,
    callId: exec.callId,
    rootCallId: exec.rootCallId,
    name: exec.name,
    result,
  });
  return undefined;
});
```

`enqueueFinalReceipt` 是24PA拥有的、可在 Run 结算前等待并检查失败的队列。不能把 `async` listener 返回视为宿主帮忙等待 DB。保留 dispatch receipt 与 final receipt 两个事实；final error 不能擦掉已经发生的启动或写入。原生 `tool/result` 有 content、isError、可选 `data.error {name,code,reason?}` 和 meta，刻意没有 canonical value。nested/PTC 通常记录 `tool/ptc-dispatch`，也不能指望普通 Session `tool/result` 完整重建全部 nested value。[最终通知](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1649)、[listener 不等待](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1703)、[持久结果字段](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/session/src/types.ts#L376)。

| 回执 | 可证明什么 | 不能据此做什么 |
| --- | --- | --- |
| `ABORTED_BEFORE_DISPATCH`（常量名 `TOOL_ABORTED_BEFORE_DISPATCH`） | live pipeline 核定该工具 body 尚未调用 | 不代表更早的其他调用没有副作用 |
| `ABORTED`（常量名 `TOOL_ABORTED`） | body 已进入；宿主等待 body quiescence 后以取消覆盖结果 | 不能标成“未执行”或自动重放 |
| `TOOL_OUTCOME_UNKNOWN` | 原日志记录了 call，未持久记录结果；属于恢复补全 | 不能把合成 tool/result 当实际失败回执 |
| `TOOL_NOT_STARTED` | 所读日志前缀没有该请求的 tool/call | 不能覆盖24PA已有 dispatch intent；fork 中更不能证明源会话后来未执行 |
| 普通 `isError:true` | 工具/包装/输出校验/策略某处失败 | 不证明 body 未执行或外部写入没有发生 |
| `isError:false` | 工具返回了合法 canonical result | 对启动型工具不代表子任务完成，对任意 Shell 不代表内部远端业务验收通过 |

`tool/call` 是 AgentLoop 的 append，未在每个调用前强制 await flush；所以 crash 后较短持久前缀的 NOT_STARTED 不能否定24PA自己持久的 dispatch intent。必须优先合并自己的调用账本、真实平台回执与原生日志，而非只数“每个 call 都有一条 result”。[body/取消](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/tools/src/index.ts#L1558)、[恢复算法](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/session/src/repair.ts#L157)、[call append 与 dispatch](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/src/tool-calls.ts#L165)。

## 完成、停止与恢复方案

以下为实现建议，基于上面的公开契约，不新增产品授权：

1. Run 持久绑定独立 root Session；在实际 `agent/created` 屏障给 root 和经核验 descendant 安装记录/门禁，保持其真实权限。所有调用先有 intent。每个 `(sessionId,callId)` 保留 rootCallId、canonical/最终回执、child/job 身份。
2. root 原输入 completed 后，如仍有原生 child、job、未消费回传或未决调用，Run 保持运行/等待。可以 `await ctx.subagents.waitForChildren(root)`，然后重新 `await root.whenIdle()`；该接口覆盖正在建立和执行的 external/local descendants，却刻意不等待 idle parked inbox，故还要核对各 own inbox。
3. 逐个读取 root/descendant own logs，核对归属、输入消费、工具结果、job registration/settlement、最新 turn/end；检查记录队列完成及 flush 成功。pending 输入、diagnostic、缺失日志、已启动无可信结果、producerReported false，均不能归入完成。
4. 只在 root 无新执行、所有已接纳输入已结算、全部子任务/作业有充分终态证据、没有未决动作，并取得最后 Run-owned 结果后落终态。此判定应在 Run 的串行结算/执行屏障中复查，防止 root 原回合结束和 child notice 到达之间提前关闭。
5. 恢复先读历史，不自动唤醒/重投。如果只是原输入尚未消费，沿既有已验证的 pending 恢复协议；已消费的中断回合、失去 handle 的未结算 job/external child 进入核对，不新建 Run 绕过它。按原快照/当前配置重跑仍受原目标链未决动作约束。

`waitForChildren(parent)` 返回 boolean，只说明本次是否加入了进行中的工作；它不是“所有历史后代均成功”的证据。原生 `foldConsumedWork(events)` 能识别有消费的 turn 和 cancelled-but-unrun 输入，可作为核对辅助；不能替代 Run 自己的 messageId 归属表。[等待实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/manager.ts#L252)、[消费事实 fold](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/consumed-work.ts#L63)。

### 停止的公开调用

```ts
// 先由24PA持久标 stopping，关闭新输入/工具 admission，再操作真实宿主。
ctx.sessionController.cancel({ sessionId: root.id });

// 完整终止一个 Run 的子任务树：同时关闭该 exact Agent 的后代 admission。
await ctx.subagents.drainDescendants([root]);

// 对 root 自己的 jobs（以及未成功释放的 descendant owner）逐个处理。
for (const job of ctx.jobs.list(root.id).filter(j => j.owner === root.id)) {
  if (job.status !== 'running' && job.status !== 'stopping') continue;
  ctx.jobs.kill(job.id, root.id, '24PA Skill 运行已停止');
  const after = await ctx.jobs.wait(job.id, 1000, root.id, observationSignal);
  // 超时返回仍 running/stopping 是继续观察；不能标成 stopped。
}
await root.whenIdle();
await ctx.sessions.flush(root.session);
// 最后核对所有终态和未决副作用，才能决定 stopped / needs_reconciliation。
```

实际实现可先启动 drain 与 job kill 再等待，避免一个迟缓分支挡住其他分支发出停止请求；所有分支结果均需收集。`drainDescendants([root])` 接受 exact live Agent，停止可见后代及已接纳的建立过程，child-first await 资源释放；对其他 root 无影响。该 admission cutoff 保留到此 root 离开 registry，因此适用于本次 Run 终止，不能用于未来准备在同一 Agent 继续执行的“暂停”。[服务契约](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/index.ts#L363)、[实现](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/manager.ts#L296)。

单独 `ctx.subagents.interrupt(childId, {kind:'ancestor',agent:root})` 只中断该 child's 当前执行，保留 descendants 和 pending inbox；返回 void 也不是 quiescence。`drainChildren(parent, childIds)` 只释放指定直接 child 及其拥有的 descendants，不关闭整个 parent 的新委派 admission。原顶层 `controller.cancel` 只 cancel 当前 Agent 且 `keepInbox:true`，不会级联停止已经脱离工具 step 的 background jobs。[interrupt](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/subagent/subagent/src/index.ts#L344)、[root cancel](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/api/session-controller/src/commands.ts#L492)。

child Agent disposal 会取消并 await 该 Agent 自己的 jobs。cancel 抛错时 registry 可强制失败、producerReported false，并明确指出可能 orphan；所以 drain/kill 出错或没有终态不能显示已安全停止。进程硬杀后的任意外部命令也没有通用公开 API 可以证明其远端副作用被撤销；仍靠原动作对账而非缩减标准工具能力。[owner cleanup](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs-local/src/index.ts#L642)、[forced failure](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/jobs/jobs-local/src/index.ts#L690)。

## 本次验证与产品待验证项

在固定宿主 checkout 中运行现有针对性测试，未修改源码或生产配置，全部进程已终结：

| 命令范围 | 实测 |
| --- | --- |
| `list-children.spec.ts`、`parent-result.spec.ts`、`external-lifecycle.spec.ts`、`jobs-local/tests/jobs.spec.ts`、`session/tests/repair.spec.ts` | 5 文件，160 passed；[日志](/tmp/manticore-native-recovery-source-tests.log) |
| `subagent/tests/continuation.spec.ts`，名称过滤 `drain\|interrupts only the target\|deep exact live ancestor` | 11 passed、149 skipped；[日志](/tmp/manticore-native-stop-tests.log) |
| `tools/tests/tools.spec.ts`、`tool-jobs/tests/tool-jobs.spec.ts` | 2 文件，201 passed；[日志](/tmp/manticore-native-receipt-tests.log) |

调用形式均为 `node node_modules/vitest/vitest.mjs run <上述文件> --reporter=dot`；第二组另用 `--testNamePattern`。测试验证宿主实现事实，不替代24PA门禁和账本事务的集成验收。

M01b 仍应补真实 Loader 的产品测试：root 原回合先结束、子任务稍后回传并完成第二回合；两个子任务交错消息；后台 bash/job 完成唤醒；workflow caller-delivery；ralph 结束与失败；nested job 与 descendant job 归属；停止期间仍在建立的 child；停止 root 不提前显示已停；重启后未决 job/external child 不重放；在工具 body 返回、最终投影、原生日志 flush 与24PA回执落库之间分别故障；所有测试同时检查 Run/WorkItem 与原目标链的防重行为。

## 产品集成补充（2026-10-22）

真实 Loader 实测补充了三项实现条件：

1. `parentAgent` 是 Agent 创建参数，不是运行时 Agent 的公开属性。真实父子归属须结合 header 与 `ctx.get('agents').get(parentId)`、`isOwnedBy(childId, exactParent)`。见固定源码 `packages/core/agent/src/index.ts:573`。
2. `subagent/start` 在 `establishCatalogChild` 之前触发。先保留原始 activation ID 和作用域候选，在目录落盘后按真实父会话保存回执；不能因事件当刻查不到目录就丢弃启动事件。见 `manager.ts:956` 与 `manager.ts:468`。子 Session 在结束期间可能已经关闭持久句柄，`SessionHandleClosedError` 分支应冷读原文件；其他 flush 错误仍不能当成功。
3. 原生子任务在父工具返回后继续执行，不能继承24PA该次工具调用的 AsyncLocalStorage lease；父调用仍保存意图和回执，原生执行在 detached 边界启动，子任务的实际工具调用取得独立工作区 lease。初始集成测试捕获了过期 lease 拒绝，已据此修复。

SQLite 与 PostgreSQL 各 14 项真实 Loader 测试已通过（`tests/e2e/manticore-skill-run.e2e.mjs`，日志 `/tmp/manticore-complete-sqlite.log`、`/tmp/manticore-complete-pg.log`）：包含固定版本与重启回读、真实工具回执、禁用期间在途继续、取消不当撤销、外来输入保留、零模型模板、后台作业唤醒与停止、原生子任务回传和工具写入、子任务树停止、子任务越权拒绝、业务 WorkItem 原入口回传、缺依赖拦截与模板转换。人工核对用真实中断写文件验证：保留原 unknown，记录部分完成依据后新建接续运行，仅补写剩余一行，并验证核对结论已进入模型输入。模型由受控 SSE 替身驱动，文件动作及宿主/数据库真实运行；不是外部账号验收。其他未列出的场景继续保留为待验收项。

核对记录按当前原生证据内容保存指纹，双库事务测试覆盖遗漏动作拒绝、请求防重、原回执保留和迟到新回执使旧核对失效。新建手工运行也检查同 Skill 的未决旧运行，不能换交办 ID 绕过；平台操作账本未决仍阻断人工结案。源文件采纳额外比较实际包正文与已查看定义，原生发现缓存未刷新也不能复制未审查的新正文。模板智能副本保留资源与正文、清空工具声明，转换和重复复制回执不调用模型。
