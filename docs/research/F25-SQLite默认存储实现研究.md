# F25 研究：存储改默认 SQLite、可选 PostgreSQL

日期：2026-10-10。用户裁决立项（原文「将存储改为默认 sqlite，可选 postgresql」）。**这是规格级反向变更**：现行 SPEC 明文「不使用 SQLite」（见一），实施已随票修订规格（规格 2.1）。

## 一、与现行规格的冲突（已显式修订的四处）

1. SPEC 故事 95：「直接使用服务器 Docker 中的 PostgreSQL……不使用 SQLite」→ 改写为默认 SQLite、可选 PG 双模式口径（2.1 修订标注）。
2. SPEC 非功能条款：「不使用 SQLite，也不提供不可用时静默退回内存或 SQLite 的写路径」→ 双后端条款；「静默退回仍禁止」原则保留（配置什么失败什么，显式报错）。
3. SPEC T14 测试组「无 SQLite 打开或数据库文件」→ 双后端验证（SQLite 账本文件落工作区 data/ 且可备份）。
4. SPEC 发布验收第 6 条「无 SQLite I/O」→ 双后端路径验证；#46 工单正文同步。
5. 整体设计方案 :19 持久化行同步；历史决策原文保留、以修订注记指向本变更（product.md 术语规则）。

## 二、现状盘点（2026-10-10 实测）

- 代码面：`pg.ts` 518 行（连接池、11 版迁移清单、`withTransaction`）、`repo.ts` 1687 行（全部业务 SQL）；依赖 `pg@8.23.1`，零 sqlite 痕迹。
- PG 方言使用面（迁移工作量所在）：`on conflict … do nothing/update … returning *`（幂等入账基石）、`= any($n)` 数组参数、`$n::type` cast、`now()`×36、`now() + make_interval(secs => $n)`、`ilike`（含同参数复用 `$5 … ilike $5`）、`for update skip locked`×6（inbox/工单认领轮询——**勘误：早期评估「未用深水特性」不成立**）、`nextval('pa24.note_seq')`、`timestamptz/jsonb/boolean/bigserial/date` 列类型。真正未用：LISTEN/NOTIFY、advisory lock。
- 数据现状：两库业务数据近空——**不做 PG→SQLite 数据搬迁器**，双模式各自全新起步；已部署 PG 实例在 AGENTS.md 显式 `storage: "postgres"` 继续用（升级破坏性变更，随发版给升级说明）。

## 三、方案与实施落定（2026-10-10）

- **闸门通过**：本机 Node v26.4 实证 node:sqlite 免 flag；`ON CONFLICT DO NOTHING RETURNING *`、`UPDATE … RETURNING`、WAL、`BEGIN IMMEDIATE` 全可用（SQLite 3.53.4）。Node ≥ 23.4 为无 flag 最低线；运行时不可用时显式报错（提示改 postgres 或升级 Node），不静默退回。
- **架构＝翻译式适配层**（新增 `src/db.ts` 接口 PaDb＋`src/sqlite.ts` 实现，repo 层 SQL 零改动）：
  - 翻译规则：`pa24.`→`pa24_`（无 schema）、`$n`→`?` 按出现序（支持同号复用）、`= any($n)` 数组展开（空数组→恒假）、cast 剥离、`now()`→`strftime('%Y-%m-%dT%H:%M:%fZ','now')`、`make_interval`→strftime＋printf 秒数、`ilike`→`like`、剥 `for update skip locked`；**残留 PG 方言即抛错**（fail loud）。
  - DDL 与列类型回收（jsonb→对象、boolean→布尔、timestamptz→Date）都从 pg.ts 同一份 MIGRATIONS 推导——双后端结构零漂移；`create sequence`→计数表（`update … returning` 发号）。
  - 事务＝单连接串行队列＋AsyncLocalStorage 归属判定：事务内语句加入当前事务，外部语句排队等待（防中途混入他人写）；`BEGIN IMMEDIATE` 抢写锁。
- **配置面**：`storage: 'sqlite'|'postgres'` 缺省 sqlite；pgDsnEnv 仅 postgres 必填（sqlite 下存在则仍校验格式）；`openDatabaseFor` 单点分支（SQLite 落工作区 `data/pa24.db`）；readiness 就绪项文案按后端显示。
- **备份**：SQLite＝`wal_checkpoint(TRUNCATE)` 后整文件拷贝入备份清单（id `sqlite`）；PG 路径不变（pg_dump）；恢复说明双口径。
- **测试矩阵**：单测 sqlite.test.mjs 9 例（翻译规则逐条/迁移建表/幂等认领/布尔-JSON-时间戳往返/序列/事务提交回滚/checkpoint）；e2e 经 `PA24_E2E_STORAGE=sqlite` 全量切换（helpers/pg.mjs 断言查询路由到 SQLite 文件、psql -At 同构格式化，测试文件零改动），默认跑法仍 PG（host.mjs 双向注入 storage 字段）。

## 四、未决 / 真机待验

- SQLite 全量 e2e 矩阵与 PG 回归（实施中；一次并行会话污染的旧跑批 41 失败已作废）。
- ali_code_agent 服务器 Node 版本（SQLite 模式需 ≥ 23.4）——重装时核验。
- 真机：全新工作区 demo 模式零依赖起步；既有 Ops-Space PG 实例升级时补 `"storage": "postgres"`（升级说明随发版）。
- WAL 长稳写频观察（提醒轮询/outbox tick 量级远低于 SQLite 上限，判断无虞）。
