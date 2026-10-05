# 24PA · 24 小时全天候个人助理

24PA 是面向 dsh 的飞书私人助理插件，规格涵盖常规助理、多 dsh 会话、主动提醒，以及中文手写笔记的整理与人工审核。

当前分支为 **`prototype/24pa-dsh` 可丢弃原型**。正式版的 12 个功能 PR 仍处于待确认的交付计划中。

```sh
npm run prototype
```

打开输出的 dsh 地址，点击侧栏 **24PA 原型**。默认使用演示数据，原生 dsh 会话真实创建。

若提示 `3210` 端口已被占用，先确认是否已有原型在运行；已有实例可直接打开 <http://127.0.0.1:3210/> 继续使用。启动脚本会在安装依赖前检查端口，冲突时退出并给出处理说明。

新浏览器若显示 `Unauthorized`，请使用原启动输出中带 `?token=...` 的完整登录地址；上面的普通地址适用于已登录的浏览器。

重启时先在原启动终端按 Ctrl+C，再执行启动命令。若找不到原终端，可用 `lsof -nP -iTCP:3210 -sTCP:LISTEN` 查出 PID，再用 `ps -p <PID> -o pid,command` 确认是这个原型后，以 `kill -TERM <PID>` 正常停止。重启会清空原型的内存业务状态。

若端口属于其他程序，可运行 `PA24_PORT=3211 npm run prototype`。需要同时打开第二套 demo 时，应同时隔离运行目录：

```sh
PA24_MODE=demo PA24_PORT=3211 PA24_DSH_HOME="$PWD/.prototype-runtime/home-3211" npm run prototype
```

端口预检只检查当前绑定地址，不是跨端口的 profile 锁；不要让两个 dsh 进程共享同一个 `PA24_DSH_HOME`。

- [体验与服务器部署说明](prototypes/24pa-dsh/README.md)
- [离线演练：下载后双击打开](prototypes/24pa-dsh/demo.html)
- [原型验收记录](docs/prototypes/24PA-原型验收记录.md)
- [正式规格](docs/24PA-v1-SPEC.md)
- [功能 PR 交付计划](docs/planning/24PA-v1-PR交付计划.md)

原型业务数据只在内存中；正式版持久化仍采用 PostgreSQL，不使用 SQLite。真实飞书与视觉识别需要配置对应凭据后联调。
