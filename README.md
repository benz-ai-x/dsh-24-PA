# 24PA · 24 小时全天候个人助理

24PA 是一个 dsh 工作区中的飞书私人助理。你在飞书交办日程、待办、提醒、备忘或拍照发手写笔记；Lead 理解并委派专业 Worker，统一汇报。配置放在工作区 `AGENTS.md`，长期记忆以 JSON 保存，通过 dsh 原生维护会话修改与整理。

当前是 **`prototype/24pa-dsh` 可丢弃原型**，版本 `0.0.2-prototype.1`。正式版使用 PostgreSQL；原型的业务队列与审核凭证仍只保留本次运行。

```sh
npm run prototype
```

打开启动输出中的完整登录地址，在侧栏进入 **24PA 工作区**。默认会创建隔离的演示工作区，可查看团队与配置、进入维护会话。配置 dsh 模型及真实飞书后，日常体验从手机机器人开始。

也可以在首次启动时选定服务器上的独立目录：

```sh
PA24_WORKSPACE=/absolute/path/to/my-24pa npm run prototype
```

目录没有 `AGENTS.md` 时生成模板；已有文件不会覆盖。之后可使用原生 dsh 工作区目录入口，在 24PA 面板绑定所选目录。`AGENTS.md` 是模式和飞书 profile 的实际配置源，旧的 `PA24_MODE` 等环境字段已移除。

默认监听 `127.0.0.1:3210`。若端口占用，先在原启动终端 Ctrl+C 停止，再启动；已有实例可用 [本地入口](http://127.0.0.1:3210/) 打开。新浏览器需要启动输出中的带令牌地址。启动脚本不会停止占用端口的其他程序。

如需第二个隔离实例，同时换端口和运行目录：

```sh
PA24_PORT=3211 PA24_DSH_HOME="$PWD/.prototype-runtime/home-3211" npm run prototype
```

不要让两个进程共享同一个 DSH_HOME 或 24PA 工作区。

- [体验与服务器部署说明](prototypes/24pa-dsh/README.md)
- [设计 v0.3](docs/24PA-整体设计方案.md)
- [规格 1.1](docs/24PA-v1-SPEC.md)
- [原型验收与限制](docs/prototypes/24PA-原型验收记录.md)
- [待审的功能 PR 交付计划](docs/planning/24PA-v1-PR交付计划.md)

旧 A–E 切换台和离线按钮演练已移除。真实飞书收发、服务器部署和中文手写识别质量仍须配置实际环境后验收。
