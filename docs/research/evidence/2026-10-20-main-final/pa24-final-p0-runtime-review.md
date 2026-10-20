# main 最后一轮 Runtime / 生命周期 P0 复核

基线 `0ef85772a10f45e8e3b4c4d2c85d7249bf28e256`，只读隔离 checkout `/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA`。本轮此范围 **没有已确认 P0，也没有新增独立缺陷**。新增证据扩大既有 V16 的影响范围，建议 **V16 从 P2 升为 P1**；V23 保持 P2。普通启动及同 profile 重新启动已实际成功，不据此保证全部部署和外部副作用无风险。

## 本轮实际执行

通过真实 dsh CLI / Loader、真实 Session / continuable child、公开 panel snapshot 与 session/prompt 入口执行。模型由 loopback 脚本提供，唯一 Worker 操作为读取空的本地记忆；没有真实平台调用。安装过程设置 npm offline，状态与 workspace 都在临时目录。

使用完全未改动的 `DEFAULT_CONFIG`：mode=demo、storage=sqlite、maxWorkers=2、enabledWorkers=[memo]（`packages/24pa/src/config.ts:147–165`）。仅 Host 的模型端点指向 loopback。

1. 普通启动完成，工作区本地会话就绪，configError=null。
2. 真实 Lead 接纳三个独立本地只读事项。SQLite BEFORE INSERT trigger 仅拒绝 WorkItem 最终结果 Outbox 的 INSERT；两个 Worker 均真实完成回合，探针确认两次结算失败。
3. 删除 trigger，等待 4200ms（默认 dispatchTick=400ms、outboxTick=1000ms，`src/index.ts:18–19`）。实际仍为两个 running/result=null、一个 queued，无持久结果 Outbox。
4. **普通同 profile stop → boot**，保留现有 workspace、账本、Session，不手工停止事项、不改 SQL 状态。三个原有事项全部 completed；原两个 Worker 的 recovery_gen 从 0 升为 1；对应三条结果 Outbox 全部 sent。
5. 再通过原本地会话交办一个新只读事项，完成并保持累计四项 completed。

**恢复限制必须保留**：第 4 步是 `WorkItemLifecycle.recover()` 发送新一代续办输入、Worker 再产生完成回合；它不是把原来丢失的 turn/end 结算自动补提交。本探针只读记忆，不能泛化为所有外部写动作都不会重复。已成功/未知外部写入的保护依赖各自稳定操作键和回执恢复，既有 V03/V17 等仍须修复。

证据文件：

- 探针：`/tmp/pa24-final-p0-runtime-probe.mjs`
- JSON：`/tmp/pa24-final-p0-runtime-result.json`
- 新 Host 日志：`/tmp/pa24-final-p0-runtime-host-log.json`（重启后 Host 的 stdout/stderr；首次 Host 的原始 stderr 未另外保存，双故障命中由探针断言和输出状态证实）
- 全程 loopback 模型调用日志：`/tmp/pa24-final-p0-runtime-model-log.json`
- 临时原目录与 Host profile 路径保留在 JSON 的 root / hostRoot 中。Host 与 loopback 模型进程均已关闭。

## V16 判级：建议升 P1；不属于已证实 P0

**现有缺陷与新影响证据**：`src/runtime.ts:1588–1594` 对真实 turn/end 结算失败只告警，不保存重试承诺；`src/work-item-lifecycle.ts:115–122` 的 finish 失败使补槽不执行；后续普通 pump 仅依据数据库 running 数认领（`:38–43`），无法重读原完成回合。默认并发 2 的两个槽位都可被这种状态占满，暂态数据库错误解除后整个工作区的新 Worker 交办仍无法推进。现有探针还证明切换工作区被拒绝；此轮重现无需把并发改为 1。

**P1 理由**：这会中断核心事项闭环及默认全部 Worker 容量，健康数据库恢复后仍需用户停止事项或重启服务。并非只影响一条通知或界面显示。本轮扩大了先前仅 maxWorkers=1 的证据，累计发现数不增加。

**没有判为 P0 的具体依据**：

- 故障时 panel snapshot / session 控制仍可访问；服务没有普遍崩溃或拒绝启动。
- 原 WorkItem、child、parent 和已接纳队列都保留。`src/repo/work.ts:51–61` 将结果与 Outbox 放在事务内；失败回滚没有删除已接纳内容。
- 同 profile 普通重启已实测通过新代续办让 3 个原事项完成且结果全部 sent，不需要手工修复数据库或重建 workspace。
- 随后新事项也完成；未见持续不可恢复的核心不可用、全库破坏、跨实例级联或灾难性数据后果。
- 这些是影响范围与可恢复性的证据；“需要触发故障”本身不作为降低级别的理由。

**契约 / 测试覆盖缺口**：SPEC `docs/24PA-v1-SPEC.md:337–340` 要求已完成结果只补发送、持久父回传、按原 child 恢复。现有 `tests/unit/work-item-lifecycle.test.mjs:69–74` 只证明事务回滚后调用方**再次主动调用 finish**可成功；真实 onSessionEvent 调用方没有这次重试。应在同一真实事件 interface 增加事务恢复后不重跑模型即可结算旧结果和释放槽位的验证。

## V23 判级：保持 P2；没有 P0/P1 扩散证据

第三轮已有公开 Runtime + 真实 SQLite/PG 复现：计划漏办超过宽限后，`DigestService` 先保存 paused 并删原生计划，再写告警 Outbox；告警 INSERT 失败后，同进程重试及重启不会补告警。代码 `src/digest-service.ts:641,648–655`；生命周期清理 `src/plan-lifecycle.ts:148–153`；定时异常吞掉 `src/runtime.ts:2373`。

确定影响是本次被暂停计划的“需处理”告警和处置原因恢复丢失。暂停本身是安全预期，业务计划/历史保留；没有证据显示它占 Worker 槽位、阻断普通启动或其他事项、破坏原生平台对象或业务库。用户可从面板看到 paused，周期计划可在核对后重新恢复；一次性过期计划可能需明确建立新安排。建议 P2，因为可处理性和可观测性丢失需要修复；没有依据升 P1 或 P0。

- 契约：`docs/research/F09-规划与定期回顾实现研究.md:19` 明确要求超宽限暂停并通知本人。
- 既有正常测试：`tests/unit/digest-reliability.test.mjs:290–298,301–314` 证明正常通知一次，但 notifyOwner 没有模拟耐久提交失败；`:317–322` 覆盖 revision 避免误停新安排。
- 证据：`/tmp/pa24-deep3-lifecycle-supervision-probe.mjs`、`/tmp/pa24-deep3-lifecycle-supervision-result.json`。

## 本轮只读复核的保护与未覆盖

| 路径 | 已复核依据 | 限度 |
|---|---|---|
| 普通默认启动、默认并发、队列、同 profile 重启、新事项闭环 | 本轮真实 Loader 实测，以上 5 步 | 实测 Node 26.4、本地 SQLite、demo、本地只读 memo |
| 启动错误释放资源 | `src/index.ts:44–57` 失败记录 startupError 并 stop；`src/runtime.ts:749–767` cleanup 关闭 admission/timer/transport/db/lock | 本轮仅源码复核；主审另有数据库迁移失败验证，不等同 Host 启动失败实测 |
| 工作区准备与激活 | `src/runtime.ts:824–874` 先准备目标、catch 清理候选资源、再同步替换 | 此子任务本轮源码复核；不重复已报告跨工作区问题 |
| 重启工作恢复 | `src/runtime.ts:777–798`，`src/work-item-lifecycle.ts:129–150`；原两个 child 实测恢复到 gen1 | 重新续办不是重放旧结果；缺失 child/模型永久失败未在此探针强制 |
| 用户停止保持停止、恢复输入失败释放槽位 | `tests/unit/work-item-lifecycle.test.mjs:58–67` 与对应 implementation | 本轮阅读既有测试，未重新跑全套 |
| 监督告警失败 | 前轮 SQLite/PG 公开入口实测，本轮复核源码/结果 | Schedule 为契约 adapter；未重做该探针 |
| Waiting/TaskTemplates/Reminder 生命周期 | `/tmp/pa24-deep3-lifecycle-review.md` / `.json` 覆盖矩阵 | 本轮不新增故障组合，不重做已完成用例 |

没有执行真实平台、手机通知、真实模型写操作、断电/文件系统损坏、长期磁盘耗尽、全部 Node/OS 组合、所有角色与渠道的全矩阵。未重新进入自动安全检查已中止的出站或知识专项。主审的迁移/备份/其他 P1 证据独立计入总报告，本报告仅确认 Runtime / 生命周期范围未发现已证实 P0，不能表示仓库不存在任何 P0。

## module 深化结论

V16 的有效 seam 是“原生完成事件 → 可重试的耐久结算”，应让完成正文、原发起入口、恢复代次及待补结算集中在 WorkItem module；定时 pump 与重启读取同一承诺，避免调用者靠再次制造模型回合修补。V23 的 seam 是“监督处置 → 耐久原因与告警意图”，由周期计划 module 收拢。两者提高 locality，并让真实事件、定时恢复与公开面板共享 leverage。删除这些 module 后，重试键、次序、回执和故障恢复会散回调用者，符合 deletion test；仅再包一层 stop-then-notify / finish wrapper 无法解决。保持 ADR-0001 的原生会话和 Schedule 归属，不新增第二套调度器，本轮不拟 interface 签名。

隔离 checkout HEAD 与基线一致；git status 仍只有主审先前建立的 node_modules 链接。产品源文件未改，未建 Issue/PR。
