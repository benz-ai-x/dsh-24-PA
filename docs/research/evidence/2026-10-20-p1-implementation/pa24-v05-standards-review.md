# V05 Standards 审查

固定范围：`0ef85772...1172d465b800558fd2fea82d2955584d3778baa5`，仅 V05 生产改动；历史证据及未开始的 V11/V16/V03/V01 不计缺失。

**硬性标准违反：0。代码异味判断：0。** 已按 AGENTS.md、产品/领域规则、GLOSSARY、ADR-0001 和 PR 交付计划核查。快照责任留在 SQLite adapter，未扩展权限或改变 schema；格式 3、旧 SQLite 拒绝认证、旧 PostgreSQL 兼容和恢复说明一致。公开测试包含真实恢复业务行、并发两表一致性、读写故障以及已接纳事务/备份的关闭排空；Node 22.19、24.0 的现有记录各 39/39，未重跑全套。

**另行移交 Spec 轴的已证实行为缺陷：1（P2）。** `packages/24pa/src/sqlite.ts:403–404` 先执行 `if (this.closing) return this.closing`，随后才拒绝事务内部关闭。事务尚未完成时，外部先调用 `close()`；事务随后 `await db.close()` 会得到排在自身之后的关闭 Promise，使双方永久等待。现有 `sqlite.test.mjs:206` 只覆盖尚无外部关闭的事务内调用，无法捕获该交错。应先检查事务 scope，再返回已有 closing，并补公开回归。

证据：从上述固定提交提取源码，在 Node 26.4.0 的临时 SQLite 库复现；内层 close 200ms 未完成，探针主动抛错退出事务后外部 close 才完成。此为行为缺陷，不强行归入 smell；PR 交付计划第 97 行要求本功能的超时、重复随 PR 验收，合并前应清偿并复审。
