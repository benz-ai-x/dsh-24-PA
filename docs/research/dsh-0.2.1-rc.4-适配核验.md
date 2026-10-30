# dsh 0.2.1-rc.4 适配核验

核验日期：2026-10-28。基线：官方 `dsh-v0.2.1-rc.4`（`504a01a9578abc2c6f1fb896b1dc322c9fe24f66`，本机 checkout `~/DSH-Space/deepseek-harness`）。上一适配基线：0.2.1-rc.3。候选分支：`codex/dsh-rc4-compat`，候选包：`@benz-ai-x/dsh-24pa@0.2.1-rc.4.1`。

## 变更与影响

上游 rc.3→rc.4 共 9 个提交，主要是版本号更新。实际源码变化为 View-tab tooltip 溢出判断及 More 菜单标签、ACP stdout 诊断、MCP 诊断和 DeepSeek Account 路由；24PA 注入的 `ui-layout`、`ui-sidebar`、`ui-workspace` 及 `web-app` 只有版本号变化，无插件契约适配。

- `standard.patch.yml` rc.3→rc.4 零变化。`preset:sync` 重新生成后只有基线头注释更新，无新漂移。
- `engines.dsh`、`peerDependencies['@deepseek-ai/dsh']`、`peerDependencies['@deepseek-ai/dsh-schedule']` 同扩 `|| 0.2.1-rc.4`，保留既有宿主清单；守卫测试同步加入 rc.4。
- `@deepseek-ai/dsh-web-app` 开发基线升至 rc.4。包版本按 `<dsh 基线>.<序号>` 取 `0.2.1-rc.4.1`。
- 锁文件重新生成，未发现 `file:`/`link:` 机器链接。cordis peer 保持 `~4.0.5-alpha.1`，与既有宿主解析方式一致。
- 产品源码、业务存储 schema、持久化迁移和 UI 行为均未修改。

## 验证

- `npm run build`：TypeScript 构建通过。
- `npm run test:unit`：**91 文件，1571 通过、1 跳过（1572）**。第一次命令在完整汇总前被工具超时终止，没有断言失败；按同一命令完整重跑后通过，未缩小测试范围。
- `npm run preset:check`：`cordis.patch.yml` 与 rc.4 基线一致。
- `PA24_E2E_STORAGE=sqlite npx vitest run tests/e2e/f01.e2e.mjs`：真实 rc.4 Loader/Host 上 **8/8** 通过，覆盖插件 engines 装载、SQLite 账本、Lead/Worker 交办与回传、真实工具查询和重启恢复。
- 候选归档：`artifacts/dsh-rc4-compat/benz-ai-x-dsh-24pa-0.2.1-rc.4.1.tgz`，SHA-256 `45656ba35b3671967e18cc9b357a55d2f837d29d26c03c21b97425459b8950bd`。

## 边界

适配 PR #253 已合并为 `49166d45d081bd809d688384b2129736e31be684`，main 另含头注守卫提交 `cf64af4`；尚未发现对应 24PA GitHub Release。候选已部署到 8010。宿主、研图、mcp-client、subagent-claude-code 与 subagent-codex 均为 rc.4，pa24 为本地验证的 rc.4.1。pa24 active、8010 正常监听，启动日志未见不兼容或拒绝加载，浏览器研图徽标和 24PA 面板正常；未使用版本豁免、未发送消息或修改业务数据。部署前 profile 清单已备份，rc.3 回滚路径保留。真实平台凭据、业务数据和生产配置不进入本文。

部署中处理了两项环境问题：磁盘满导致安装落盘失败，只清理可重建的 npm/pnpm 缓存；`/usr` 与 `/usr/local` 双全局安装导致版本核验读取到不同包，最终升级实际命令使用的 `/usr/local` 安装，两个前缀现均为 rc.4。
