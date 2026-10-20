# P1 实施证据

本目录保存 V05 / V11 的失败回归、修正验收及双轴审查。完整功能验收固定 `ba71e7a78154e20ebfa314885442cf94617935aa`；宿主固定 `1600d8a1e140dcde43a1a0941940a0480712c011`。日志只规范化行尾空白与末尾空行。

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
