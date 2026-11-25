# dsh 0.2.3-alpha.2 适配核验（插件 0.2.3-alpha.2.1）

2026-11-25。上一适配基线：`dsh 0.2.2-rc.3` / 插件 `0.2.2-rc.3.1`，记录见 [rc.3 适配核验](dsh-0.2.2-rc.3-适配核验.md)。目标为 npm `alpha` 的 `0.2.3-alpha.2`，插件版本 `0.2.3-alpha.2.1`；不使用版本豁免。

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
| 版本与依赖 | `packages/boot/app-boot/src/plugin-compatibility.ts:51-60`、`profile.ts:699-706`、`plugin-manager/src/operations.ts:363-380` | 版本 `0.2.3-alpha.2.1`；`engines.dsh` 与两个 dsh peer 精确 `0.2.3-alpha.2`；Node `^24.22.3 \|\| >=26.13.1`；Cordis `~4.2.0-alpha.1`、Schemastery `~3.20.0-alpha.1`；`dsh-web-app` 开发依赖与锁文件同步。守卫测试增加「预设基线与 `engines.dsh` 同版本」 |
| 子代理首条任务来源 | `packages/subagent/subagent/src/manager.ts:406-412`、`continuation-messages.ts:64-76`（alpha.1，提交 `b48cfeedd9`，不在 rc.5） | dsh 0.2.3 把受管子代理的首条任务记为父会话中继的 Agent 消息，并在内容前加一个发送方文本块。`src/host-turn.ts` 新增 `isDelegatedInputSource`：起始输入接受「父会话中继」与「`user`」（升级前写入的会话），续办输入只认父会话中继。`worker-runs.ts` 两处、`work-completion.ts`、`skill-run-host.ts` 的 `ownsInput` 改用它 |
| 测试夹具 | 同上；`packages/core/system-prompt/src/index.ts:487` | mock 宿主默认产出中继形态（`tests/helpers/runtime.mjs`；`startInputSource: 'user'` 代表升级前写入的会话）。dsh 0.2.3 的 system-prompt 新增必需依赖 `sessionProjections`，`tests/helpers/tool-runtime.mjs` 先挂载真实注册表，`scripts/link-peer.mjs` 补链接 `dsh-session-projection` |
| 既有 e2e 断言 | 真实宿主实测 | `manticore-budget`：业务运行的起始输入改按运行标记定位，并核对来源（本地＝`user`，业务＝`agent-message`）。`f13`：断言 `cordis_inspect` 不进入本地会话。`host-upgrade`：改为 rc.3 → alpha.2 |
| 标准预设 | `packages/bundle/web-app/presets/standard.patch.yml:128-129` | 重新生成，新增 `tool-cordis`。24私助本地会话的工具清单在升级前后逐项相同（34 个） |
| 工作区规则分节（既有缺陷，顺带修复） | `packages/core/system-prompt/src/index.ts:399-420`，rc.3 起如此 | 宿主对分节做 `{{name}}` 插值，畸形或未注册的引用会抛错。`src/tools.ts` 为该分节传 `interpolate: false`，`src/host.ts` 的类型改为 `boolean` |
| 候选构建命令 | 干净导出实测 | README 原命令 `npm --prefix packages/24pa pack --pack-destination ../../artifacts` 打包的是当前目录（仓库根无版本号），在 npm 11.17.0 与 11.19.1 下均以 `Invalid package` 退出。改为 `mkdir -p artifacts` 后 `npm pack ./packages/24pa --pack-destination ./artifacts` |
| 新实例安装步骤 | 官方 rc.3 与 alpha.2 CLI 对照实测 | 初始化指南阶段 3 补两步：先 `--from-default-profile web` 创建 profile（自定义名字的 profile 由 `dsh plugin add` 自动初始化时只带基础 bundle，不含 web 应用）；安装前把 `allowBuilds` 下的 `protobufjs` 设为 `true`。坑 A 的处置改为 remove 后重新 add：占位符导致的失败之后原样重跑虽然退出码为 0，但不会把插件层登记进 `dsh.profile.bundles`。达标标准增加该列表项。依据是 `apps/cli/src/plugin.ts:48` 与 `packages/boot/app-boot/src/profile.ts` 的 `loadProfileDirectory` |

文档同步：根与包的中英文 README、初始化指南版本表与 Node 行、随包 `weixin-setup.md`。新版本在文档中标为候选（本地构建、未发布）。

## 静态上无需修改的调用

- **sessionController**：`create`、`prompt`、`resolveAgent`、`rename`、`state` 签名未变；`clientTimeZone` 传入即生效，省略仍为 `unavailable`。会话头 `cwd` 改记规范化真实路径；24私助绑定工作区时已 `realpath`，在符号链接临时目录下的全部 e2e 通过。
- **connection.fetch**：`/api/24pa` 精确路由与 owner 门禁未变；认证改为注册式 provider，浏览器换 cookie 后调用正常。
- **systemPrompt.section**：签名只增可选字段；同名注册不再抛错；函数 `text` 每次装配求值一次。
- **tools、事件、skills、Schedule、浏览器面、加载器**：逐项结论见研究文档的核验表。

## 复现与验证

真实宿主测试显式使用隔离安装的官方 npm CLI（`--version` 已核对：alpha.2＝`0.2.3-alpha.2`，rc.3＝`0.2.2-rc.3`），运行在隔离的官方 Node 24.22.3 上（SHA-256 与官方清单一致）。模型、飞书、企微、微信均使用隔离桩。

- **复现**：适配前（只改版本与预设）在 alpha.2 上 `f01` 8 例中 5 例失败，事项状态为 `needs_reconciliation`（「原交办会话收到未关联输入」）；适配后 8/8。
- **构建与单元测试**：`npm run build`、`npm run preset:check` 通过；全量单测 1810 通过、1 跳过。
- **反向验证**：撤去四处起始输入判定后，`work-completion` 与 `delegated-input-source` 共 50 例中 32 例失败，旧形态用例照常通过。撤去 `interpolate: false` 后，宿主 `renderPrompt` 抛出 `unknown prompt variable "{{model}}" in section "24pa-workspace-rules"`。
- **最终全量**（提交 `72b0c41`，e2e 一律安装最终 tarball，跨版本用例启用，21:52 开始）：2019 通过、1 失败、1 跳过。失败是 `manticore-home` 的日历计数（预期 2、实际 1）：夹具把第二个日程定在 `Date.now() + 2h`，22 点后运行即跨入次日；同一时刻在 rc.3 基线（未改动的 `0.2.2-rc.3.1`＋rc.3 宿主）上得到相同失败。该用例在 19 点余的首轮全量中通过，与本次适配无关。跳过的 1 例是既有的单测跳过。
- **候选包定向**（提交 `099f575` 的 tarball，代码与最终提交相同）：跨版本 1/1、运行控制 19/19、Skill 运行 19/19、微信 11/11、手写权限 8/8、`f01` 8/8、`f13` 5/5、备份 1/1、预算 9/9。
- **跨版本**：`host-upgrade.e2e.mjs` 用 rc.3 官方 CLI 与正式包 `0.2.2-rc.3.1`（sha1 `8de82270…`，与 registry 一致）产生等待数据，再由 alpha.2＋候选包恢复：原工作编号、运行编号、父会话、投递目标及两条输入均采用一次。
- **工具清单对照**：真实 alpha.2 上，宿主标准预设会话的 32 个工具含 `cordis_inspect`，24私助本地会话的 34 个工具不含，f13 的断言因此不是空通过。rc.3 基线同法测得本地清单逐项相同；标准预设侧由 `working_directory` 换为 `cordis_inspect`。
- **全新实例安装**：从 web 模板创建 profile、预先批准 `protobufjs` 构建、`dsh plugin add` 一次成功，`dsh.profile.bundles` 含插件，宿主启动并打印面板地址。跳过预批时坑 A 在 rc.3 与 alpha.2 上原样重现；remove 后重新 add 可完成登记，两条线一致。
- **浏览器**：Chrome 158 无头模式打开令牌地址，侧栏出现「24私助工作区」，点击后面板渲染首页与五个分类标签；页面内 `POST /api/24pa` 返回 200，就绪行显示 dsh `0.2.3-alpha.2`＋插件 `0.2.3-alpha.2.1`；1280×800、1440×900、1920×1080 无横向溢出、无告警、无控制台异常。浅色与深色各一屏见 [screenshots/dsh-0.2.3-alpha.2-panel-light.png](screenshots/dsh-0.2.3-alpha.2-panel-light.png) 与 [screenshots/dsh-0.2.3-alpha.2-panel-dark.png](screenshots/dsh-0.2.3-alpha.2-panel-dark.png)。

主要命令（真实宿主命令均设置 `DSH_BIN` 指向官方 CLI 的 `lib/bin.js`；候选包验证另设 `PA24_E2E_PACKAGE`，跨版本另设 `PA24_E2E_LEGACY_DSH_BIN` 与 `PA24_E2E_LEGACY_PACKAGE`）：

```sh
npm run build
npm run preset:check
PA24_E2E_STORAGE=sqlite npx vitest run
```

候选包按 README 步骤从 `git archive HEAD` 的干净导出构建：`npm --prefix packages/24pa install`、`npm --prefix packages/24pa run build`、`mkdir -p artifacts`、`npm pack ./packages/24pa --pack-destination ./artifacts`。

### 候选制品

`benz-ai-x-dsh-24pa-0.2.3-alpha.2.1.tgz`（本地制品，不随 PR 入库），159 个文件，压缩 719.9 kB，解包 2.7 MB，由提交 `72b0c41` 生成。`package.json` 为 `0.2.3-alpha.2.1`，`engines.dsh` 精确 `0.2.3-alpha.2`，包含生成后的 `cordis.patch.yml` 与 `lib`，不包含测试或锁文件。

SHA-256：`b17faf07f69cc01ae222612a551cada38e71383c6f5f2af1a8a629f656e41985`

### 未决与明确边界

- `manticore-budget.e2e.mjs` 存在与本次适配无关的时序偶发。断言修正后整文件连续重跑 18 次，11 次全绿，7 次各有一个失败：5 次是「等待放行期间执行时长不变」的断言（多出约 60ms），2 次是本地会话的委派在 60 秒内没有产生事项。前者在 rc.3 基线上同样出现（5 次中 1 次，幅度相同）；后者发生在事项创建之前，不在本次改动的代码路径上，带诊断输出的 8 次重跑未再现。未修改产品代码或该用例来掩盖。
- 宿主 `experimental/webhook` 每次投递新建根会话且不回传，不适用24私助的固定接入会话；宿主 SQLite 会话后端为显式选装，备份校验仍固定读取 JSONL provider。
- 已提交的锁文件按 `--legacy-peer-deps` 生成，README 的普通 `npm install` 会自动补装 peer 并改写锁文件；构建不受影响，该差异未在本轮处理。
- `list_subagent_models` 不在24私助本地白名单内，rc.3 时即如此，未在本轮处理。
- 未验证：真实飞书／企微／微信账号、生产 8010 升级、Desktop 应用内安装（profile 由应用独占管理）、npm 与 GitHub Release。

后续新增功能与兼容性变更只针对 SQLite；PostgreSQL 暂停开发，既有实现与历史数据兼容保留。
