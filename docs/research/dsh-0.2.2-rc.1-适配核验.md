# dsh 0.2.2-rc.1 适配核验（插件 0.2.2-rc.1.1 / PR #265）

2026-11-06。同模式先例：#114/#118（alpha 线）、rc.3（484449e）、rc.4（b4dccaf）、rc.5（4803ec7）。

## 基线事实

- npm：`@deepseek-ai/dsh@0.2.2-rc.1`（engines node>=24.9.0，服务器 v24.22.0 ✓）；生态件 `dsh-web-app`/`dsh-mcp-client`/`dsh-subagent-codex`/`dsh-subagent-claude-code` 均有 0.2.2-rc.1。
- `@benz-ai-x/dsh-research-graph` 最新 0.2.1-rc.5.2，peer 锁 `dsh-llm 0.2.1-rc.5`——新基线需 `allow-version --dsh-version 0.2.2-rc.1` 豁免（rc.1–rc.3 时代同款）。
- 源码差异面 334 文件/约 1.2 万行（harness `dsh-v0.2.1-rc.5..dsh-v0.2.2-rc.1`），逐 API 审计不可行，以真实宿主冒烟为准。

## 变更（本仓库）

- engines.dsh＋peer dsh/dsh-schedule 三串追加 `0.2.2-rc.1`（逐字一致，守卫测试同步扩）。
- devDep web-app pin `0.2.1-rc.5→0.2.2-rc.1`；`preset:sync` 重生成 cordis.patch.yml＝上游标准预设三条变化：tool-fs `applyPatch:false`、移除 `tool-subagent-control/list-agents`、subagent 增 `modelSelection/modelDiscovery`。生成器干净吸收，无锚点失败，`preset:check` 绿。
- 版本 `0.2.2-rc.1.1`。

## 真实宿主冒烟（ali 服务器隔离 profile，随 PR 证据）

`/tmp/pa24-smoke-022`：DSH_HOME 隔离＋web profile＋本分支 tgz（file: 直装，protobufjs allowBuilds 补丁＋bundles 三件套照坑清单）＋demo 工作区（DEFAULT_CONFIG 全字段，storage=sqlite）。

结果：宿主 0.2.2-rc.1＋插件 0.2.2-rc.1.1 完整装载；readiness 5/6（唯一 warn＝demo 未连飞书，预期）；工作区＋SQLite 账本绑定零错误；面板 snapshot/cookie 交换等 host.api 面正常——boot/工作区/账本/面板 API 无破坏。

**未覆盖**：飞书通道、企微通道、子代理真实派发、schedule 原生投递——生产升级后观察（晨报 08:00＝首个真实 schedule 投递）。回滚锚＝旧 deployments/dsh-0.2.1-rc.5 目录＋start.sh exec 行。

## 踩坑记录

- 冒烟工作区 AGENTS.md：配置校验要求多个字符串字段**显式存在**（folderToken/appIdEnv…），最小 json 会连环报「必须为字符串」；正解＝DEFAULT_CONFIG 全字段生成（tests/helpers/runtime.mjs 同款）。
- `dsh plugin add` 首次失败＝pnpm 构建脚本门（protobufjs），补 allowBuilds 后重跑即过；错误日志（pnpm.log）只留命令行，需手动复跑看真因。
