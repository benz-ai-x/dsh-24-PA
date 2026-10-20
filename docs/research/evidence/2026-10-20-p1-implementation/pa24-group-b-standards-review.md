B 组 Standards：固定 693011f9…04ac85e6。硬违反 0；possible smell 1；额外行为缺陷 0。

判断：possible Duplicated Code。packages/24pa/src/work-item-lifecycle.ts:153–154、213–214 重复同一失败计数及退避策略：`attempt.failures += 1` 与 `Math.min(30_000, 400 * 2 ** Math.min(attempt.failures - 1, 7))`。一次调整需要同步两处，容易使刷盘失败与结算失败的间隔分歧。按 smell baseline，建议提取同模块私有退避 helper；不需通用框架。此为判断，非硬性标准违规。

其余核对：完成证据与重试归 WorkItem，SQL 归 repo；宿主适配器使用固定 1600d8a 的公开 flush 和只读 open/read，关闭 handle；代次/执行身份在提交时重验，工作区 lease 覆盖读取与提交。测试补齐真实输入/归属及刷盘返回值，未删除旧断言。

证据：边界组 104/104，双库 Loader 各 7/7；原生导出每事项 1 输入/1 回合、generation 0，3 文档/6 Worker 模型请求/3 Outbox。未重跑全套、未改仓库；全量结果由主代理另行核对。
