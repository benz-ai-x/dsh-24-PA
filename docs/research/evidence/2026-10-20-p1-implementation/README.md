# P1 实施证据

本目录保存三组 P1 的失败回归、修正验收及双轴审查。A 组完整功能验收固定 `ba71e7a78154e20ebfa314885442cf94617935aa`；宿主固定 `1600d8a1e140dcde43a1a0941940a0480712c011`。日志只规范化行尾空白与末尾空行。

- 汇总：[A 组验收](group-a-validation.json)。最终单测 685/685；真实 Loader SQLite/PG 各 84/84；构建及预设检查通过。
- V05：`pa24-v05-red*` 保留原缺陷与关闭交错的失败；`pa24-v05-review-green-node22.log`、`node24.log` 各 40/40。备份实测覆盖 WAL 换代、真实恢复、并发及排空。
- V11：`pa24-v11-red-public.log`、`pa24-v11-red-owner-reload.log` 是公开绑定/主人变更失败回归；`pa24-v11-lock-probe.json` 记录实际 PG 锁及回滚。`pa24-group-a-restore-green.log` 为 25 项最终归属验收，含两个进程争用及双库联合备份实际恢复。
- 配套审查修正：`pa24-v11-red-backup-identity.log` 原缺失/损坏/错身份三例失败；`pa24-group-a-identity-backup-green.log` 66/66；独立 Spec 原探针和未登记账本探针均确认不完整，不再误报成功。
- 初组 `pa24-group-a-unit.log` 是 679/680 的历史失败；`pa24-group-a-transport-fixture-green.log` 保留合法接纳后原故障测试 11/11。`pa24-v11-admission-acceptance.log` 中空检索结构断言错误已改为公开返回形状。两者不是最终验收结果；最终以 `pa24-group-a-unit-final.log` 685/685 为准。
- Standards：[初审](pa24-group-a-standards-review.md)、[复审](pa24-group-a-standards-rereview.md)，最终硬违反 0、代码异味判断 0、新发现 0。
- Spec：[初审](pa24-group-a-spec-review.md)、[复审](pa24-group-a-spec-rereview.md)，最终 0 项，初审身份文件缺口已消除。

临时能力探针保留原执行路径以便核查，不是安装/生产命令。未进行真实飞书/企微写入或断电验证；其边界仍归 #46。其余 18 项 P2 保留。

## B 组 V16

最终实现 `eaeeafb`，详细范围见 [B 组验收](group-b-validation.json)。单测 725/725；双库 Loader 各 86/86；最终提交双库原回合专项各 2/2。`pa24-v16-red-loader-sqlite.log` 保存两条基线失败；`pa24-v16-boundaries-green.log` 为 104 项边界及相邻流程通过；`pa24-group-b-unit.log` 的初次四项失败由显式恢复夹具修正，最终以 `pa24-group-b-unit-final.log` 为准。

Standards 与 Spec 分别保存在 `pa24-group-b-*-review.md` 和 `pa24-group-b-*-rereview.md`；初审判断性重复逻辑已清偿，最终两轴均无未清偿发现。

## C 组 V03 / V01

最终实现固定 `10a8cf39480bb2736cd6dd9f3f648e10903aeb44`；宿主仍为 `1600d8a1e140dcde43a1a0941940a0480712c011`。全部最终套件在该提交编译后启动，运行期间源码、测试及编译产物未变。详见 [C 组验收](group-c-validation.json)：构建及预设通过，单测 51 文件 783/783；SQLite / PostgreSQL 真实 Loader 各 18 文件 87/87。

- V03：`pa24-v03-red-*` 保留原渠道切换故障；最终边界 26/26、相关 72/72、相邻 49/49、双库 Loader 各 11/11。持久原渠道与回执恢复，不重建远端对象。
- V01：`pa24-v01-red-public.log` / `red-legacy.log` 保留同源缺口；公开初发/重发、旧批准和正常对照进入最终 `knowledge-actions` 54 项。`pa24-v01-recovery-final.log` 为真实 SQL 故障、重启及版本恢复 24/24。
- Spec 初审另发现旧待审卡复用旧批准范围，双库四例先红；`pa24-v01-green-legacy-card.log` 连同审核事务回归 5/5。独立复审探针确认换发正文卡且无旧摘要，旧卡不产生裁决。
- 历史非最终结果保留：`pa24-v01-matrix.log` 的两项恢复故障夹具未进入事务，改真实 SQL trigger 后通过；`pa24-group-c-unit.log` 为修正前 779/779；首轮 Loader SQLite 85/87、PG 86/87，分别涉及免打扰夹具窗口及旧回执文案断言。修正后完整重跑全部通过，未删除原故障/单对象/扣留后送达断言。
- Standards：[初审](pa24-group-c-standards-review.md)、[复审](pa24-group-c-standards-rereview.md)，最终硬违反 0、判断性异味 0、新缺陷 0。
- Spec：[初审](pa24-group-c-spec-review.md)、[复审](pa24-group-c-spec-rereview.md)，初审 1 项已清偿，最终 missing/partial、scope creep、wrong implementation 均 0。

[P2 复核](p2-residual-assessment.json) 保留原 18 项待修；本轮修复不代表完整发布验收。未重新运行此前被安全检查中止的出站/知识审查专项；本次新实现的隔离回归也不替代真实账号及安装包验收 #46。

## 合并后的 main 复验

三组功能合并完成：[#210](https://github.com/benz-ai-x/dsh-24-PA/pull/210)、[#211](https://github.com/benz-ai-x/dsh-24-PA/pull/211)、[#223](https://github.com/benz-ai-x/dsh-24-PA/pull/223)。[最终 main 验收](final-main-validation.json) 固定 `7c3845e2ee99439ff1aa4ae5055de40bac9c2c70`；构建、预设再次通过，50 项公开入口/恢复回归及 SQLite/PG 各 3 项原生 Loader 通过。专项按名称筛选，68 项单测和每库 3 项 Loader 未重跑；完整套件以 C 组 783/87/87 为准，两个提交的 `packages/24pa` 树完全一致。

V05 真实 WAL 换代后恢复、V11 不同主人 PG 拒绝、V16 同代补结算/释放两槽位、V03 原渠道重启及容器/配置切换、V01 初发/重发与旧审核卡均逐项有实际结果。18 项 P2 待修，#46 仍打开；没有把本轮 P1 修复等同于发布通过。

C 组合并候选文档增量也单独确认：[Standards](pa24-group-c-standards-delivery.md)、[Spec](pa24-group-c-spec-delivery.md)。主工作区保护核对见 [记录](pa24-final-main-workspace-preservation.json)，已知的 Manticore 文档外部变化保留。
