# 24私助（24PA）

24私助（英文名 24PA）是运行在 dsh 工作区里的飞书私人助理，以标准 dsh 插件（profile bundle）形式交付：`@benz-ai-x/dsh-24pa`。在飞书或本地24私助会话交办日程、待办、提醒、备忘，或拍照发手写笔记；内部 Lead 协调、六类专业 Worker 办理，PostgreSQL 账本记录事项与回执，结果回到实际发起入口。本地会话同时具备标准模式的完整编程能力；飞书入口与 Worker 保持业务白名单。

## 安装

```sh
# dsh 0.2.1-alpha.1 宿主
dsh plugin --profile <你的 profile> add @benz-ai-x/dsh-24pa@0.2.1-alpha.1.2

# dsh 0.2.0-rc.2 宿主（简报功能另需 schedule 伴随件，见插件 README）
dsh plugin --profile <你的 profile> add @benz-ai-x/dsh-24pa@0.2.0-rc.2.1
```

环境变量（`PA24_PG_DSN`、`PA24_WORKSPACE`、feishu 模式的 `PA24_FEISHU_APP_ID/SECRET`）、AGENTS.md 配置字段、双基线差异与 rc.2 的 schedule 伴随件说明，见**插件 README**：[English](packages/24pa/README.md) | [中文](packages/24pa/README.zh.md)（按 DSH 插件文档标准 `kind: package-bundle` 撰写）。

版本号跟随 dsh 基线：**`<dsh 基线版本>.<本产品序号>`**；npm dist-tag 按基线通道发布（`dsh-0.2.0-rc.2`、`dsh-0.2.1-alpha.1`，`latest` 指最新稳定基线）。

## 文档

- [产品规格 24PA-v1-SPEC](docs/24PA-v1-SPEC.md)（1.5）· [整体设计方案](docs/24PA-整体设计方案.md)（v0.6）· [ADR-0001 工作区与会话边界](docs/adr/0001-workspace-session-boundaries.md)
- [接入配置向导](packages/24pa/feishu-setup.md)——安装后对本地会话说「帮我接通飞书」即可，无需先读本文
- [分功能研究记录](docs/research/) · [v1 PR 交付计划](docs/planning/24PA-v1-PR交付计划.md) · [术语表](GLOSSARY.md)
- Releases：每个版本附发布包 tarball 与如实声明的未验证边界

## 状态

v1 功能（F01–F15）已全部合并，双基线全量回归 130/130×2（真实 dsh Loader＋原生 Session＋隔离 PostgreSQL；模型/外部网络/时钟为测试边界）。真实飞书租户联调、30–50 页手写样本评测与连续试运行待真机验收（[P40/#46](https://github.com/benz-ai-x/dsh-24-PA/issues/46)）。

本仓库早期为可丢弃原型（`prototype/24pa-dsh` 分支保留证据）；正式实现自 2026-10 起按上述规格与交付计划推进。
