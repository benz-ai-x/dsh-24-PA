# dsh 0.2.1-rc.5 适配核验

核验日期：2026-10-31。适配前基线：`@benz-ai-x/dsh-24pa@0.2.1-rc.4.2`，`@deepseek-ai/dsh-web-app` devDependency 精确 pin `0.2.1-rc.4`，`engines.dsh` 与 dsh/dsh-schedule peer 三串覆盖至 rc.4。候选包版本按仓库规则取 `0.2.1-rc.5.1`。

本文先以官方 Git 与 npm 包内容完成静态核验，再由主任务在隔离环境执行构建、真实 Host、全量测试与发布包验证；实测结果见「本地实测与边界」。

## 结论

**rc.5 对 24PA 属于元数据适配，静态检查未发现需要修改产品源码、业务存储 schema、Session 迁移或 Web 注入代码的变化。** 必须完成：

- 包版本改为 `0.2.1-rc.5.1`；`@deepseek-ai/dsh-web-app` devDependency pin 改为 `0.2.1-rc.5`。
- `engines.dsh`、`peerDependencies['@deepseek-ai/dsh']`、`peerDependencies['@deepseek-ai/dsh-schedule']` 同扩 `|| 0.2.1-rc.5`，守卫测试的基线清单同步加入 rc.5。不得用版本豁免代替扩围。
- 重新生成锁文件和 `cordis.patch.yml`。只读生成试算显示后者仅两行头注释的基线版本变化，正文不变；仍须由后续 `preset:sync` / `preset:check` 实证。
- 保持 24PA 的 `@deepseek-ai/cordis` peer `~4.0.5-alpha.1`；上游 cordis 范围没有变化，无需借机改串。

主要风险是混装 rc.4/rc.5 的精确 pin 依赖、把 prepare 后的本机链接误当成 npm 锁树，以及部署 profile 中另行安装的自定义 reasoning 渲染器；最后一项不影响 24PA 自身代码。

## 官方发布身份与提交范围

主来源为官方仓库 [dsh-v0.2.1-rc.4](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.4)、[dsh-v0.2.1-rc.5](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5)、[官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.4...dsh-v0.2.1-rc.5) 和 npm 官方 tarball。两个 Git tag 都是 lightweight tag，直接指向以下 commit：

| 基线 | commit | npm tarball / SHA-1 |
|---|---|---|
| rc.4 | [`504a01a9578abc2c6f1fb896b1dc322c9fe24f66`](https://github.com/deepseek-ai/deepseek-harness/commit/504a01a9578abc2c6f1fb896b1dc322c9fe24f66) | [dsh](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.4.tgz) `15d3fd3e6046bab974c3ad4dba57452c2d2824e7`；[web-app](https://registry.npmjs.org/@deepseek-ai/dsh-web-app/-/dsh-web-app-0.2.1-rc.4.tgz) `608b45ef01425c21e082baa9ad723c533ec7ae9b` |
| rc.5 | [`b830ec950faba0a46dda564be3e2d854afed94f1`](https://github.com/deepseek-ai/deepseek-harness/commit/b830ec950faba0a46dda564be3e2d854afed94f1) | [dsh](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz) `8e1bfd31869414f7a5ec10c34403a852ac9c3dc7`；[web-app](https://registry.npmjs.org/@deepseek-ai/dsh-web-app/-/dsh-web-app-0.2.1-rc.5.tgz) `8a06f532ae30e2f5bc52c299fa8d915035be4429` |

`git rev-list --count dsh-v0.2.1-rc.4..dsh-v0.2.1-rc.5` 为 **4**，反向为 0，merge-base 即 rc.4 tag。范围为：

| commit | 性质 | 对 24PA 的意义 |
|---|---|---|
| [`083bdcf6252e46183c35810798ceee78b1f77a47`](https://github.com/deepseek-ai/deepseek-harness/commit/083bdcf6252e46183c35810798ceee78b1f77a47) | 合并 rc.4 发布分支；树与 rc.4 tag 相同 | 无新增变化；它出现是因为 rc.4 tag 位于该合并的第二父提交 |
| [`534dac8c81662689169fcca12c52066c59a57058`](https://github.com/deepseek-ai/deepseek-harness/commit/534dac8c81662689169fcca12c52066c59a57058) | 唯一功能提交：`fix(web): customize thinking block rendering (#7484)` | 改变思考块显示与 reasoning Body Slot props；24PA 不消费该 Slot，见下文 |
| [`31cfe2aafead959a4dbd9d8cfaae258eb28a19fd`](https://github.com/deepseek-ai/deepseek-harness/commit/31cfe2aafead959a4dbd9d8cfaae258eb28a19fd) | rc.5 版本号发布提交 | dsh 系列包版本及精确依赖 pin 升至 rc.5 |
| [`b830ec950faba0a46dda564be3e2d854afed94f1`](https://github.com/deepseek-ai/deepseek-harness/commit/b830ec950faba0a46dda564be3e2d854afed94f1) | 合并 rc.5 发布分支；树与 `31cfe2aafe` 相同 | 无额外功能变化 |

排除 package manifest、文档和测试后，tag 间只有 7 个源码文件变化：`ui-chat` 的 `ReasoningContent.tsx`、`ReasoningRow.tsx`、`contract/slots.ts`、`process-activity.ts`、新增 `reasoning-text.ts`，实验性 cot-translation 的 `TranslationBody.tsx`，以及 cordis-client-runner 的 `slot-catalog.ts`。实质行为是对以 `<signature>…</signature>` 开头的 reasoning 过滤该展示前缀、在 Body Slot 中同时提供原始与展示文本，并同步翻译包装和 Slot 元数据；不是 Loader、Session、Schedule 或 24PA 所用布局/侧栏契约变化。

## 24PA 消费面逐项核验

| 消费面 | 官方源码 / 包内证据 | 判断与适配 |
|---|---|---|
| 插件加载与 `engines.dsh` | rc.4→rc.5 的 `packages/boot/app-boot/src`、`packages/boot/plugin-manager/src` 无源码差异。[`plugin-compatibility.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/boot/app-boot/src/plugin-compatibility.ts#L53-L73) 规定：存在 `engines.dsh` 时只由它决定宿主兼容性，否则才检查 dsh peers，预发布参与匹配 | **必须扩三串**。rc.4.2 的 `engines.dsh` 不含 rc.5，不能直接视为可装载；peer 两串仍按仓库守卫与安装解析要求同步。无需版本豁免 |
| `standard.patch.yml` / agent preset | tag 间 [`packages/bundle/web-app/presets/standard.patch.yml`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/bundle/web-app/presets/standard.patch.yml) 零差异；两个官方 web-app tarball 内该文件也逐字相同，SHA-256 均为 `0d398d2a6872a73a106cb3bd19303ecccf1637e1fcad4d0bf9d8a72d2c2c68f5`。`packages/preset` 只有 manifest 版本变化 | 生成器的 `preset-standard`、persona、delegation、plan-mode、tool-workflow 等锚点没有上游漂移。只读试算确认 24PA 生成物只有两行头注释版本变化；无需改 delta 规则或业务预设 |
| Session | `packages/core/session/src` 无差异；`packages/session` 除 package manifest 版本外无差异。24PA 使用的结构类型见 `packages/24pa/src/host.ts:14-49`，事件与持久化消费面未见上游改动 | **无需改代码或新增 Session 迁移**。真实 Host 的会话创建、父子归属、事件、重启恢复仍应跑 e2e，不能以静态 diff 代替 |
| native Schedule | `packages/schedule/schedule/src` 无差异，只有包版本从 rc.4 升至 rc.5。24PA 直接使用的 record 构造函数、`ScheduleId`、`resolveRecurringOccurrence` 和类型见 `packages/24pa/src/plan-time.ts:1-6`，Host create/catalog/update/delete/history 面见 `packages/24pa/src/host.ts:109-115` | **无需改 Schedule API 调用或计划迁移**；dsh-schedule peer 必须随三串加入 rc.5。原生时钟、修改、暂停、重启续跑由后续 e2e 覆盖 |
| cordis | 官方 dsh 与 web-app rc.4/rc.5 包内 `package.json` 均保持 `@deepseek-ai/cordis: ~4.0.5`；上游 `vendor/` 无差异 | 保持 24PA `~4.0.5-alpha.1`，与既有宿主解析方式一致；无需改 cordis 服务注入或 peer 范围 |
| Web 注入：`ui-layout` / `ui-sidebar` / `ui-workspace` | 三个包在 tag 间均只有 `package.json` 版本变化，`src` 零差异。24PA 声明的三个 inject 位于 `packages/24pa/package.json:78-85` | **无需改注入声明**。`ctx.uiWorkspace.openSession`、`main` 与 `sidebar.panellist` 注册未见契约漂移，仍应做浏览器冒烟 |
| reasoning Body Slot | [`ReasoningBodyOwnerProps`](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-chat/src/client/contract/slots.ts#L78-L94) 新增 `rawText`，原 `text` 改为 Chat 处理后的展示文本，`running` 不变；[上游迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props/guide.zh.md) 要求需要完整模型输出的扩展改读 `rawText` | 24PA 源码没有 `conversation.chat.reasoning.*`、`ReasoningBodyOwnerProps` 或 `rawText` 消费点，**无需适配**。若部署另行启用自定义 reasoning renderer / cot-translation，须按上游指南单独核查，不能由本结论覆盖 |

另经实际比较，web-app 的 `cordis.patch.yml` 在 rc.4/rc.5 也逐字相同，SHA-256 均为 `cdceb423fc34c31ceb9c47ef2117a88eeda6fd9cc21f94d58cfd21e7c3e035de`。

## npm 分发、peer 与锁文件注意事项

对官方 tarball 实际下载、校验 SHA-1 并解包后，`@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-web-app` 各自的 rc.4/rc.5 内容差异都只有 `package/package.json`。这不等于 rc.5 没有功能变化：思考块代码位于其精确 pin 的 `@deepseek-ai/dsh-client-ui-chat@0.2.1-rc.5` 等依赖包中，不能只看 web-app 自身文件。

web-app tarball 内 `package/package.json` 的 peer 对照为：

| peer | rc.4 | rc.5 | 判断 |
|---|---|---|---|
| `@deepseek-ai/cordis` | `~4.0.5` | `~4.0.5` | 无变化 |
| `@deepseek-ai/cordis-plugin-loader` | `~1.0.6` | `~1.0.6` | 无变化 |
| `@deepseek-ai/dsh-shell-env` | `0.2.1-rc.4` | `0.2.1-rc.5` | 精确 pin 随基线升级，锁树不得残留 rc.4 造成混装 |

web-app 的 dsh 系列 dependencies 全部仅由 rc.4 精确 pin 改为 rc.5；`@deepseek-ai/schemastery: ~3.18.5`、`commander: ^15.0.0`、`open: ^11.0.2` 等非本基线依赖范围不变。dsh CLI 包同样只有自身及 dsh 系列精确 pin 升级，cordis、loader、include、timer、schemastery 等范围不变。

安装与锁文件注意事项及实测：

1. 先完成 24PA 三串和 web-app pin 更新，再生成锁文件，避免旧锁造成 rc.4/rc.5 混装。实际标准 `npm install` 遇到 `dsh-shell-env → dsh-shell → dsh-subprocess` 的 `ERESOLVE`；仅本地开发树使用 `--legacy-peer-deps` 完成安装，没有修改或豁免发布包的宿主版本约束。
2. 锁中 web-app 为 rc.5，其 integrity 对应官方值 `sha512-X05vTvrF41RpkmydI3CgqwQYsDjBWWY6xEJRk9noxp/YuQuBFfN5ABC4QedRYRXK7kR7lNEx2FtehXbCREkdSg==`，dsh 系列包仅剩兼容清单中的 rc.4 字符串，没有 rc.4 包混装。`resolved` 可包含镜像 URL，内容以 integrity / SHA-1 核验；锁文件没有 `file:` / `link:` 机器路径。
3. `packages/24pa/scripts/link-peer.mjs` 的 `prepare` 会把 cordis、schemastery、dsh-schedule、dsh-tools、dsh-system-prompt 链到相邻 `deepseek-harness` checkout。它只影响开发用 `node_modules`，不进入锁文件或发布包。安装后已实际运行 `prepare`，再完成构建和测试。
4. 本机相邻 checkout 的 built CLI 仍是 rc.4，因此真实验证没有借用该旧产物，而是在隔离目录以标准 peer 解析安装官方 npm `@deepseek-ai/dsh@0.2.1-rc.5`，并确认 `dsh --version` 为 `0.2.1-rc.5`。所有最终 Host/e2e 均显式指向该 CLI，避免“锁到 rc.5、实际仍跑 rc.4”的假阳性。

## 本地实测与边界

- `npm run build`：TypeScript 构建通过。
- `npm run preset:check`：生成物与 rc.5 基线一致；`tests/unit/preset-sync.test.mjs` 5/5 通过。实际 `preset:sync` 仅改变两行基线头注，正文零漂移。
- `PA24_E2E_STORAGE=sqlite DSH_BIN=<隔离 rc.5 CLI> npx vitest run tests/e2e/f01.e2e.mjs`：8/8 通过，覆盖真实 Loader/Host、engines 装载、SQLite、Lead/Worker、本地与飞书来源回传、真实工具查询和重启恢复。
- 最终 `DSH_BIN=<隔离 rc.5 CLI> npm test`：**124 个测试文件通过，1758 个测试通过、1 个跳过（1759）**。全部 e2e 使用上述 rc.5 CLI；单元测试继续覆盖 SQLite/PostgreSQL 双后端，完整套件包含 native Schedule 的计划创建、修改、暂停、投递与恢复场景。
- 候选包 `artifacts/benz-ai-x-dsh-24pa-0.2.1-rc.5.1.tgz` 共 140 个文件；解包后核验版本、rc.4/rc.5 三串、rc.5 预设头注及既有诊断脱敏行为均通过。SHA-1 `87feab2ecd28736ad10f50c38f70779935fbf4e3`，SHA-256 `e28d5a022bdcbe9224ee0d45f94efe34fb7e2dc3dc8e2b0c8077aae8798cf84b`。
- 未执行浏览器走查、生产部署、真实账号消息或业务写入；另行安装的自定义 reasoning renderer / cot-translation 不在本次实测范围。外部平台在 e2e 中使用隔离桩，模型和网络边界按既有测试约定替换。
