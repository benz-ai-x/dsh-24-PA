# dsh 0.2.1-rc.3 适配核验

核验日期：2026-10-24。基线：`dsh-v0.2.1-rc.3`（`1f81c047fc`，本机 checkout `~/DSH-Space/deepseek-harness`）。上一适配基线：0.2.1-rc.2（PR #118 三串扩围）。适配分支：`codex/dsh-rc3-compat`。

## rc.2 → rc.3 变更清单（6 提交，4 项实质）

| 提交 | 内容 | 对 24PA 的影响 |
|---|---|---|
| 5ff29190（#6247） | 导航入口自定义：新增 `packages/client/ui-entry-customization` 浏览器插件（web bundle 默认加载）；侧栏 `sidebar.panellist` 契约扩展（新增 `sidebar.panellist.actions` More 菜单 slot、`SidebarPanelActionEntry` pin/active 状态） | **正面**：pa24 面板启动器成为侧栏可 pin/unpin 的自定义入口；24PA `client.js:2983` 的 `sidebar.panellist` 注册（id/order/label 元数据）与新契约向后兼容，无需改动。F21 遗留「侧栏入口宿主层受限」中「无法隐藏/管理入口」的部分由此缓解（More 菜单可 unpin） |
| 675164957a（#6600） | analytics 埋点：导航点击/预设切换/新会话发送 | 无影响（productAnalytics 可选服务；24PA 不消费） |
| 39d2903841（#6883） | pin 与选中分离、菜单图标、resize 折叠 | 无影响（纯 UI 行为） |
| c48f8523f2（#6944） | DeepSeek API-key 路由跟随官方 `/models` 列表（llm-deepseek-api-key/llm-deepseek/llm-deepseek-account） | 无影响（宿主模型路由内部；24PA 不触碰 models 列表 API） |

其余 2 提交为 release 版本号与合并。**插件管理器、boot、宿主核心 API 面零变化**（sdk/server 仅测试文件、tool-cordis +6 行类型）。

## 兼容性核验结论

- **标准预设**：rc.2→rc.3 `standard.patch.yml` 零变化（`git diff` 0 行）；相对 24PA 钉住的 alpha.2 基线仍只有既有三项漂移（subagent schedule denies 移除、plan-mode 措辞更新、plugin-market 禁用行）——`preset:sync` 全部吸收，无新漂移、无锚点失败。
- **cordis**：rc.2/rc.3 宿主同依赖 `~4.0.5`；npm 实际分发 4.0.5（final）。24PA peer 从精确 `4.0.5-alpha.1` 放宽为 `~4.0.5-alpha.1`（semver 预发布区间覆盖 alpha.1/alpha.2/final，与既有宿主装载实证一致）。
- **三串扩围**：`engines.dsh`、`peerDependencies['@deepseek-ai/dsh']`、`peerDependencies['@deepseek-ai/dsh-schedule']` 同扩 `|| 0.2.1-rc.3`（preset-sync 守卫测试基线清单同步加 rc.3；装载校验实际读点＝engines，见 PR #114/#118 结论）。
- **devDep**：`@deepseek-ai/dsh-web-app` alpha.2 → 0.2.1-rc.3（preset:sync 基线源）。npm 严格 peer 解析下 web-app@rc.3 与旧 peer 树冲突（dsh-llm/shell-env 链），需在 package.json 三串扩围后全新安装；web-app@rc.3 的 peer `~4.0.5` 触发的 cordis 解析用 `--legacy-peer-deps` 完成 dev 树安装（dev 树仅服务 preset:sync/类型/测试，运行时 peer 由宿主提供，不受影响）。
- **锁文件**：本次重装顺带治愈 #238 所述锁缺陷——新锁含 `yauzl`/`yazl` 及类型条目（12 处）、零机器链接（`@deepseek-ai/*` file: 链接不再存在）、root 三串与 engines 同步到 rc.3。
- **侧栏契约**：`SidebarPanelMetadata`（id/label）未变；新增字段全部在新增 slot 与 owner-share 接口，24PA 现有注册无需适配即获得 More 菜单入口管理。

## 实证

- 构建 `tsc` exit 0；unit 全量见 PR；`preset:check` 通过。
- 真实宿主冒烟：本机 rc.3 checkout（`apps/cli/lib/bin.js`，`--version`=0.2.1-rc.3）上 `PA24_E2E_STORAGE=sqlite npx vitest run tests/e2e/f01.e2e.mjs`——插件装载（engines 接受 rc.3 三串）、宿主启动、SQLite 账本、交办往返全链路。结果见 PR 描述。

## 遗留

- `entry-customization` 的 More 菜单是宿主 UI 能力，24PA 无需声明即被纳入；若后续要在面板文档中说明「入口可 pin/unpin」，属文档层面跟进（T20 走查项）。
- Desktop 产品埋点（product analytics）不涉及 24PA；Web 交互默认排除。
