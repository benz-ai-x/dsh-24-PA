# F52 参数配置信息精简：实现前接口核验

2026-11-08。源码基线 `55d7c1205abe5bc74927a7386091139565eca5f1`，24私助 `0.2.2-rc.1.2`。目标 [#273](https://github.com/benz-ai-x/dsh-24-PA/issues/273)、[CI-01–07](../planning/24PA-参数配置页信息精简-SPEC.md#用户故事与验收)。无原生阻塞事项、无已有功能 PR。遵循 ADR-0001，不改变会话权限、数据库结构或计划。

## 已核验接口与选择

- `client.js` 的 `ConfigFormDetail` 已采用稳定编辑基线、字段差异补丁和 `expectedConfigHash`；复用此保存链路，日常与维护视图分别选择可编辑项，未展示字段不提交清除。配置状态与维护页共享 `ConfigurationEvidence` 的读取，日常只显示语义状态。
- `SourceSettings` 同时供参数页与日历/待办抽屉使用。参数页用简短分操作能力摘要；排障明细仍可从原来源抽屉查阅。`attemptable` 仅代表明确授权后可尝试，不代表已验证可写。
- `panel.ts` 的鉴权回环 RPC 与 `runtime.inspectWorkspace` 是只读检查入口。新增有限的配置影响读取，基于当前配置差异和已有健康计数，不调用平台或模型、不建通用影响计算系统。普通字段不引入额外确认。
- `runtime.updateWorkspaceConfig` 经串行 transition、绑定检查、磁盘配置合并、权限/归属校验后原子写回；应用失败已有 `saved_not_applied` 证据。沿用这些边界。相关保存前检查返回版本凭据，写入时核对版本及实际阻断条件，过期时保留草稿。
- `runtime.updateWorkspaceSecrets` 支持缺省保持、非空替换、空串明确清除。PG 活跃连接变化被 `checkWorkspaceConfiguration` 拒绝；SQLite 可保存 PG 凭据而不打开 PG 账本。环境值仍优先；工作区清除不删除环境。补齐密钥并发/应用失败反馈，不绕开原连接限制。
- `workspace-config.ts` 已保护工作规则原文、来源编辑指纹及 TTS/模型字段级合并。新视图不另建保存服务。

## 验证装配与边界

现有 `config-editor.test.mjs` 用真实 React DOM 操作及真实磁盘配置合并；runtime fixture 覆盖绑定/原子写入/密钥；`f33.e2e.mjs`、`manticore-health.e2e.mjs` 经真实 dsh CLI/Loader 和认证 RPC。扩展这些测试以验证影响时机、并发拒绝、PG 维护和保留值，不为纯文案编写镜像测试。

隔离工作树复用已安装的依赖；本机 dsh CLI/core tools 为 `0.2.2-rc.1`，本地 Cordis 源码为 `4.1.0`。后者不同于包声明的 peer 范围，验收须核对实际装配；历史 executor 测试失败不能当通过或跳过。测试 host 使用临时 profile、工作区、数据库和外部适配桩，不改 8010。

桌面验收使用真实 dsh 客户端和当前插件，覆盖中英文、明暗主题、1280×800 / 1440×900 / 1920×1080、键盘、保存/错误/离线/旧证据状态。外部平台用桩的部分明确标注；本票不新增平台 API，真实账号写入不属于信息精简所需验证。

以上为进入实现的接口依据；测试结果和审查结论在完成后补记，不由接口存在推断功能已交付。

## 实现与验收结果（2026-11-08）

实现提交 `a0472a0`，规格审查修复 `f7f3abd`，比较基线 `55d7c12`。后续文档与测试夹具调整不改产品行为。主功能 PR 合并后以远端合并记录为准。

配置、来源与密钥各自保存。新增只读影响读取及不透明版本凭据；服务端提交前复核，保留原身份阻断、PG 活跃连接限制和工作区校验。对磁盘已保存未生效的参数/密钥也计算本次附带应用的影响，不把仅改来源名称误判为无身份影响。影响预览与实际写入共享既有配置合并逻辑。密钥写盘后应用失败明确反馈已保存未生效。

| 验证 | 命令/范围 | 结果与边界 |
|---|---|---|
| 构建、预设 | `npm run build`；`npm run preset:check` | 通过，预设基线 `0.2.2-rc.1`。 |
| 完整单元回归 | `npm run test:unit` | 100 文件、1700 项：1695 通过、4 失败、1 按后端不适用跳过。四项均已在后续定向复验清偿，不能把本轮原始输出记为一次全绿。 |
| 最终定向复验 | config-impact、config-editor、health-panel、budget-panel、client、client-i18n、config 单元测试与 f33/f52 Loader（SQLite） | 9 文件、92 项通过。修复项为旧界面断言/缺失新只读 RPC 夹具与无效音色测试输入，业务断言未被删除；新增来源分项权限用例另列下项。 |
| 最终界面回归 | config-editor、config-impact、health-panel、budget-panel | 4 文件、45 项通过，覆盖分项权限/旧证据作废、显式清除优先级、影响后并发变化、维护表单、来源抽屉、预算及修复入口。最后复验无失败。 |
| Loader / PostgreSQL | `PA24_E2E_STORAGE=postgres npm exec -- vitest run tests/e2e/f52.e2e.mjs tests/e2e/f33.e2e.mjs` | 2 文件、10 项通过；独立受限 PG 账户，未连接生产数据库。 |
| 共享健康流程 | SQLite f33、f52、manticore-health Loader 初轮 | 3 文件、15 项通过，来源检查/身份变化与读写边界保留。 |
| 预算跳过项核对 | model-budget 单独复验 | 20 通过、1 跳过：仅 PostgreSQL 的行锁交错场景在 SQLite 不适用，不是隐藏失败。 |
| ToolRuntime 测试装配 | jobs-tool、work-tool-schema、todo-public-tool、worker-run | 新版宿主用真实 NativeToolExecutor 与批调用；旧宿主沿原单调用。4 文件、79 项通过，含双后端。 |

所有 Loader 命令指定 `DSH_BIN=/Users/pc2026/DSH-Space/deepseek-harness/apps/cli/lib/bin.js`；SQLite 指定 `PA24_E2E_STORAGE=sqlite`。测试宿主为本地 dsh `0.2.2-rc.1`、Cordis `4.1.0` 开发构建，未把本地开发构建当作所有历史发布宿主均已验证。测试依赖只在隔离工作树建立链接，未变更主工作树依赖。

CI-01–07 对照：I01–I06 实际删除/改写，日常语义状态与维护诊断分工；SQLite/PG 值与引用保存、环境覆盖、原值保留与拒绝热切换由真实存储及 Loader 证明；并发、迟到响应、工作区切换、未应用配置和只写密钥由运行时/DOM 测试证明；来源摘要不把 attemptable 当作已验证可写；现有语音引擎、音色与试听目标保留。

## 真实桌面操作证据

旧版来自固定 `55d7c12` 单独构建。新版最终实例来自 `f7f3abd` 产品代码；两者使用独立临时工作区和真实 dsh Loader/client。旧版的哈希、时间、在途统计与实现文案确实存在，新版日常页确实移除。没有对原型静态 HTML 进行验收。

- 1440×900 中文深色：[修改前](assets/f52/before-config-1440-zh-dark.png)、[修改后](assets/f52/after-config-1440-zh-dark.png)。
- 1280×800 中文深色：[SQLite 维护入口](assets/f52/after-maintenance-1280-zh-dark.png)，PG 值/引用均在，环境覆盖明确；日常页无 PG 字段，页面无横向溢出。
- 1920×1080 英文浅色：[参数页](assets/f52/after-config-1920-en-light.png)、[字段校验](assets/f52/after-validation-1920-en-light.png)、[保存前身份影响与键盘焦点](assets/f52/after-impact-1920-en-light.png)。Tab 可到达主人标识，原只读限制仍有效；无横向溢出，最终实例控制台无错误。
- 实际将并发数 2 改为 3，保存后读回“已保存并生效”；填 0 时提示正确范围并禁止提交，输入保持。改身份 profile 后、未点击保存前已出现影响，重置恢复原值，无额外业务动作。
- 1280×800 英文浅色离线：[错误状态](assets/f52/after-offline-1280-en-light.png)。此图来自首轮 `a0472a0` 实例：浏览器离线后读取失败、不显示已生效；恢复网络重读返回真实状态。最终 DOM 对离线与旧版本证据又执行回归。浏览器网络限制与视口覆盖均已复原。

本票未改变外部平台适配，平台与模型测试替身不冒充真实账号验收。未试听发送音频、未创建真实日历/待办、未迁移旧计划、未升级 8010；语音发送本身沿既有测试和授权边界。

## 双轴审查

### Standards

固定 `55d7c12...a0472a0`：0 项发现。增量 `a0472a0...f7f3abd`：0 项发现。复用原服务和权限，影响读取无外部副作用，测试使用真实宿主执行器。

### Spec

首次固定范围发现 1 项 P1：保存来源名称时可能附带应用磁盘未生效的身份配置，但没有提前影响说明。`f7f3abd` 共享实际合并逻辑、按最终配置对比生效配置，并计入未生效密钥；原场景实测闭环，增量复审新增 0 项。两轴分开结论，未把测试失败或待交付门槛当作已通过。最终文档/测试增量与 PR 头另在合并前固定复核。

最终文档/测试头 `d26f978`：Spec 未清偿 0 项；Standards 发现 v1 SPEC 第 20 节仍有“当前未开发”的过期状态，本次已同步并补入 [PR #274](https://github.com/benz-ai-x/dsh-24-PA/pull/274)，没有产品代码变化。最终固定头的复审结论留在 PR 评论。
