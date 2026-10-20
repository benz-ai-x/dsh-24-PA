B 组 Standards 增量复审：固定 04ac85e6…eaeeafbf（总基线 693011f9）。硬违反 0；新增 possible smell 0；上一轮重复策略已清偿。

work-item-lifecycle.ts:142–145 将失败计数和原有退避公式收归私有 deferRetry，:158、:217 两条失败路径共用；400ms 起步、30s 上限及重复完成事件不重置退避的行为保持，未引入通用框架。

planning-adoption.test.mjs:38–46 补充缺少持久完成证据时 needs_reconciliation、不自动新增输入、拒绝 Worker 操作的断言，再经公开 stop/continue 恢复。:47–54 保留未知操作身份、跨事项冲突、禁止改投和远端仅一次的原断言，未弱化门禁。

已核对 /tmp/pa24-v16-review-delta.log：受影响两文件 60/60 通过。未重跑全套、未改仓库；全量结果由主代理核对。初审报告保留。
