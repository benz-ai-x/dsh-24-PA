# 24PA · 24 小时全天候个人助理

24PA 是面向 dsh 的飞书私人助理插件，规格涵盖常规助理、多 dsh 会话、主动提醒，以及中文手写笔记的整理与人工审核。

当前分支为 **`prototype/24pa-dsh` 可丢弃原型**。正式版的 12 个功能 PR 仍处于待确认的交付计划中。

```sh
npm run prototype
```

打开输出的 dsh 地址，点击侧栏 **24PA 原型**。默认使用演示数据，原生 dsh 会话真实创建。

- [体验与服务器部署说明](prototypes/24pa-dsh/README.md)
- [离线演练：下载后双击打开](prototypes/24pa-dsh/demo.html)
- [原型验收记录](docs/prototypes/24PA-原型验收记录.md)
- [正式规格](docs/24PA-v1-SPEC.md)
- [功能 PR 交付计划](docs/planning/24PA-v1-PR交付计划.md)

原型业务数据只在内存中；正式版持久化仍采用 PostgreSQL，不使用 SQLite。真实飞书与视觉识别需要配置对应凭据后联调。
