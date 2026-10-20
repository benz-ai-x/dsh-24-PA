# Manticore：Skill 与执行能力核查

日期：2026-10-20，Asia/Shanghai。产品依据为已通过人工审核的 [Manticore 产品定稿](../planning/24PA-Manticore-产品定稿.md)，实施起点 `67172733b0405718edd78e19d114a5ef6adc4db7`。范围：Skill 管理、定时任务、运行记录、预算及第一个功能的实现入口。本次只读源码和已有研究，执行公开模块导入与纯时间函数探针；未启动模型、真实计划、业务账号或生产环境。

## 结论与第一个交付单元

现有代码已经具备 **Skill 执行目录、通用 Skill 委派、定义快照、原生计划协调、业务结果与 Outbox 分别落账**，可作为实施底座；尚没有 Manticore 的 Skill 包管理、通用定时任务、统一运行档案和预算控制。不能以 F40–F44 已交付或现有“运行记录”卡的名称判断本轮已完成。

第一个适合独立交付的功能 **M01a：Skill 目录、详情与安全 Markdown 导出**：在第 16 张卡展示内置／个人来源、任务／persona／向导、模板／智能执行轨、正文、可用性及具体拒因、当前放行范围和关联计划；查看与刷新不触发模型或业务。它能独立帮助主人确认系统有什么能力，为随后上传、创建、版本和运行提供统一入口。当前关键读取契约已核清，适合立即实现；**M01a 导出的是所选 Skill 的指令 Markdown，完整包与上传另由 M01b 交付，不能以仅导出正文冒充含资源的完整包**。[现有目录](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/skills.ts#L309)、[现有面板 RPC](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/panel.ts#L21)

实施接口应落在独立 `SkillManagement` 模块，经 `PaRuntime.inspectWorkspace` 和 `PANEL_RPC` 暴露目录／详情；执行仍经过 `SkillCatalog.resolveForAgentRun`，不将管理列表的显示状态当作运行许可证。可以扩展现有目录 adapter 的只读观察面，无需新建通用插件框架。第一项验收必须包含加载失败、工作区切换迟到响应、persona／向导可见但不能普通运行、同名来源冲突和无副作用查询。[读取边界](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/panel.ts#L60)、[执行准入](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/skills.ts#L366)

若首个工单直接包含新建／编辑／导入，应同时交付稳定 Skill 身份、不可变版本、发布失败恢复、文件冲突检测及原目录刷新验证；单纯增加文件写入按钮不满足同名不误覆盖、重命名不破坏绑定和历史可追溯。本项是实现拆分建议，不缩减产品定稿的上传、完整下载、快速创建、试运行和正式运行范围。

### M01a 可直接实现的接口与验收边界

| 入口 | 可直接依赖的契约 | 必须保留的限制 |
|---|---|---|
| `catalog()` | 内置原件从 `builtinAll()` 读取，包含 persona/setup；工作区项从 registry `snapshot({cwd})` 读取同名胜者。没有 snapshot 的兼容宿主可用 list，但将完整性标为未知。 | registry 缺席仅表示本次只能展示内置件；发现失败／complete=false 不冒充完整空目录；全局用户和其他项目来源不扩大为本工作区托管项。 |
| `inspect(selection)` | 对工作区项只调用一次 `get`，从同一返回值取 name、description、source/provider、content、metadata，以及存在时的 path/resourceBase；内置选择直接取内置定义。 | 选择必须带来源，不仅传 name。同名内置原件与工作区胜者分列，不能点击内置件却取到工作区覆盖正文。get 缺失／抛错要在该项保留问题。 |
| `exportMarkdown(selection, observedFingerprint)` | 使用一次完整、与所选来源匹配的定义，生成 frontmatter 与正文；内容摘要可用于检测“查看后已变更”。文件名由受校验 Skill 名生成，返回文字／下载内容。 | 摘要不是正式版本号。变化时刷新或明确冲突，不能混用旧 metadata 与新正文。不要接受任意文件路径，也不读取包外资源、环境或密钥；标明不含 scripts/references/assets。 |

`snapshot` 与 `get` 是两次观察，不能保证期间文件没变；M01a 可以让详情显示它实际读取的内容与来源，并在导出时比较内容摘要。正式不可变版本留给 M01b。宿主在发现阶段就忽略的无效文件不会出现在 registry 摘要中：仅接 registry 的第一版必须说明观察范围，**不能宣称已经扫描并证明全部工作区包有效**；完整无效包清单随文件管理能力补上。上述依据是宿主 [snapshot/get](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L462)、[无效文件处理](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L804)。

M01a 的行为测试应经过管理模块和实际面板 RPC，至少覆盖：

1. 内置任务、persona、向导和工作区技能均按范围展示；persona/setup 可查看导出但没有普通运行许可；原件和覆盖件同名时选中与下载内容正确。
2. 同次读取的正文与 metadata 一致；一个 get 失败保留其他结果并展示该项错误；snapshot 不完整、registry 缺席、真正空工作区各自可辨。
3. 详情后文件变更、来源从工作区切换到内置、旧工作区响应迟到时不会导出错误对象或覆盖当前页面。
4. Markdown 能被固定宿主的 frontmatter 规则读取；名称、说明、metadata 与正文保留；文件名不含目录跳转；原始正文作为文本展示，不执行嵌入 HTML；引用资源时明确导出范围。
5. 读取、筛选、详情和下载均不调用模型、Worker、CLI、计划变更、远端写入或配置写入。测试记录这些外部入口零调用，不仅比对静态文案。

已有 `skills.test.mjs` 的单次 get／轨拒绝用例、`panel-rpc.test.mjs` 的面板边界、`client.test.mjs` 的真实 DOM 可复用；另在隔离真实 Loader 下核对所用 runtime registry 能列出 builtins、来源字段和工作区正文。目录只读与 Markdown 生成不依赖 ZIP／文件发布研究完成；新增包写入仍需完成后文的 watcher 与发布恢复验证。

## 版本与证据口径

| 对象 | 本次实际核对 | 证据范围 |
|---|---|---|
| 24私助插件 | `0.2.1-rc.2.9`，上述提交 | 源码与既有测试；新工作树尚未安装依赖，本次不声称完整测试通过 |
| dsh 源码 | `/Users/pc2026/DSH-Space/deepseek-harness`，`1600d8a1e140dcde43a1a0941940a0480712c011`，工作树干净 | CLI、skill、skill-filesystem、schedule 的源码 manifest 均为 `0.2.1-rc.1` |
| 主仓库现有安装包 | `@deepseek-ai/dsh-skill`、`dsh-schedule` 为 `0.2.1-alpha.2` | 导入其公开根核对方法存在性，并运行相同纯时间探针；不据此宣称与 rc.1 的全部语义等价 |
| 官方契约 | 固定提交的官方源码与其公开类型 | 引用下文固定提交链接；没有用“最新文档”替换项目实际兼容版本 |

版本来源：[插件 manifest](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/package.json#L2)、[宿主 Skill manifest](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/package.json#L4)、[Schedule manifest](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/schedule/schedule/package.json#L4)、[CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/apps/cli/package.json#L4)。旧研究中“安装 alpha.2、测试 CLI rc.1”仍须分别记录，不可混称同一宿主版本。

新工作树的 `link-peer.mjs` 和真实 Loader 测试默认以仓库相邻路径寻找 `deepseek-harness`；当前 managed worktree 位置不满足该相对布局。实施时应显式核对依赖与 `DSH_BIN`，不要把原目录依赖可用推断为新工作树测试环境已就绪。[开发依赖链接](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/scripts/link-peer.mjs#L11)、[Loader 入口](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/tests/helpers/host.mjs#L13)

## Skill：已有底座与缺口

| 能力 | 已证实的现状 | Manticore 差距与可落地入口 |
|---|---|---|
| 发现与读取 | `SkillRegistryLike` 接 `register/list/get`；内置由 `builtinAll()` 提供，工作区由宿主发现。 | 管理目录须独立于可执行目录；增加状态和来源观察，不把加载失败当不存在。 |
| 执行准入 | `resolve` 一次取得正文及 metadata，检查来源、轨和工具声明；agent 入口拒绝模板。 | 缺参数 schema、资源范围、依赖验证、持久启用／禁用及授权变更对比。 |
| persona／向导 | 内置件存在；普通 `resolve` 排除 persona 和 setup，`list` 也因此不显示。 | 管理页要可看、下载、复制，但不可把它们放入普通定时执行选择。 |
| 自定义执行 | `delegate(worker=skill)` 检查角色启用及 `extraBusinessSkills`，WorkItem 保存 `skill_definition`；续办重验当前放行。 | 没有本地面板直接试运行／运行闭环；应复用现有准入与父会话归属，再挂新的运行档案。 |
| 上传／新建／编辑／下载 | 本插件没有包 CRUD 或 ZIP 接口；宿主只提供发现、读取和注册能力。 | 新增管理模块；下载必须包含已确认包内资源及依赖说明，排除运行参数、历史和凭据。 |
| 版本／回退／删除 | WorkItem 保存完整定义；计划绑定字符串 `skill`；没有稳定管理 ID、版本清单或禁用状态。 | 稳定 ID 与可变显示名分开；保存不可变包版本，计划关联 ID；更新、回退、禁用、删除按引用与历史规则办理。 |
| 包资源与后台权限 | 宿主定义有 `resourceBase/path`；24PA 的 `ResolvedTaskSkill` 只保留正文和 metadata。 | 包资源尚未快照；后台静态资源读取和只读网页能力需专门受控接口，不能开放通用 Shell／文件工具来补缺。 |

代码依据：[Skill 类型与 adapter](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/skills.ts#L11)、[目录及过滤](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/skills.ts#L318)、[准入持久定义](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/runtime.ts#L1653)、[续办与子会话工具面](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/runtime.ts#L1741)、[计划类型](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/repo/digest.ts#L9)。

### 宿主目录契约不能替代包管理

- **已证实：**`list/snapshot` 返回同名获胜摘要；`snapshot.complete` 表示发现完成且 revision 稳定，不是内容版本。`get` 返回一次完整定义，没有跨多次读取的版本承诺。`register` 重复同名会忽略，不是更新接口。registry 不提供包导入、安装、删除、回退或 ZIP 服务。[官方注册与观察](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L440)
- **已证实：**文件 provider 从项目 `.dsh/skills`、`.agents/skills`、自定义及用户根发现，返回资源基目录；24PA 当前执行只接纳内置与 `project-dsh`。默认同名胜者会遮住原件，因此管理视图若要同时说明内置原件和个人副本，不能只展示 registry 获胜列表。[官方来源与资源](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L209)
- **已证实：**宿主忽略缺 frontmatter、无效 YAML、缺 name/description、名称或 invocation 无效的文件；24PA `list()` 还会吞掉 `resolve` 失败。管理模块需要维护文件／包清单和加载问题，才能展示“无效／待修复”，否则失效项会消失。[官方文件校验](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L804)、[本地 list](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/skills.ts#L354)
- **待验证：**filesystem provider 有 watcher，宿主 `write/edit` 的 `fs/observed` 会同步通知；普通 Node 文件写入不走该事件。provider 的 `invalidate` 不属于 registry 公共写入接口。发布后立即查询、禁用 watcher、重命名、目录原子替换及手工编辑都须隔离验证；不能私调 registry cache 或用临时假注册碰巧刷新。[官方监听入口](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L135)、[provider 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L379)

包管理实施要以可信工作区根为边界，验证 ZIP 相对路径、符号链接、重复路径、解压大小和文件数量；先完整校验，再发布新版本，导入不能执行 scripts。版本快照覆盖资源内容，不能仅保存指向可变目录的路径。文件发布和账本引用之间需要可恢复提交顺序，不能宣称跨文件与数据库天然原子。这些是新导入能力的实施验收要求，当前代码未验证。

工具声明目前能**拒绝超出白名单的名称**，但子会话 `toolFilter.allow` 仍由角色工具面构造，不根据 `metadata.tools` 做运行时交集；也没有按资源／操作类别的 Skill 授权档案。因此“声明不越权”已有依据，“按计划授权逐步强制收紧”仍需实现和测试。[声明校验](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/skills.ts#L294)、[实际工具 allow](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/runtime.ts#L1817)

## 定时任务：复用原生时间引擎，扩展业务计划

**已证实可复用：**`PlanLifecycle` 将创建／更新／删除意图先持久化，通过 `catalog` 核对未知回执、按完整 expected 比较更新、保留待清理 schedule ID；按计划串行且固定工作区归属。原生计划仍绑定固定飞书接入顶层 Session，随后委派 Worker，符合 [ADR-0001](../adr/0001-workspace-session-boundaries.md)。不需要另写 cron/DST 引擎。[计划协调模块](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/plan-lifecycle.ts#L21)、[原生适配面](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/host.ts#L108)

| Manticore 目标 | 当前证据与差距 |
|---|---|
| 同 Skill 多计划、名称、参数、复制、保存为暂停 | `enablePlan` 只允许 morning/evening/weekly/once；周期 ID 由工作区＋kind 固定，同类型已有计划阻止另建。需新增独立计划身份和通用参数，不复用类型作身份。 |
| 一次、每日、工作日、每周、每月、间隔、高级规则及未来预览 | 宿主公开 `at/every/daily/weekly/cron`，足以表达所列规则；本地 `timing/fixedSpec` 只处理 at/daily/weekly，需要扩展 adapter 和预览，保留旧 ID。 |
| 启用选择与阻断原因分开、回收还原 | 当前只有 active/paused/stopped 和配置操作 lifecycle；没有多原因阻断、软删除／还原或显式授权档案。 |
| 暂停不终止当前运行；手动暂停可单次运行 | 当前 `runPlanNow` 拒绝非 active；`digestBuild/digestDeliver/completeRun` 均检查 active，暂停会阻止在途结果发布。需将未来触发门禁与已接纳运行资格分开。 |
| 输入、Skill 版本、资源和投递目标固定 | 通用 Skill WorkItem 已保存正文定义；digest 在 build 和 deliver 重新解析当前 skill，occurrence 只固定事实时间区间。缺包版本、参数和资源快照。 |
| 默认变化不重定向旧计划 | 计划只保存 voice/skill/time 等；`deliverReport` 读取当前 config，并经当前 ownerNotification 选渠道／目标。需显式保存计划目标，不能由全局默认隐式决定。 |
| 同计划不重叠，全局上限 | WorkItemLifecycle 已有全局 maxWorkers；唯一 `(plan_id, window_key)` 防同窗口重复，不能证明不同窗口／手工触发不重叠。需计划级 active run 门禁与跳过记录。 |
| 停机只补最近一次，1 小时有效期 | 宿主 recurrence 返回最近应发生点和下一未来点；产品级“仍有效”判断、一次性过期需处理及未执行事件记录仍需实现。 |

代码依据：[计划创建与控制](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/digest-service.ts#L136)、[本地规则限制](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/plan-lifecycle.ts#L195)、[build／deliver 现读定义](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/digest-service.ts#L344)、[投递配置](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/digest-service.ts#L458)、[立即运行限制](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/digest-service.ts#L539)、[全局排队](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/work-item-lifecycle.ts#L43)、[窗口与发布事务](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/repo/digest.ts#L102)。

宿主 `create` 没有调用方幂等键，`delete` 不撤回已入队消息，`catalog` 空结果不能证明在途 create 未发生；这些既有研究结论本次复核仍成立。继续沿用 `PlanLifecycle` 的未知核对和业务门禁，不退回 create 报错后直接重建。[官方 create/catalog/delete/update](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/schedule/schedule/src/index.ts#L228)、[第二轮研究](2026-10-19-第二轮计划与skill执行研究.md)

## 运行档案、等待与预算

**运行记录已有证据，但对象粒度不足。**WorkItem 的 `execution_id/execution_scope` 为宿主输入结算身份，`beginExecution` 会更新当前值；`digest_occurrence` 保存窗口、报告、错误和 Outbox 关联；外部动作、投递各有账本。它们不是完整的“交办关联多条主运行，运行内含多尝试”的产品模型。现有面板用最近 50 条 WorkItem 和近期 Outbox 拼时间线，不支持目标规定的全量计数、7／30 天筛选、Skill 版本筛选和脱敏导出。[WorkItem 身份](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/repo/work.ts#L9)、[digest 发生行](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/repo/digest.ts#L29)、[面板快照](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/panel.ts#L119)

**等待恢复需新主运行模型承接。**WorkItem 已有 waiting_input、停止、补充与继续；续办建立新的宿主输入身份和恢复代次。Manticore 要求未结束运行继续保留同一主记录，只有结束后的显式接续新建运行；两者可以兼容，但不能把每次 `execution_id` 变化都当新主运行。当前没有累计执行耗时、等待区间、15 分钟剩余时限或预算阻断持久字段，也没有连续三次最终运行失败与内部三次自动尝试的分离计数。[当前恢复逻辑](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/work-item-lifecycle.ts#L62)、[当前行字段](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/repo/work.ts#L30)

**预算目前只观测，未控制。**`onTurnEnd` 递增进程内计数，健康页明确返回“无 quota 配置项、重启清零”；计数不是 token、实际费用或跨重启用量。配置仅有 maxWorkers 和模型路由，没有限额／一次放行。不能用目前卡片替代 Manticore 预算验收。[计数位置](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/runtime.ts#L1617)、[真实健康输出](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/runtime.ts#L3061)、[配置字段](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/config.ts#L56)

可复用的固定宿主接口如下，均须在实施时做真实 Loader 隔离验证：

| 接口 | 已证实 | 实施约束／待验证 |
|---|---|---|
| `agent/pre-step` waterfall | 可拒绝新步骤。被领取输入在拒绝后不会自动放回 inbox，也不产生对应 user/message。 | 预算不足前须将待恢复输入和运行关联耐久保存；放行只解除预算阻断，停止后不复活。不能只 return reject。 |
| `agent/request` | 请求配置在调用前解析，实际 adapter 配置随后记录。 | 展示实际 provider/model，不能只展示预设配置；对请求重试的记账范围须核验。 |
| `assistant/message.usage` | 可带 adapter 提供的 TokenUsage；缺失表示未提供。中途取消可能有部分 usage。 | 按持久事件身份去重汇总；缺失／部分覆盖不计作零费用，估价依据与供应商账单分开。 |
| `step/start/end`、工具与会话事件 | 能观察执行边界；现有 work completion 可按输入身份结算。 | 应以持久执行区间累计模型和工具耗时，重启、重试不清零；等待主人／预算、排队不计入。崩溃边界要有明确恢复口径。 |

官方依据：[pre-step 与 request 语义](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/src/runtime-types.ts#L288)、[usage 与部分输出](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/session/src/types.ts#L332)、[agent loop 的步骤与请求](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/src/agent.ts#L297)。这些是扩展入口，并不等于宿主已经提供产品级预算或可恢复等待时钟。

## 结果、投递与跨运行恢复

已有结果与 Outbox 同事务提交、已知发送回执只修复本地关联、未知外部结果不盲重发，可直接复用。当前 Outbox 的最多三次发送尝试属于投递重试，不能拿来充当执行重试或最终运行失败次数。[结果与发送意图](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/repo/digest.ts#L172)、[投递状态机](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/outbox-delivery.ts#L34)

需补计划自有投递目标、仅保存／每次／仅变化／仅异常策略、普通结果 1 小时有效期、异常通知免打扰后的可靠发送、正文／语音分项状态及详细诊断 90 天保留。仅变化基准是上次成功**执行**结果，即便通知过期仍按该结果比较；这是已确认行为，不改成上次成功送达。[产品结果规则](../planning/24PA-Manticore-产品定稿.md#结果与投递)、[当前投递组装](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/digest-service.ts#L458)

跨运行未知结果尤其需要补绑定：当前 `ExternalOperations.stage` 的默认 ID 含 `workItem.id`，同一交办内可稳定拒绝未知重做；若重跑或新触发生成新 WorkItem，单靠该键不能阻止重建同一业务动作。新增主运行必须继承原动作关联／核对阻断，明确哪些是原动作接续、哪些是主人新授权的新业务，而非一律换键。[外部动作身份](https://github.com/benz-ai-x/dsh-24-PA/blob/67172733b0405718edd78e19d114a5ef6adc4db7/packages/24pa/src/external-operations.ts#L13)

## 本次无副作用验证

使用 Node 导入两套本地公开根，不创建 registry／ScheduleService 实例：

| 探针 | rc.1 源码构建与 alpha.2 安装产物的实际结果 |
|---|---|
| Skill 可见方法 | `registerProvider/register/list/snapshot/get`；核查范围内无 import/export/install/uninstall 方法 |
| Schedule 可见方法 | `create/list/catalog/history/delete/update`；公开 at/every/daily/weekly/cron builder 和 `resolveCronOccurrence` 均存在 |
| `0 9 31 * *`，Asia/Shanghai，从 2026-04-01 起 | 下一次 `2026-05-31T01:00:00.000Z`，跳过没有 31 日的四月 |
| 周一至周五 09:00，从周五 09:00 后起 | 下一次 `2026-10-26T01:00:00.000Z`，即周一；不解释法定节假日 |
| 上述 31 日规则到 2026-08-01 才处理 | 最近发生 `2026-07-31T01:00:00.000Z`，下一次 `2026-08-31T01:00:00.000Z`；不会枚举补发所有错过月份 |

这证明公开函数可表达时间语义，未验证业务 1 小时过期门禁、真实重启／入队／执行、包发布或预算恢复。固定官方接口见 [create 请求类型](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/schedule/schedule/src/types.ts#L370)、[cron occurrence](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/schedule/schedule/src/domain.ts#L1098)。

## 研究复用、实施依赖与验收清单

[第二轮计划与 Skill 执行研究](2026-10-19-第二轮计划与skill执行研究.md) 的原生计划未知恢复、同次 definition 与时间接口结论可复用；其当时“待修复”列表已被本基线的 `PlanLifecycle` 和持久 `skill_definition` 部分落实，不能原样抄成新缺陷。[R3-A 宿主契约](2026-10-19-R3-A执行边界与宿主契约.md) 的真实输入身份、作用域和切换排空继续有效；[R3-D 周期事项研究](2026-10-19-R3-D周期事项与提醒归属契约.md) 的等待检查点是特定业务跟进，不能代替通用 Skill 等待恢复。旧测试为回归起点，本次未重新运行。

建议依赖顺序为：**管理目录 → 包身份／版本／导入导出 → 通用运行档案与授权 → 通用计划 → 等待时钟／预算／投递策略 → 全链路恢复验收**。日历／待办来源登记与具体资源绑定由对应工作并行推进，计划启用须等其稳定接口可用。不要先把当前 digest 的字符串名和当前默认资源复制到新界面，再补快照与权限。

| 实施范围 | 必须补的验收 | 复用测试／组 |
|---|---|---|
| 管理目录 | 内置、个人、persona、向导正确分类；加载失败与空分开；同名来源清晰；切工作区不串资料；查看不启模型 | `skills.test.mjs`、`panel-rpc.test.mjs`；T17/T20 |
| 包与版本 | MD／ZIP 往返完整；同名默认副本；更新保留原版本；路径穿越／链接越界拒绝；原子发布中断后可恢复；手工改动冲突可见；下载不含凭据及计划参数 | 新管理模块行为测试＋真实文件 provider；T14/T17/T19 |
| 运行与授权 | 模板不进模型；试运行记录真实动作；旧版本和包资源冻结；撤销范围立即阻止新动作；个人副本不被内置更新覆盖 | `skill-delegation.test.mjs`、真实 Loader；T01/T04/T14 |
| 通用计划 | 同 Skill 多计划；暂停只阻止未来；暂停时单次跑后仍暂停；禁用只解除对应阻断；删除还原为暂停；默认 A→B 不改绑；移除 A 阻断但保留历史 | `plan-lifecycle.test.mjs`、`plan-panel.test.mjs`、双后端；T10/T14/T20 |
| 等待与失败 | 执行 2 分钟＋等待 20 分钟仍余 13；重启、内部重试不重置；迟到放行不复活停止运行；三个内部失败不冒充三次最终失败；新触发不与等待运行重叠 | 新运行状态机＋真实 Session/Loader；T05/T06/T07/T10 |
| 预算 | usage 缺失不报零；累计跨重启去重；到限拦下一受管步骤；一次放行有归属和范围；已发请求成本如实计入；其他阻断不被清掉 | 宿主 pre-step/request 隔离验证＋双后端；T04/T14/T17 |
| 结果／跨运行 | 保存成功投递失败只补投；未知后停止再重跑仍先核对；迟到回执修复原记录；“仅变化”比较成功结果；24 小时／7 天统计与全量分页一致 | `digest-reliability.test.mjs`、`work-item-lifecycle.test.mjs`、`work-settlement.e2e.mjs`；T07/T08/T10/T20 |

上述未实现项应进入 Manticore 工单和正式规格的对应测试组；本研究不修改正式规格、TODO、GitHub 事项或实现，也不把源码核查、旧验收或纯函数探针算作本轮功能交付。
