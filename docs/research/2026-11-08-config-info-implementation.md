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
