# Runtime / WorkItem / 计划生命周期最后反证复核

基线：main `0ef85772a10f45e8e3b4c4d2c85d7249bf28e256`，隔离 checkout `/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA`。

**结论：本轮没有发现可证实的新独立问题。** V16 仍为 P1，V23 仍为 P2，不增加既有 23 项计数。可以收束审查、转入先修 P1 的 TODO。

**方法：本轮是有界源码及既有测试源码复核，没有新增实测，也没有重跑全套。** 下文引用前轮真实 Loader / 双账本证据时单独标明。产品源码和仓库文档未改，未建 Issue/PR；未进入此前安全检查中止的出站/知识专项。HEAD 与基线相同，隔离 git status 仍仅先前的 node_modules 链接。

## 相邻路径反证结果

| 路径 | 本轮阅读的实际保护 | 结果与限制 |
|---|---|---|
| finish 与 stop 的交错 | `src/work-item-lifecycle.ts:19–22,93–105,115–122` 用同一串行 gate；finish 重新读取 status 和 generation；stop 先保存 stopped 再 interrupt | stop 已持久后晚到 finish 不改回 completed；未发现独立反例。finish 保存失败仍归 V16 |
| 停止后继续，旧回合晚到 | `src/work-item-lifecycle.ts:53–68` 等原 child quiesce 再递增代次；`src/runtime.ts:1261–1281,1631–1635` 核验本代输入 messageId 被实际消费 | 旧回合不能结束新代；`tests/unit/runtime-ownership.test.mjs:84–93` 有对应断言，本轮只读未重跑 |
| 重复完成事件与一次投递 | `src/runtime.ts:1593,1629–1635` 按 Session 串行并重读；`src/repo/work.ts:51–61` 状态变更与结果 Outbox 同事务，已不在 running 则不再写 | 无额外重复投递反例。现有 `tests/unit/work-item-lifecycle.test.mjs:69–74` 主动再次 finish 的用例不能证明生产自动重试，仍是 V16 覆盖缺口 |
| 完成期间新补充输入 | `src/runtime.ts:1625–1632` 先分别结算实际消费的输入，再核验当前执行输入；`src/inbox-lifecycle.ts:91–121` 保存各输入结算回调 | `tests/unit/runtime-ownership.test.mjs:152–168` 验证旧输入完成不抢新输入；未见新增独立反例 |
| 在途工具被 stop 后切换工作区 | `src/workspace-execution.ts:14–24,31–42` lease 保留整个调用；`src/runtime.ts:815–816,858–874` 活动工作阻止切换，准备后复核再激活 | 在途回执先写原账本，切换等待；`tests/unit/runtime-ownership.test.mjs:18–30` 覆盖。未把旧面板/旧会话已有缺陷重复计数 |
| 原生事件与工作区切换 | `src/workspace-execution.ts:45–47` 等切换完成；`src/runtime.ts:1588–1594` 捕获 binding 并重验 | 不能将一个已捕获旧 binding 的回合结算写入新工作区；本轮未新增动态交错探针 |
| 关闭及 late work | `src/runtime.ts:717–767` 停接纳、abort、等待生命周期/原生退休，再关闭 executions、计划、Outbox、数据库；`src/workspace-execution.ts:54–60` 等已接纳调用 | 关闭不先释放仍被执行使用的 DB；`tests/unit/runtime-ownership.test.mjs:32–41,65–73` 有等待断言。关闭前未持久的完成事件恢复仍需要 V16 修复覆盖，不另立新项 |
| 计划操作与恢复、切换 | `src/plan-lifecycle.ts:28–37,113–125` 准入时捕获 repo/native，同计划串行；`src/digest-service.ts:88–100` 等完整已接纳操作和监督 | `tests/unit/plan-lifecycle.test.mjs:107–116,143–157` 覆盖首次读取及在途创建也被等待；无新增独立反例 |
| 监督暂停与告警恢复 | `src/digest-service.ts:641,648–655` 仍先停止再通知，active-only 后续扫描 | 现有 V23，没有新增根因；不作为 V16 的修复前置 |

本轮排除的是具体候选，没有宣称“所有竞态已穷尽”。未执行新断电、底层文件系统损坏、永久宿主挂起、真实外部副作用或完整 SDK/OS 组合测试。

## V16 修复 TODO：先后依赖与验收

### 0. 固定基线与完成标准

- [ ] 将已有真实 Loader 失败复现转换为最小回归入口，保留 `DEFAULT_CONFIG.maxWorkers=2`、两个已完成 Worker 占满槽位、第三项排队这一场景；先让测试在当前 main 失败。
- [ ] 明确“原回合结算完成”的身份至少关联原 workspace、WorkItem、原 child/parent、恢复代次、实际消费的启动或续办消息、turn 和结果正文。拒绝凭最新 turn、当前配置或当前时间猜关联。
- [ ] 为关键计数建立观测：原回合模型调用数、Worker 启动/续办输入数、受控外部操作次数、结果 Outbox 数、generation 与队列状态。

依赖：这是后续实现和验收的前置；不先用“重启后又完成了”替代正确的失败测试。

### 1. 收拢可恢复的原回合证据

- [ ] 在 WorkItem module 内收拢原生完成事件归属及待结算责任，保留当前已核验的身份与结果，不让唯一 turn/end 事件在 catch/warn 后成为不可恢复的内存事实。
- [ ] 核实宿主持久 Session 历史的公开冷读能力及 flush 成功语义；确认哪些证据可从冷启动恢复，哪些需要业务账本保存。当前 `executionMessages` 为内存关联，不能直接假定重启仍可使用。
- [ ] 设计数据库暂时不可写时的恢复来源。仅新增同一 DB 中的一次 INSERT 而没有失败后的重取路径，不能覆盖原故障；仅把闭包放内存 Map 也不能覆盖进程退出。
- [ ] 原回合证据缺失或无法证明归属时保留明确待核对状态，不能伪造完成、猜测结果，或盲目重跑工具。

依赖：先完成本步，再引入冷启动的自动结算。需要迁移时，先完成兼容迁移与双后端事务验证；本轮不指定新的 interface 签名或 schema。

### 2. 在同一存活进程自动补结算

- [ ] 结果与 Outbox 继续同事务提交；重复处理同一完成证据只留一份结果投递。
- [ ] 失败进入有界重试/对账，不靠宿主重复发送 turn/end，也不靠主人发送新输入或手工再次调用 finish。
- [ ] 数据库恢复后，原两项在原 generation 内结算并释放容量，第三项自动启动。持续故障要可见，不能忙循环或无限重投外部动作。
- [ ] 某一项的结算失败不阻断其他可处理事项；既有并发限制仍成立。

依赖：1。**必需验收：无 Host 重启、无人工 stop/continue、无新模型回合；两个原事项各一个结果 Outbox，原 generation 不变。**

### 3. 接入冷启动、停止、晚到和工作区关闭

- [ ] 重启先核对已持久的原回合完成证据；存在可核验完成证据时只补结算/投递，不发新代续办输入。
- [ ] 只有原工作确实未完成或证据不足时，才保留现有明确恢复代次续办或待核对路径；对外说明这属于续办。
- [ ] 用户 stop 与补结算交错：停止状态不复活，仍保留已发生的外部回执；旧代补结算不能结束或覆盖用户明确开启的新代。
- [ ] 续办输入 A/B 交错时，恢复只结算该完成回合实际消费的输入；不抢占 B 的状态。
- [ ] 工作区 A 完成证据只能补写 A 的账本与原投递目标；切换到 B 后不得依靠动态当前 repo 写入 B。
- [ ] 关闭有界排空或留下可冷恢复的承诺；关闭时数据库仍失败、回合已完成但进程退出等断点，不应靠删除队列/伪完成退出。

依赖：1 + 2。保留既有状态/generation/binding/lease 检查，避免通过放宽归属条件修复重试。

### 4. 最小必需验收矩阵与交付顺序

| 必需验证 | 通过条件 |
|---|---|
| SQLite / PostgreSQL 原回合结果落账故障 | 故障解除后同进程自动补原回合，结果/Outbox 原子，原 generation 不变 |
| 默认 2 槽位 + 第 3 项排队 | 自动补结算释放全部假 running，排队项开始；不需要用户干预 |
| 重复 turn/end、重复 tick、重复重启 | 一份业务结果、一个稳定投递意图，不重复模型或外部动作 |
| 落账前 / 事务中 / 已提交后未完成本地确认时重启 | 使用已证实原回合结果恢复；已提交不会再次投递；无法证明则待核对 |
| stop / continue / 旧代晚到 / 新补充输入 | stopped 不复活、旧代不覆盖新代、输入分别归属 |
| 工作区切换 / 关闭等待 | 原回执不串 workspace；DB 不在使用中关闭；待处理承诺可恢复 |
| 实际外部动作回执的受控 adapter | 确认成功的动作调用次数保持 1；未知结果不盲重放；此项需独立验证，不能从只读 memo 推断 |
| 失败和无结果回合 | 如实结算 failed 并释放容量，不把失败伪报 completed |

顺序：**基线回归 → 完成证据及关联契约 → 同进程自动结算 → 冷启动与竞争处置 → 双后端 + 真实 Loader 验收**。V16 不需要等待 V23 修复；V23 可以随后复用耐久意图/恢复原则，但不要先搭泛化调度框架。其他 P1 可独立推进；触及 Runtime/账本的变更合入后，再跑一次针对上述 seam 的集成验证。

## 已有证据与修复后必须区分的两条路径

- 前轮真实 Loader 证据：`/tmp/pa24-final-p0-runtime-probe.mjs`、`/tmp/pa24-final-p0-runtime-result.json`。当前代码在同进程故障解除后仍 2 running + 1 queued；普通同 profile 重启后原两个 Worker 到 gen1，三项都完成、Outbox sent。**这证实新代续办可以恢复可用性，没有证实原回合自动结算。**
- 修复验收主路径：故障解除后，gen0 的原完成回合就完成持久结算，且模型回合、续办输入及外部调用计数不增长。
- 现有事务单测 `tests/unit/work-item-lifecycle.test.mjs:69–74` 主动再调 finish 已通过，验证的是事务和幂等能力；新增回归必须经过生产的原生事件 interface，覆盖谁负责重试及重启取证。
- V23 双账本证据保留在 `/tmp/pa24-deep3-lifecycle-supervision-result.json`。其告警意图恢复独立于 V16，无新增计数。

深化后的 WorkItem module 应承担完成证据、原归属、重试和恢复的复杂性。删除它后这些规则会散回事件回调、tick、启动与控制调用方，符合 deletion test。这样提高 locality，并使真实 Loader、双账本 adapter 与日常调用者通过同一 interface 获得 leverage；单纯增加一个 finish wrapper 不够。
