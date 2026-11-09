# 微信失败输入：真实宿主状态核对修复

关联 #279，覆盖 WX-05/09；目标宿主 dsh `0.2.2-rc.1`。这是既有维护流程的兼容修复，不扩大微信权限，不增加 F55 通知。

## 现象与根因

2026-11-09，`.1.6` 已完成原交办只读查询并发送结果，主人随后确认“已收到”。电脑端结清原失败微信输入时，调用在写入核对记录之前抛出 `Cannot read properties of undefined (reading 'throwIfAborted')`；原绑定在 finally 中恢复 enabled/polling，原历史保留，无新增业务或投递。

核验实际 8010 所装宿主及本地官方源码 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`（标签 `dsh-v0.2.2-rc.1`）：`packages/api/session-controller/src/index.ts` 的公共 `state(request, signal)` 要求第二个 `AbortSignal`，其状态控制器实际调用 `signal.throwIfAborted()`。24私助的 Host 类型只声明了 request，唯一调用点也只传该参数。不是微信网络或绑定问题。

## 最小修复

- 补全本地 Host 接口的必需 `signal: AbortSignal`。
- 电脑端 `weixin.change/input-close` 调用沿用运行实例的 `lifetime.signal`。
- 保留停用、身份、原生已消费历史、宿主运行中/原输入排队与核对记录等既有门禁。关闭只结清原输入，不把原失败回合标成业务成功，不重提或补发。

## 失败复现与验证

基线为 main `959a207e56852d8bca9a06a9801dd530126e3205`，工作分支 `codex/weixin-input-close`；用户原主工作区不改动。

- 新增单元通过实际 PaRuntime、SQLite 和电脑端方法建立 admitted/error 输入。模拟宿主遵循真实 signal 契约；修复前复现同一异常，修复后 idle 可以核对关闭，running/queued 拒绝且不写核对记录、不发送或重新派发。
- 新增真实 Loader/Session E2E：微信输入被实际消费后模型返回明确错误，再停用、核对关闭并恢复原绑定。修复前该例在真实 Host 中以同一 `throwIfAborted` 异常失败；修复后通过。没有替代 runtime。
- 新失败回合使旧联合备份测试的“最后一个工具结果”可能命中历史交办回执；测试助手改为忽略请求前已经观察过的结果，业务断言未放宽。
- 最终 build、preset:check 通过；6 个单元文件 **39 项通过**（输入结清 3、恢复 6、账本 15、工具范围 6、面板 4、预设/版本 5）。
- 真实 dsh `0.2.2-rc.1` 与官方 Agent Teams profile，SQLite/隔离 PostgreSQL 的完整微信 E2E 各 **8 项通过**，覆盖原文计划确认、原编号续办、跨入口权限、未知结果核对、重启和联合备份恢复。本轮未重复完整单元集或普通交办全量；此前 `.1.6` 证据另见发布记录。
- 首次受限本机运行出现回环端口权限错误及依赖安装受限，随后在获准环境重跑上述相同测试。环境错误未算作产品通过。

```sh
cd packages/24pa
npm run build
npm run preset:check
npx vitest run tests/unit/weixin-input-close.test.mjs tests/unit/weixin-recovery.test.mjs tests/unit/weixin-ledger.test.mjs tests/unit/weixin-panel.test.mjs tests/unit/weixin-tool-scope.test.mjs tests/unit/preset-sync.test.mjs
DSH_BIN=/path/to/deepseek-harness/apps/cli/lib/bin.js \
PA24_E2E_STORAGE=sqlite \
PA24_E2E_EXTRA_PLUGINS=@deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-rc.1 \
npx vitest run tests/e2e/weixin.e2e.mjs
# PostgreSQL 将 PA24_E2E_STORAGE 改为 postgres。
```

发布候选 `0.2.2-rc.1.7`，合并、发布、8010 升级及原输入结清须另记录实际结果。#279 仍需真实微信编号续办与计划预览/本人原文确认；#281 仍需通知结论 B 及对应范围授权。本修复与隔离测试不能替代这些验收。

后续实际进度：PR #287 已合并，`.1.7` 已发布部署到 8010，原失败输入已由正式电脑端核对结清，未重跑或补发；完整核验见[发布/部署/结清记录](2026-11-09-release-0.2.2-rc.1.7.md)。上述候选/待验证描述保留诊断时点含义。
