# Manticore 最终集成证据

最终生产和测试提交：`efda5fc728e6cfed41b17b801e7917abf86c83a5`。完整对照见[交付验收](../../../planning/24PA-Manticore-交付验收.md)。最后的文档提交只整理证据与状态。仓库可读日志仅清理行尾空白及末尾空行以通过差异检查，正文、数值与失败记录不变；[原始日志压缩包](raw-logs.tar.gz)保留逐字节原件，摘要见`validation-summary.json`。

## 最终结果

- `full-unit-efda5fc.log`：88文件1444通过/1跳过，403.48s。唯一跳过为SQLite不适用的PG独占锁，PG对应项通过。
- `health-sqlite-efda5fc.log`：最后健康输出修复后的F12、健康、交办完整文件13/13。
- `health-json-before.log`：真实SQLite/PG的2项回归均失败；`health-json-after.log`：修复后相关28/28。
- `package-efda5fc.json`：最终本地安装包140文件/597866字节，含SHA-256及逐字核对的关键产物；未发布或部署。

## SQLite：32文件179项覆盖

全批次与受影响复测分别列明；不声称最终提交一次全量端到端全绿。

| 原批次 | 原结果与原因 | 通过证据 |
|---|---|---|
| `legacy-sqlite-63e3dd8-partial.log`，4文件18项 | 14通过/4失败；F04/F16通过；F08旧消息计数，F11旧回执及后继失败 | `notes-sqlite-6072e89.log` F11完整4/4；`followup-sqlite-6072e89.log` F08 P23为1/1，另5项原批次已通过 |
| `remaining-sqlite-6072e89-partial.log`，28文件161项 | 154通过/7失败；F01/F22应用身份，F02/F03迟到补充及接续，F05退役操作，F10旧防重文案，F13工具表 | `followups-sqlite-f80c126.log`完整8/8；`legacy-sqlite-f80c126.log`完整24/24；`minutes-sqlite-f80c126.log` F10 P27为1/1，另2项原批次已通过 |

`sqlite-coverage.json`逐文件记录32文件179项的通过来源，名称筛选产生的未运行项均有原完整文件通过记录。最后健康增量另由13项验证，最终全单元再次覆盖全部业务模块。

## PostgreSQL：32文件179项覆盖

`all-e2e-postgres-f80c126-partial.log`完整执行32文件179项（720.57秒）：177通过、2失败。`postgres-coverage.json`逐文件对应最终证据。

1. F12健康工具因数据库Date违反宿主无损JSON契约失败。`postgres-diagnostic-partial.log`再次复现，`efda5fc`在公开输出边界保留事实、转为JSON时间字符串。`health-f12-postgres-after.log`的F12及健康完整文件8/8通过（16.22秒）。
2. 交办文件“新目标”场景建立前置交办时30秒超时。未更改该业务逻辑或验收断言，`postgres-diagnostic-partial.log`中该完整文件5/5通过，随后`work-run-postgres-repeat-1.log`至`-3.log`各5/5通过（9.28、9.21、9.27秒）。总共4次完整复测通过，未证实根因，保留为未复现的时序风险。

最终代码完整单元及双库受影响用例已通过；这些记录证明组合覆盖，没有声称曾执行一次最终PG全量全绿。

## 独立串行评审

- `standards-cfcf876.txt`、`spec-cfcf876.txt`：完整范围各0遗留。
- `spec-preparation-63e3dd8.txt`、`standards-preparation-6072e89.txt`、`spec-closeout-6072e89.txt`：写入前条件等待和旧流程等增量0遗留。
- `standards-prior-rejection-finding.txt`保留拒绝提示失败可能未结算入站的原P2；`standards-rejection-f80c126.txt`、`spec-rejection-f80c126.txt`复审各0遗留；`transport-unit-f80c126.log`14项验证清偿。
- 最后`standards-health-efda5fc.txt`、`spec-health-efda5fc.txt`各0遗留。报告中的最终测试待回填是评审时事实，完成数字以最终日志为准。

## 界面与历史证据

四张`backup-*.png`来自真实宿主隔离工作区，覆盖空态、桌面记录、390px深色和断线缓存，包括备份、校验、演练与失败。界面操作前后模型请求数均为10。浏览器和Host已清理；分页用23条记录的单元测试验证，未把4条浏览器记录当作分页实测。

`full-unit-cfcf876.log`、`full-unit-6072e89.log`为1440通过/1跳过，`full-unit-f80c126.log`为1442通过/1跳过；`related-unit-cfcf876.log`106项；`planning-calendar-sqlite-cfcf876.log`15项。`prior-unit-290f04b-failed.log`、`prior-preparation-unit-failed.log`保留历史失败。`package-6072e89.json`与`package-f80c126.json`为已替代的历史包摘要。

## 复现与边界

宿主`1600d8a1e140dcde43a1a0941940a0480712c011`，Node26.4.0、PostgreSQL16.13。真实Loader、Session provider及实际数据库；模型与外部平台进程为替身，不代表真实账号或部署。

从`packages/24pa`先构建，再串行执行（替换为实际绝对路径）：

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json
NODE_OPTIONS=--require=/absolute/path/node-wakeup.cjs node node_modules/vitest/vitest.mjs run tests/unit
DSH_BIN=/absolute/path/dsh/apps/cli/lib/bin.js PA24_E2E_STORAGE=sqlite NODE_OPTIONS=--require=/absolute/path/node-wakeup.cjs node node_modules/vitest/vitest.mjs run tests/e2e
DSH_BIN=/absolute/path/dsh/apps/cli/lib/bin.js PA24_E2E_STORAGE=postgres NODE_OPTIONS=--require=/absolute/path/node-wakeup.cjs node node_modules/vitest/vitest.mjs run tests/e2e
```

`node-wakeup.cjs`用20ms非保活定时器避免Node26原生SQLite备份回调延迟，只加载到测试进程，不替换数据库、业务响应或判定。生产代码没有该补丁。完整命令用于复现，本轮实际结果为上述全批次加受影响复测。
