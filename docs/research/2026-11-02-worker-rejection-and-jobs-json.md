# Worker 动作拒绝与交办查询 JSON 修复

## 范围与依据

- 用户授权直接在 main 修复 8010 日志中定位的两个缺陷。基线为 `4220219e6c11b056e6b4427aa88ab1634a3a52ba`，插件 `0.2.1-rc.5.5`，宿主 dsh `0.2.1-rc.5`。
- 产品依据：Manticore 定稿「工作对象与权限」「运行记录与助理交办」；明确未执行与未知结果分别处理，未知外部动作必须先核对，保留原交办、运行和业务回执。ADR-0001 的角色与发起会话权限不变。
- 接口依据：当前安装的 `@deepseek-ai/dsh-tools` 在返回值渲染前调用 `snapshotJsonValue`；非普通对象（包括 Date）不属于 lossless JSON。工具处理异常被包装为 `isError`，普通 Error 没有能够证明业务尚未执行的分类。

## 已复现的生产证据

- 2026-11-02 14:53:47 / 14:54:07（Asia/Shanghai），`6691951b…` / `80c0460f…` 的 `pa24_work task_delete` 在内部动作表检查处被拒绝，没有调用删除 handler，却被 Worker 审计记为 unknown 并进入待核对。合法入口为 `task_cancel`，仍按原平台身份与 effect 校验。
- 8010 从 14:40:03 持续运行，诊断时重启次数为 0；两个 Worker 原生回合结束，不是宿主进程退出。
- 15:14:32 / 15:14:33 在本地会话分别执行两个原 workId 的 `pa24_jobs inspect`，均返回 `INVALID_TOOL_OUTPUT: value is not lossless JSON`。
- 使用已安装代码与只读 SQLite 连接重建 inspect 返回值，两个返回值均包含五个 Date：`work.created_at`、`work.updated_at`、`runs.rows[0].created_at`、`runs.rows[0].updated_at`、`runs.rows[0].triggered_at`。仅转换日期后原生 JSON 校验通过。

## 修复边界与取舍

1. 不存在于当前 Worker 动作表的动作，在 handler 调用前返回明确的业务拒绝，包含 `status: rejected`、`businessExecuted: false` 和当前职责可用动作；不将 `task_delete` 自动映射为删除，也不绕过来源、身份、effect 或授权校验。
2. Worker 审计将这一明确的业务拒绝记录为 failed，允许当前运行后续合法步骤。宿主错误、取消、写后异常和关联 operation 未知仍按原有规则阻断；不凭错误文案猜测是否执行。
3. 只在 `pa24_jobs` 公共工具边界转换日期和可选字段，保留内部仓储的 Date 类型与其他工具原有校验。覆盖 list、inspect 及变更返回值，避免只修某一个查询入口。
4. 不迁移或改写既有待核对运行，不重放原业务动作；本次没有新增数据库结构。

## 验证计划

- SQLite / PostgreSQL 下，实际 ToolRuntime 调用 list、inspect，确认原交办、运行和 ISO 时间正常返回。
- 实际 ToolRuntime 与 Worker 审计链验证非法动作不产生平台写入，审计为 failed，同一运行后续合法调用成功。
- 既有写后回执丢失验证继续要求 unknown、阻止后续调用与盲接续。
- 真实 Loader / Session 在两种存储下验证上述交互；构建、预设检查、单元回归及 Standards / Spec 双轴审查。

## 验证结果

- 基线回归：`npx vitest run tests/unit/jobs-tool.test.mjs` 在两种数据库下均重现 JSON 校验失败和非法动作错误，4 项失败；修复后该文件的 8 项全部通过，含越职责与原型属性拒绝。
- `npm run build`、`npm run preset:check` 通过；在 `packages/24pa` 执行 `npm run test:unit`，98 个文件通过，1663 项通过、1 项跳过。
- `PA24_E2E_STORAGE=sqlite npx vitest run tests/e2e/manticore-work-run.e2e.mjs` 与对应 `postgres` 命令分别 6 项通过。覆盖真实 Loader、Session、模型可见工具回执、持久化、同一运行继续与未知回执阻断。
- 首次新 Loader 用例暴露了隔离配置未启用 tasks；随后测试读取工具回执时漏解原生文本块。仅修正测试配置与解析后，双后端完整文件均通过，生产修复未因此扩大。
- 发布目标为 `0.2.1-rc.5.6`，宿主仍为 `0.2.1-rc.5`；数据库结构不变。真实平台删除不属于本轮验证，8010 升级后仅复验原交办查询，不重放原业务动作。

## Standards

固定实现范围 `4220219…877b593` 及隔离配置增量：0 项明确标准违例、0 项需处理的代码异味。JSON 转换保留在工具边界；角色自有动作表与原未知结果保护保持有效。

## Spec

固定实现范围 `4220219…877b593`：0 项发现。明确未执行的动作保留 failed 审计并可继续；外部未知仍须先核对；交办查询保留身份、时间与运行历史；没有改写或重放旧运行。
