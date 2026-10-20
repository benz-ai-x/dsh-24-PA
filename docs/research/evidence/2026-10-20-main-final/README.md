# main 最后复核证据

基线：`0ef85772a10f45e8e3b4c4d2c85d7249bf28e256`。本目录支持 [P1 修复 TODO](../../../planning/2026-10-20-main终验P1修复TODO.md)，不是修复已经完成的验收记录。

- [review-summary.json](review-summary.json)：本轮范围、结论、限制与交付分组。最后一轮为有界源码复核，无新动态测试。
- [findings.json](findings.json)：23 项现存问题，P1 为 V01/V03/V05/V11/V16，其余 18 项 P2；证据和探针引用已改为本目录文件名。
- [severity-reassessment.json](severity-reassessment.json)：前轮 P0 复核及 V16 升级 P1 的依据；0 项已确认 P0 不等于保证没有 P0。
- [runtime-final-review.md](runtime-final-review.md)：本轮相邻路径保护、未发现新独立问题的判断和 V16 的详细实施验收顺序。
- `prior-*-validation.json`：同一 SHA 前几轮的验证记录，保留原日期及临时报告路径；不是本轮重跑结果。
- `pa24-*-result*.json`、`pa24-*-probe.mjs` 等：此前已执行的独立复现及对照，按原字节保存；一份脚本可能覆盖多个问题。探针使用隔离账本、脚本化模型或 CLI stub，涉及外部平台时不能当作真实租户验收。
- [github-issues-snapshot.json](github-issues-snapshot.json)：本轮读取的最近 100 条 Issue 元数据；用于确认旧 R3 票已关闭，不代表查询了仓库全部历史事项。本轮没有修改 GitHub。
- [provenance.json](provenance.json)：复制文件与原临时证据路径的对应关系；[manifest.json](manifest.json) 记录本目录文件摘要。

五项 P1 的主要结果分别为：`pa24-backup-complete-result.json`、`pa24-deep2-data-workspace-result.json`、`pa24-final-p0-runtime-result.json`、`pa24-minutes-recovery-results.json`、`pa24-knowledge-final-results.json`。

历史脚本可能引用当时的绝对 checkout、运行时依赖和临时资源，未改造成独立可移植测试包；后续实施应按 TODO 将复现纳入仓库测试并重建隔离环境。目录中的旧 Markdown/JSON 可能仍含原临时路径，优先使用本说明、TODO 及 `findings.json` 的本地引用。测试数据为隔离样例，不表示真实主人数据或真实平台写入。

此前出站和知识专项被工具安全检查中止，本轮没有重试或补齐。当前覆盖不足以声称完整安全审计或发布终验通过。
