# Manticore M01b：Skill 包、持久版本与宿主刷新研究

研究日期：2026-10-20。对应 M01b／#214 的开发前置研究；本轮只核查与隔离验证，不代表功能已交付，不修改产品源码、规格、TODO 或 GitHub。

## 结论与建议基线

**建议采用 SQL 中的不可变完整包版本，以及同一事务内更新的当前版本指针；通过宿主公开 `registerProvider()` 接入 Skill 目录，提交后调用本 provider 的 `control.invalidate()`。** 这条路径已经用固定宿主实际 registry 和临时 SQLite 验证，可避免“先写目录、再写数据库”双重提交与 watcher 延迟。资源从固定版本读取；如需本地资源目录，它只是可重建缓存，不承担版本权威。

保留现有 `.dsh/skills` 文件入口，但不要把受管包再投影成同名可变文件并当成第二权威。文件条目可以继续被宿主发现；将其纳入受管版本需要显式导入／采纳，并保存当时的包字节。**手改文件不自动改写受管版本，管理界面应区分文件条目、受管副本和待采纳变化。** 这是本研究提出的实施方案，尚未成为正式产品／领域决策；根代理应在开发前同步这一边界，不能以研究文档静默更改既有文件编辑语义。

**必须按稳定 Skill ID 和版本身份执行，不能以同名 registry 条目作为回退。** 探针已证明：停用自定义 provider 中的条目后，按名称查找会露出较低优先级的同名 runtime 条目。显示名称、宿主名称、来源、管理 ID 与版本 ID 不能混用。禁用、删除、改名与旧计划迁移的门禁由业务账本负责，宿主 registry 只做发现与加载。

依据：[已审核定稿](../planning/24PA-Manticore-产品定稿.md#skill-管理规则)、[SPEC 第 16 节](../24PA-v1-SPEC.md#16-manticore-统一执行契约213)、[宿主 provider 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L379)、[宿主同名合并](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L551)。

## 来源、固定版本与验证范围

| 来源 | 固定点／实际使用 | 用途与限制 |
|---|---|---|
| 24PA | 基线 `91aff7c96a59cab2cf00fa2eaf379008079d55a2`，已合并 M01a；包 `0.2.1-rc.2.9` | 读取根规则、产品／领域规则、GLOSSARY、ADR-0001、SPEC 2.13、Manticore 定稿、现有研究；不以旧交付标签判断 M01b 完成。 |
| 官方宿主源码 | `/Users/pc2026/DSH-Space/deepseek-harness`，commit `1600d8a1e140dcde43a1a0941940a0480712c011`；skill 与 skill-filesystem `0.2.1-rc.1` | 核查公开源码，并导入该 checkout 的编译产物运行隔离 registry／filesystem provider。 |
| 已安装宿主 | 主 checkout `packages/24pa/node_modules` 中 skill／skill-filesystem `0.2.1-alpha.2`，Cordis `4.0.5-alpha.1` | 同一组关键探针另跑一次，结果相同；不由此推断其他宣称兼容的宿主版本也通过。新 worktree 直接解析部分 peer 不完整，未把它冒充完整宿主环境。 |
| 探针环境 | macOS，本机 Node `v26.4.0`，`node:sqlite`，临时目录 | 无模型、账号、凭据、真实业务 API 或生产数据；没有跑真实 Loader／Session／PostgreSQL／机器断电恢复。 |
| YAML | `yaml@2.9.0`，git `ddb21b04cb889722cec8f89dc1b67f19d62d7f7d` | 现有项目 devDependency，同版本在临时目录验证；正式运行时使用须改为直接 runtime dependency。 |
| ZIP 读写 | `yauzl@3.4.0`，git `f5798e15204ffbb9a428b00217e4659684a41b0f`；`yazl@3.3.1`，git `20584c378c654fc5b5ad141697ec539d7cb27c9e` | 从官方 npm registry 固定版本安装到 `/tmp`，关闭 lifecycle scripts；按作者源码／文档核查，不使用博客结论。 |

宿主实际导入的 rc.1 构建 SHA-256：skill `4b88621be4e7ff09b05c175fc6dcb67e77a22e5c5570e3aa603338b2937ea791`；skill-filesystem `783214a95cc531c82567925ed0afabfdee5c091a56c4b1c1e1bce523b948ee02`。源码固定点与构建指纹都保留，避免只写 package version。本研究复用[前次能力核查](2026-10-20-Manticore-Skill与执行能力核查.md)，并把其中 provider 刷新“待验证”细化为下述实证。

## 可直接依赖的公开宿主契约

| 契约 | 已核实事实 | 实施影响 |
|---|---|---|
| `registerProvider(factory)` | 工厂同步注册；收到 `signal` 与 `invalidate()`；同层 provider 名唯一；注销使 signal abort，旧 control 随后失效。 | 在插件 apply 注册一次；数据库初始化／查询放在 list/get；生命周期与工作区切换正确清理。不要动态改私有 cache。 |
| `list(options)` / `get(candidate, options)` | provider 接受 `cwd`、AbortSignal；candidate 有 provider/source/rank/opaque locator；get 按 locator 加载。 | locator 可固定 `{workspaceId, skillId, versionId}`；服务内再核验工作区与权限。不得把任意调用方 cwd 当成已授权工作区。 |
| 来源与资源 | `SkillSource` 允许自定义字符串；`resourceBase` 可是 directory、url、opaque。 | 可用清楚的受管来源，不必假装文件 provider。opaque 只说明来源，不自动提供 Worker 资源读取能力。 |
| 同名与作用域 | 同层 rank 越小越优先；近作用域覆盖远作用域；registry 返回同名胜者。 | 管理目录应独立保留内置原件／受管身份；rank 是发现策略，不是授权。默认同名副本应产生唯一宿主名称。 |
| 失效与缓存 | 缓存按 cwd、scope 链、revision；公开控制只有注册生命周期和 provider invalidate，没有公共通用 `refresh()`。 | 提交后 invalidate 是必须步骤；工作区绑定变化也要失效。不要假注册临时 Skill 刷新缓存，也不要伪造 `fs/observed` 写工具身份。 |
| 不完整发现 | provider.list 抛错时 registry 保留其他 provider，snapshot.complete=false；get 失败／不存在不自动成为空目录证明。 | 管理界面保留数据库／provider 故障状态；不能因局部失败回落同名旧技能或声明完整空结果。 |
| filesystem 的同步通知 | 官方插件订阅 `fs/observed`，仅 write/edit actor 触发；公开 `FileSystemSkillProvider.observeHostMutation()` 对其所观察根做失效。 | 24PA 未持有现有 filesystem provider 实例，普通 Node 写文件不会自动调用该路径。自有 provider control 才是可直接掌握的契约。 |

源码：[类型定义 41–110](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L41)、[provider/control 246–275](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L246)、[注册 390–428](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L390)、[get/cache 500–619](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill/src/index.ts#L500)、[文件 provider 133–235](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L133)。

现有 24PA `SkillRegistryLike` 尚未声明 registerProvider；`SkillCatalog.resolve` 仅接纳 builtin/project-dsh；M01a 选择身份也只处理内置与项目文件。新 provider 接入必须一起扩展 adapter、管理选择、来源判定与执行门禁；不能只注册后便声称已可运行。[当前 adapter](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/skills.ts#L48)、[执行来源门禁](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/skills.ts#L388)、[M01a 管理模块](https://github.com/benz-ai-x/dsh-24-PA/blob/91aff7c96a59cab2cf00fa2eaf379008079d55a2/packages/24pa/src/skill-management.ts#L1)。

## 隔离探针与结果

以下是本次实际运行结果。rc.1 和已安装 alpha.2 两组 provider 探针均通过；它们验证的是契约组合，不是 24PA 尚未实现的产品功能。

| 场景／操作 | 实测结果 | 结论与恢复 |
|---|---|---|
| watch=false，先读取空目录，再由 Node 写入新 Skill | 再 list 仍为空；通过本探针持有的 filesystem provider 调用 observeHostMutation 后立即出现。 | 不能以文件 write 成功承诺宿主目录已刷新。 |
| 同名称 SKILL.md 经临时文件 rename 替换 | get 立即读到新正文；list 的旧摘要仍可能存在。 | 宿主目录快照不是不可变包版本；正文与摘要可处在不同观察时间。 |
| frontmatter 名称改变、文件路径不变 | list 暂保留旧名；get(旧名) 返回 undefined 并使下一次 list 得到新名。 | 不应依赖某人碰巧读取旧名来刷新。 |
| 新目录 rename 覆盖已有非空包目录 | 本机返回 `ENOTEMPTY`。 | “替换目录原子发布”不是可直接套用的方案；移旧再放新有缺口，也不与 SQL 原子。 |
| 查看后人工修改原文件 | 重新读取内容哈希与 expectedHash 不一致，能检测这次改动。 | 乐观冲突检测有效；它不是对不配合锁的编辑器建立了原子多文件快照，也不能消除检查与覆盖之间的竞态。 |
| SQL 插入 v1＋active 同事务；registry 之前已缓存空结果 | 未 invalidate 前不可见；invalidate 后立即 get 到 v1。 | 使用提交后通知，并回读实际版本。 |
| v2 提交后 invalidate | get 立即变成 v2；此前取出的 v1 内容及数据库 v1 行仍在。 | 包版本不可变；新运行读当前，已接纳运行固定旧版本。 |
| 查询另一 cwd | managed-one 不出现。 | provider 自己实现 workspace 隔离可行，不能只靠注册表。 |
| 两个更新都基于同一旧 revision，后者提交 | CAS 不匹配抛错，整个事务回滚；冲突的新版本行也没有留下。 | 每次保存／回退需 expectedRevision；不要最后写入静默获胜。 |
| 未提交事务内插入版本后关闭数据库，再打开 | 未提交行不存在；active 仍是 v2。 | 证明此受控中断／重开路径；没有模拟 SIGKILL、断电或 PostgreSQL。 |
| 提交 v4 后省略 invalidate | SQL 已是 v4，registry 仍给旧 candidate 对应的 v2；补 invalidate 后读 v4。 | “提交成功、通知未完成”可修复。不能因此再次创建版本；应按幂等操作 ID 查询结果并重做通知。 |
| disabled 使 provider 不再列出同名条目 | registry 返回同名 runtime 的旧正文。 | 运行入口按管理身份与启用状态拒绝；不能 name fallback。 |
| provider 注销后调用旧 control.invalidate | 不再发送失效事件。 | 生命周期保护有效；新注册必须保留自己的 control。 |

可复核探针位于 `/tmp/manticore-m01b-probe/`：`provider-probe.mjs`、`provider-alpha2.mjs`、`zip-fixtures.py`、`archive-probe.mjs`、`archive-result.json`。运行命令为 `node /tmp/manticore-m01b-probe/provider-probe.mjs`、`node /tmp/manticore-m01b-probe/provider-alpha2.mjs` 和 `node /tmp/manticore-m01b-probe/archive-probe.mjs`。脚本只创建随机 `/tmp/manticore-m01b-data-*` 数据库和样本；材料是合成文本，无真实业务信息。全部命令已结束；watcher 从未启用，数据库已关闭，无遗留服务或后台会话。临时文件保留供人工复核，不是仓库正式测试资产。

## 持久版本、发布与失败恢复方案

最小数据边界建议为：Skill 稳定 ID／工作区／名称／来源／状态／revision；不可变 Version 保存解析后定义、原始 SKILL.md、资源文件清单及完整字节、每文件哈希和包哈希；activeVersionId 选择当前发布版本。可以用 JSON/base64 适配现有双后端，也可用适配器支持的二进制字段；必须对解压后原始字节和编码后的账本大小分别限额，不能因为编码进 SQL 就忽略内存与存储上限。

发布步骤：接收限额内上传 → 完整解析与校验 → 构造不可变包 → 在事务内核验 expectedRevision／名称唯一性／工作区，写 Version、当前指针及审计操作 ID → commit → invalidate → 回读 ID 与版本。正文编辑产生完整新版本，未改资源必须复制或可靠引用原版本不可变内容；回退变更当前选择并记录新的修订／审计，不能覆写历史版本。任意输入内容都不能自动变成宿主权限。

| 失败点 | 建议恢复语义 |
|---|---|
| ZIP／YAML 校验失败或大小超限 | 没有发布动作；保留可理解错误，不把半包写为 active。草稿保存与可执行发布分开。 |
| CAS 失败、名字冲突、事务失败 | 保留旧 current；返回当前 revision 和冲突信息；默认另存副本，明确更新才重试。 |
| commit 已成功而 RPC 回执丢失 | 用幂等操作 ID 回读同一结果，不重复生成版本；再次 invalidate 安全。 |
| commit 成功但刷新未完成 | 标明“已保存、宿主发现待刷新”，重试通知／重建注册；不能声称数据库回滚，也不能让旧 registry cache 作为执行准入依据。 |
| 进程重启 | provider 从数据库 current 重建，重做必要通知；无须恢复被修改一半的权威资源目录。真实宿主重启尚须正式验证。 |
| 文件入口并发手改 | 保存原始所见 hash；采纳前后重新检查可观察变化并报冲突。不覆盖外部手改文件。要严格同一时点的多文件输入，应上传已完成 ZIP 或使用受管编辑事务。 |
| 可选资源缓存写入中断 | 以版本 hash 命名的临时目录完整写入、校验后发布；旧版本目录不覆写；残留 staging 可回收。读取固定版本仍以 SQL 字节为准，损坏／缺失缓存可重建。 |
| 原包已停用／删除或授权撤销 | provider 缺席不等于许可；业务入口拒绝新运行，历史版本仅按历史查看／重跑门禁使用，不能切到其他同名来源。 |

这里数据库原子性来自同一事务，不包含外部文件、模型或业务平台动作。SQLite 原子提交依赖其正确的 journal／同步配置与文件系统；本次关库重开不是断电证明。[SQLite 官方原子提交说明](https://www.sqlite.org/atomiccommit.html)。PostgreSQL 的现有适配器、事务 CAS、重复请求与 schema migration 尚需正式双后端验证。

## Markdown 与 ZIP 库选择

**Markdown 内容不必先渲染 HTML，也不需要为了 frontmatter 增加执行型模板引擎。** 建议沿用宿主同族的 `yaml@2.9.0`，自行切分开头 `---` 包围的 frontmatter，正文原样保留作为包内容；解析后的正文语义可与宿主 trim 规则对齐。使用 parseDocument、唯一键校验、检查 errors/warnings，并在 toJS 时禁止 alias 扩展；再做严格字段 schema、类型、深度／节点数、文本长度校验。整个解析和转换都要 try/catch。`yaml` 2.9.0 官方明确撤销了 parseDocument “永不抛错”的表述，不能把恶意输入异常留给进程顶层。[宿主 parser 924–949](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/skill/skill-filesystem/src/index.ts#L924)、[YAML 官方选项](https://eemeli.org/yaml/#options)、[2.9.0 release](https://github.com/eemeli/yaml/releases/tag/v2.9.0)。

本次 YAML 探针：合法 mapping 通过；重复 name、alias、自定义 JS tag、数组根、字符串形式 invocation boolean 均被校验组合拒绝。这是包输入策略，**比宿主“能解析”更严格**；引入时应明确兼容性错误。现有 metadata 的参数、工具声明仍需业务 schema 校验，不能因 YAML 成功就标“已授权”。

**ZIP 建议 `yauzl@3.4.0` 读取、`yazl@3.3.1` 输出**。前者支持逐项 await、校验名称与声明解压尺寸；启用 strictFileNames，限制原始上传大小，逐项读取而非同时解压所有文件。后者从已保存版本的 Buffer 构建输出，避免导出期间再次遍历可变目录。两者都不是完整安全策略：应用必须检查文件类型、路径冲突、配额、内容 hash、排除范围；yauzl 不检查解压内容 CRC，本次已实际观察到内容被改而库照常返回，需自行核对 entry.crc32。CRC 用于完整性，包版本身份仍用 SHA-256。[固定 yauzl 源码](https://github.com/thejoshwolfe/yauzl/blob/f5798e15204ffbb9a428b00217e4659684a41b0f/index.js#L309)、[CRC 限制](https://github.com/thejoshwolfe/yauzl/blob/f5798e15204ffbb9a428b00217e4659684a41b0f/README.md#no-crc-32-checking)、[固定 yazl addBuffer](https://github.com/thejoshwolfe/yazl/blob/20584c378c654fc5b5ad141697ec539d7cb27c9e/index.js#L81)。

不要直接采用全量 unzipSync 后再统计尺寸；超限之前可能已分配大内存。最终依赖必须锁确切版本并走项目构建／包分发验证；临时 npm 安装不是项目已引入依赖的证据。无需再引入一套 Markdown AST 库，除非后续真的需要渲染或结构化编辑。

## 完整包校验与秘密边界

下列是依据公开 ZIP 字段与本次攻击样本提出的应用校验要求。库的文件名检查覆盖一部分路径规则，剩余规则由 24PA 实现，不能声称库默认全包办。[yauzl 文件名和 entry 字段](https://github.com/thejoshwolfe/yauzl/blob/f5798e15204ffbb9a428b00217e4659684a41b0f/README.md#validatefilenamefilename)。

| 边界 | 实施要求 | 本次证据／仍待测 |
|---|---|---|
| 包入口 | MD 组成单文件 SKILL.md 包；ZIP 必须有唯一明确 SKILL.md；可支持唯一包装目录但不能猜多 Skill 包中的主文件。 | 三文件标准包通过；包装目录、多入口规则待正式测试。 |
| 路径 | 拒绝绝对路径、盘符／UNC、反斜杠、`..`、`.`／空段、NUL／控制字符、异常冒号；校验解码后的最终路径，不能先写后检查。 | traversal／absolute／backslash 已拒绝；Windows 特殊名称、空段、Unicode 无效编码等需补正式样本。 |
| 同名与碰撞 | 拒绝重复条目、文件与目录占位冲突、规范化／大小写后碰撞；包括 wrapper 去除后的碰撞。不能直接放 Map 让后者覆盖前者。 | 重复、大小写、NFC/NFD、文件目录冲突均拒绝；纯库确实允许重复条目，Map 会只留最后内容。 |
| 类型 | 只接普通文件和目录；按 external attributes 拒绝 symlink、设备、FIFO 等；导入不执行 scripts、不解递归嵌套包。 | Unix symlink fixture 被拒绝；其他特殊类型、加密、异常压缩方式待正式测试。 |
| 配额与炸弹 | 同时限制压缩输入、条目数、单项和合计声明大小；解压流逐块再计实际字节，超限立刻停止并释放资源。压缩比可作补充，不能代替绝对限额。 | 1 MiB 重复内容被探针限额拒绝；声明 8 字节而展开 8192 字节触发库流错误。探针阈值为单项 64 KiB／合计 128 KiB，不是产品最终上限。 |
| 完整性 | 验证 CRC，计算每文件与确定性包清单 hash；资源按字节保存，不仅记路径。 | 损坏的 Stored 内容由补充 CRC 拒绝；正常 SKILL.md、reference、二进制 asset 导出再导入，三个文件逐字节相同。 |
| 文件系统输入 | 遍历范围只限明确选择的包根；lstat 拒绝链接，校验真实路径不越界；中途替换／改动要冲突。不得读取包外依赖来凑“完整”。 | 本次只验证单文件变化哈希；真实目录竞争、symlink 交换及完整包稳定采纳尚未验证。 |
| 依赖说明 | 保留包内声明、版本／安装说明和凭据引用的名称；“已声明”“已验证”分开，导入不执行安装。 | 尚未定义依赖说明 schema；不能把脚本文件存在当成后台允许执行脚本。 |
| 导出范围 | 只从已校验不可变版本的文件清单生成 ZIP；排除计划参数、运行历史、工作区配置、环境和专门凭据存储。禁止遍历整个 workspace／资源父目录。 | `.env` 样本被策略拒绝；完整往返探针没有访问真实凭据。 |
| 内嵌秘密 | 禁止已知秘密路径／字段与私钥等明确敏感内容；发现时拒绝或要求用户移除，不能静默漏文件却标“完整包”。 | 任意说明或二进制夹带秘密无法由文件名白名单证明不存在。正式实现须定义检测与报错边界，不能声称通过 ZIP 校验就绝对无秘密。 |

参数模板、metadata、README 以及脚本内容都是不可信输入；它们不得自行改变 provider 身份、工作区绑定、授权状态或控制字段。后台最多读取已接纳版本中的获准静态资源，上传 scripts 不赋予 Shell。来源包中的“执行我／给权限／上传凭据”不构成用户授权。依据仍是[已审核通则与包规则](../planning/24PA-Manticore-产品定稿.md#工作对象与权限)。

## 开发前仍需闭合的项

1. **文件与受管权威语义：**确认并同步“文件发现继续存在，采纳创建受管快照；受管更新不反写源文件”的具体交互。它解决并发覆盖，但会改变用户把 `.dsh/skills` 手改理解成受管版本即时发布的预期。没有发现 ADR-0001 冲突；不得借此扩大 Worker 文件权限。
2. **宿主兼容与来源迁移：**registerProvider 缺席时管理保存、宿主可见与可运行状态分别表达；基线只验证 rc.1 和 alpha.2，不覆盖 package.engines 全矩阵。确定 provider 作用域、rank、唯一名称、工作区切换清理；旧按名称计划迁移为稳定身份时不得误绑同名对象。
3. **持久版本正式实现：**双后端事务／CAS／幂等、断进程恢复、历史删除与引用保护、禁用后的回退阻止、重启后 provider 重建；本次 SQLite 关库重开只能作为实现依据，不能代替验收。
4. **资源与授权：**opaque resourceBase 不会自动形成资源工具；运行快照 API、依赖验证、新权限比较、撤销后阻断与在途版本冻结须和执行研究对接。可选目录缓存的 symlink 防护、权限、fsync、失败清理和 hash 重建未实测。
5. **包输入与导出最终策略：**固定配额、目录包装规则、依赖 schema、秘密识别范围、CRC 在最低支持 Node 的实现、异常 ZIP／YAML 的中断与资源释放，再补产品级行为测试。`node:zlib.crc32` 在本次 Node 可用，最低 Node 22.19.0 仍需按官方 API 与实际构建核验。

可进入设计／实现的接口事实已经明确；上述事项应成为 M01b 的开发与验收基线。此文不宣称 M01b 包 CRUD、版本、禁用、删除、运行或完整管理已交付。
