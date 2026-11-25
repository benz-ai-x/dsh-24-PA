# dsh 0.2.3-alpha.2 适配核验（插件 0.2.3-alpha.2.1）

2026-11-25 起，验证收尾于 2026-11-26。上一适配基线：`dsh 0.2.2-rc.3` / 插件 `0.2.2-rc.3.1`，记录见 [rc.3 适配核验](dsh-0.2.2-rc.3-适配核验.md)。目标为 npm `alpha` 的 `0.2.3-alpha.2`，插件版本 `0.2.3-alpha.2.1`；不使用版本豁免。

本人于 2026-11-25 裁决：只做 `0.2.3-alpha.2.1`，不出 `0.2.2-rc.5.1`；`cordis_inspect` 不加入本地白名单。实施前研究、24私助消费面的逐项核验、宿主新能力与自建实现的对照见[宿主升级研究](2026-11-25-dsh-0.2.3-alpha.2-宿主升级研究.md)。

## 官方来源与范围

- 官方仓库：[rc.3](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3)＝`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`，[rc.4](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.4)＝`3f321d32bfe382212a8ed8785c1d47a5a300aa23`，[rc.5](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.5)＝`9c2670d3bce5275e0d1610272958121af87787bb`，[alpha.1](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.3-alpha.1)＝`d98f5d68519215da48f3002da2cb9c9d2068d81d`，[alpha.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.3-alpha.2)＝`4b399c39a6d1479cd84ca591b4d7c88e24d38a96`。
- npm（2026-11-25）：`@deepseek-ai/dsh` 的 `latest`＝`next`＝`0.2.2-rc.5`，`alpha`＝`0.2.3-alpha.2`。`dsh-feishu`、`dsh-wecom`、`dsh-cli-account`、`dsh-upstream-skills` 只有 0.2.3-alpha 线版本，不在出厂组合里。
- 宿主 `engines.node` 为 `^24.22.3 || >=26.13.1`；Cordis 4.2.0-alpha.1、Schemastery 3.20.0-alpha.1，宿主 npm 包声明的 Cordis peer 为 `~4.2.0-alpha.1`。
- 升级指南目录按基线命名，记录「从该基线升上来」的变化：rc.4 标签实有 1 条，rc.5 累计 2 条，alpha.2 累计 40 条，其中 38 条不在任何 rc 标签。rc.3→rc.5 的标准预设逐字节相同；alpha.2 新增 `tool-cordis` 一行。
- rc.4、rc.5 的两条变化（拒绝码、web search 缺省 provider）不涉及24私助代码；模型网关前置的部署需按对应指南处理 web search 端点。
- 宿主新能力（连接器、子进程缝等）与阶段二计划留在研究文档，不在本轮实施范围。

## 确定性适配

| 消费面 | 官方证据 | 24私助影响与处置 |
|---|---|---|
| 版本与依赖 | `packages/boot/app-boot/src/plugin-compatibility.ts:51-60`、`profile.ts:699-706`、`plugin-manager/src/operations.ts:363-380` | 版本 `0.2.3-alpha.2.1`；`engines.dsh` 与两个 dsh peer 精确 `0.2.3-alpha.2`；Node `^24.22.3 \|\| >=26.13.1`；Cordis `~4.2.0-alpha.1`、Schemastery `~3.20.0-alpha.1`；`dsh-web-app` 开发依赖同步。锁文件由 README 记载的普通安装命令重新生成，干净克隆不再依赖相邻的宿主源码目录。守卫测试增加「`dsh-web-app` 开发依赖与 `engines.dsh` 同版本」 |
| 子代理首条任务来源 | `packages/subagent/subagent/src/manager.ts:406-412`、`continuation-messages.ts:64-76`（alpha.1，提交 `b48cfeedd9`，不在 rc.5） | dsh 0.2.3 把受管子代理的首条任务记为父会话中继的 Agent 消息，并在内容前加一个发送方文本块。`src/host-turn.ts` 新增 `isDelegatedInputSource`：起始输入接受「父会话中继」与「`user`」（升级前写入的会话），续办输入只认父会话中继。执行输入的判定收在 `src/work-completion.ts` 的 `isWorkExecutionInput`（运行标记加来源），`worker-runs.ts` 两处与完成核验共用；`skill-run-host.ts` 的 `ownsInput` 直接用 `isDelegatedInputSource` |
| Worker 子会话标题 | `packages/session/session-title/src/index.ts:139`、`:509`（rc.3 与 alpha.2 相同）；首条任务的来源见上一行；`packages/api/session-controller/src/agent.ts:99-111`、`:169-174`；宿主插件先例 `packages/schedule/schedule/src/runtime.ts:494-501`、`packages/experimental/webhook/src/session.ts:127` | 宿主只对来源为 `user` 的输入生成标题。rc.3 及更早的宿主把子会话首条任务记为 `user`，子会话有按首条消息生成的兜底标题；dsh 0.2.3 记为 Agent 消息，子会话在宿主会话列表里没有标题。`src/runtime.ts` 在 `startActivation` 之后用会话标题服务（`sessionTitle`）以子代理目录的标签命名子会话（「角色 · 事项标题」）。会话控制接口拒绝给子代理归属的会话改名（「is owned by subagent routing」，两条线相同），不能用。Skill 运行会话由会话控制接口创建并命名，是普通会话，不受影响 |
| 测试夹具 | 同上；`packages/core/system-prompt/src/index.ts:487` | mock 宿主默认产出中继形态（`tests/helpers/runtime.mjs`；`startInputSource: 'user'` 代表升级前写入的会话）。dsh 0.2.3 的 system-prompt 新增必需依赖 `sessionProjections`，`tests/helpers/tool-runtime.mjs` 先挂载真实注册表，并以 `mountAgentScope` 供工具域用例复用；`scripts/link-peer.mjs` 补链接 `dsh-session-projection` |
| 既有与新增 e2e 断言 | 真实宿主实测 | `manticore-budget`：业务运行的起始输入改按运行标记定位并核对来源（本地＝`user`，业务＝`agent-message`），采样前等时钟走稳。`manticore-home`：第二个日程夹具限定在当日之内，晚间运行不再跨入次日。`f13`：断言 `cordis_inspect` 不进入本地会话。`host-upgrade`：改为 rc.3 → alpha.2。新增 `worker-session-title`：子会话在宿主会话列表里的标题 |
| 标准预设 | `packages/bundle/web-app/presets/standard.patch.yml:128-129` | 重新生成，新增 `tool-cordis`；生成头注释改为「基线 `0.2.3-alpha.2`，已核验兼容至该版本」，生成脚本同步。24私助本地会话的工具清单在升级前后逐项相同（34 个） |
| 工作区规则分节（既有缺陷，顺带修复） | `packages/core/system-prompt/src/index.ts:399-420`，rc.3 起如此 | 宿主对分节做 `{{name}}` 插值，畸形或未注册的引用会抛错。`src/tools.ts` 为该分节传 `interpolate: false`，`src/host.ts` 的类型改为 `boolean` |
| 候选构建命令 | 干净导出实测 | README 原命令 `npm --prefix packages/24pa pack --pack-destination ../../artifacts` 打包的是当前目录（仓库根无版本号），在 npm 11.17.0 与 11.19.1 下均以 `Invalid package` 退出。改为 `mkdir -p artifacts` 后 `npm pack ./packages/24pa --pack-destination ./artifacts` |
| 诊断文案 | `src/sqlite.ts` | Node 门槛提示与新的 `engines.node` 一致 |

文档同步：根与包的中英文 README（候选版本的本地构建与安装命令、版本表、锁文件说明）、初始化指南的版本表与 Node 行、随包 `weixin-setup.md`。新版本在文档中标为候选（本地构建、未发布）。初始化指南阶段 3 的安装步骤缺口早于本次适配，已移出本 PR，见下文「未决与明确边界」。

## 静态上无需修改的调用

- **sessionController**：`create`、`prompt`、`resolveAgent`、`rename`、`state` 签名未变；`clientTimeZone` 传入即生效，省略仍为 `unavailable`；`rename` 只能给普通会话改名，Worker 子会话的命名走会话标题服务（见上表）。会话头 `cwd` 改记规范化真实路径；24私助绑定工作区时已 `realpath`，在符号链接临时目录下的全部 e2e 通过。
- **connection.fetch**：`/api/24pa` 精确路由与 owner 门禁未变；认证改为注册式 provider，浏览器换 cookie 后调用正常。
- **systemPrompt.section**：签名只增可选字段；同名注册不再抛错；函数 `text` 每次装配求值一次。
- **tools、事件、skills、Schedule、浏览器面、加载器**：逐项结论见研究文档的核验表。

## 复现与验证

真实宿主测试显式使用隔离安装的官方 npm CLI（`--version` 已核对：alpha.2＝`0.2.3-alpha.2`，rc.3＝`0.2.2-rc.3`），运行在隔离的官方 Node 24.22.3 上（SHA-256 与官方清单一致）。模型、飞书、企微、微信均使用隔离桩。

- **复现**：适配前（只改版本与预设）在 alpha.2 上 `f01` 8 例中 5 例失败，事项状态为 `needs_reconciliation`（「原交办会话收到未关联输入」）；适配后 8/8。
- **构建与单元测试**：`npm run build`、`npm run preset:check` 通过；README 记载的普通安装命令执行后 `package-lock.json` 无差异。工作区内全量单测（提交 `92010ee` 的代码）1818 通过、1 跳过。
- **干净导出**：`git archive cf59180` 的导出不链接相邻的宿主源码目录，按 README 的普通安装命令安装（锁文件无变化）、构建并打出的 tarball，就是下文全量与全新实例安装所用的制品。导出内的全量里，单测 1817 通过、1 失败（下文的既有偶发）、1 跳过，e2e 39 个文件 209 例全部通过。
- **反向验证**（提交 `cf59180` 的导出，逐项撤去适配并重新构建，未改动的导出作对照）：未改动的导出 112 例全过。起始输入改回只认 `user` 后，5 个单测文件 110 例中 36 例失败（Worker 运行日志、完成核验、Skill 运行归属、来源判定）。撤去 `interpolate: false` 后，2 例中 1 例失败，宿主渲染器抛 `unknown prompt variable "{{model}}" in section "24pa-workspace-rules"`。撤去 Worker 子会话命名并重新打包后，真实 alpha.2 上 `worker-session-title` 失败（标题为 `null`）。
- **最终全量**（提交 `cf59180` 的导出，e2e 一律安装由同一导出生成的 tarball，跨版本用例启用，11-26 00:39 开始，20.7 分钟）：2026 通过、1 失败、1 跳过（150 个文件）。失败是 `tests/unit/worker-run.test.mjs` 的「最终通知更新原调用；明确未执行的取消不冒充未知」，属下文的既有偶发。同日 23:57 起的第一次重跑作废：零点后机器被系统后台维护拖慢，`f10` 与 `manticore-task-plan` 挂起、预算用例等待超时，清理中断残留后重跑得到上述结果。PR 头与 `cf59180` 的包内容相同（其后只有本文改动）。
- **跨版本**：`host-upgrade.e2e.mjs` 用 rc.3 官方 CLI 与正式包 `0.2.2-rc.3.1`（sha1 `8de82270…`，与 registry 一致）产生等待数据，再由 alpha.2＋候选包恢复：原工作编号、运行编号、父会话、投递目标及两条输入均采用一次。
- **工具清单对照**：真实 alpha.2 上，宿主标准预设会话的 32 个工具含 `cordis_inspect`，24私助本地会话的 34 个工具不含，f13 的断言因此不是空通过。rc.3 基线同法测得本地清单逐项相同；标准预设侧由 `working_directory` 换为 `cordis_inspect`。
- **Worker 子会话标题**（真实宿主，同一条委派）：rc.3＋正式包 `0.2.2-rc.3.1` 上，子会话在事项完成后约 100ms 得到按首条任务文字生成的兜底标题（「事项：<事项标题> 委托」）。alpha.2 上经会话控制接口改名的版本（提交 `3c2f4fa`）单独重跑 6 次，子会话 10 秒内始终没有标题：宿主拒绝该调用，错误被吞掉；这由新增的真实宿主用例在第二轮全量中查出。改为会话标题服务后（提交 `92010ee`）事项完成时标题即可读出，`worker-session-title` 连续 5 次通过；对同一会话经会话控制接口直接改名，两条线都返回「is owned by subagent routing」。
- **规则分节转换**（alpha.2，同一条本地会话连续四次模型请求）：绑定工作区后，规则分节进入首次请求的系统提示；重载为另一份规则、再重载为空规则，每次变化都以一条 system 角色消息送达，内容为「The following replaces the earlier instructions from 24pa-workspace-rules.」加当前规则文本，最近一次的消息反映当前内容；切换到没有规则的工作区后新会话里只剩固定的引言。分节退役的提示路径没有被触达（工作区配置有效时分节始终注册）。
- **模型侧请求**（全新实例，24私助本地会话的首次模型请求，两条线逐项一致）：34 个工具，其中 `pa24_*` 8 个，不含 `cordis_inspect`；系统提示约 1.15 万字符，含24私助的身份、协调流程、业务要点等分节标题，没有任何 Skill 目录（没有 Skill 标题，正文只有两处提到「Skill」）。宿主连接器插件只有 0.2.3-alpha 线版本且只经插件市场分发，未安装，不在本次验证范围。
- **全新实例安装**（最终 tarball，全新目录）：从 web 模板创建 profile、预先批准 `protobufjs` 构建、`dsh plugin add` 一次成功（退出码 0），`dsh.profile.bundles` 含 `@benz-ai-x/dsh-24pa`，就绪行显示 dsh `0.2.3-alpha.2`＋插件 `0.2.3-alpha.2.1`，宿主标准错误为空。rc.3 官方 CLI 安装正式包 `0.2.2-rc.3.1` 同法通过。
- **浏览器**：Chrome 158 无头模式打开令牌地址，侧栏出现「24私助工作区」，点击后面板渲染首页与五个分类标签；「事务与计划」卡的「查看 Skill」列出24私助的 18 个内置 Skill，「查看运行档案」的「助理交办」子页与交办详情（概览、完成标准、交办操作、历史）正常渲染；页面内 `POST /api/24pa` 返回 200，就绪行显示 dsh `0.2.3-alpha.2`＋插件 `0.2.3-alpha.2.1`；最终 tarball 的全新实例上，1440×900、1280×800、1920×1080 三个视口的文档宽度都等于视口宽度（无横向滚动），五个分类标签齐全，页面没有告警；此前的截图走查里也没有控制台异常。浅色与深色各一屏见 [screenshots/dsh-0.2.3-alpha.2-panel-light.png](screenshots/dsh-0.2.3-alpha.2-panel-light.png) 与 [screenshots/dsh-0.2.3-alpha.2-panel-dark.png](screenshots/dsh-0.2.3-alpha.2-panel-dark.png)。

主要命令（真实宿主命令均设置 `DSH_BIN` 指向官方 CLI 的 `lib/bin.js`；候选包验证另设 `PA24_E2E_PACKAGE`，跨版本另设 `PA24_E2E_LEGACY_DSH_BIN` 与 `PA24_E2E_LEGACY_PACKAGE`）：

```sh
npm run build
npm run preset:check
PA24_E2E_STORAGE=sqlite npx vitest run
```

候选包按 README 步骤从 `git archive` 的干净导出构建：`npm --prefix packages/24pa install`、`npm --prefix packages/24pa run build`、`mkdir -p artifacts`、`npm pack ./packages/24pa --pack-destination ./artifacts`。

### 候选制品

`benz-ai-x-dsh-24pa-0.2.3-alpha.2.1.tgz`（本地制品，不随 PR 入库），159 个文件，压缩 720.3 kB，解包 2.9 MB，由提交 `cf59180` 生成。`package.json` 为 `0.2.3-alpha.2.1`，`engines.dsh` 精确 `0.2.3-alpha.2`，包含生成后的 `cordis.patch.yml` 与 `lib`，不包含测试或锁文件。

SHA-256：`75a1aaef95b0a6082335cfdeadd10062be0220651a20f2950624dd465bf6f205`

### 未决与明确边界

- **打开网页会改写24私助空白自有会话的预设（既有缺陷，两条线相同）**：网页加载时，前端对工作区里一个仍为空白的会话发 `session/create`（只带 `workspaceId` 与 `sessionId`，不带预设），宿主随即把该会话的预设改成 `standard`；被选中的是24私助的本地助理会话或飞书接入会话（本地会话已有输入时轮到飞书接入会话）。被改写的本地会话发给模型的请求是 25 个工具、没有24私助身份；快照里的本地会话编号不变，直到面板的「打开」动作（`robot.open`）触发 `openLocalSession` 复查并新建 `pa24` 会话。飞书接入会话被改写后，向它提交的输入到达模型时没有任何工具、没有24私助身份；入站路径（`submitToSession`）直接使用该会话、不复查预设，「打开」动作也不恢复它（飞书入站未做端到端模拟，此项依据代码与直接提交的实测）。rc.3＋正式包 `0.2.2-rc.3.1` 与 alpha.2＋候选包表现相同。本次未修，另立事项跟踪。
- `manticore-budget.e2e.mjs` 存在与本次适配无关的时序偶发。首轮 18 次重跑中 7 次各有一个失败：5 次是「等待放行期间执行时长不变」的断言（多出约 60ms），2 次是本地会话的委派在 60 秒内没有产生事项；前者在 rc.3 基线上同样出现，后者发生在事项创建之前，不在本次改动的代码路径上。采样前等时钟走稳后，最终全量中 9/9 通过。
- `tests/unit/worker-run.test.mjs` 的「最终通知更新原调用；明确未执行的取消不冒充未知」偶发失败（`expected 'unknown' to be 'failed'`）：未改动的 rc.3 基线源码 14 次重跑中 1 次失败，提交 `72b0c41` 的导出 12 次中 2 次；最终全量里出现 1 次，同机同状态下对照，`cf59180` 的导出与 rc.3.1 基线各重跑 10 次都是 2 次失败。与本次适配无关，未修改产品代码或该用例来掩盖。
- 初始化指南阶段 3 照原文执行得不到可用的实例，缺口早于本次适配：自定义名字的 profile 由 `dsh plugin add` 自动初始化时只带基础 bundle，不含 web 应用（`apps/cli/src/plugin.ts:48`）；坑 A 失败后原样重跑 add 退出码为 0，却不把插件层登记进 `dsh.profile.bundles`。可行步骤（先 `--from-default-profile web` 创建、安装前批准 `protobufjs` 构建、失败后 remove 再 add）已在 rc.3 与 alpha.2 上实测，因超出本次授权范围移出本 PR，另行提交待本人确认。
- 宿主 `experimental/webhook` 每次投递新建根会话且不回传，不适用24私助的固定接入会话；宿主 SQLite 会话后端为显式选装，备份校验仍固定读取 JSONL provider。
- `list_subagent_models` 不在24私助本地白名单内，rc.3 时即如此，未在本轮处理。
- 未验证：真实飞书／企微／微信账号、生产 8010 升级、Desktop 应用内安装（profile 由应用独占管理）、npm 与 GitHub Release。

后续新增功能与兼容性变更只针对 SQLite；PostgreSQL 暂停开发，既有实现与历史数据兼容保留。
