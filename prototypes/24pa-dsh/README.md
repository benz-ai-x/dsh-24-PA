# 24PA：工作区与助理团队原型

这个可丢弃原型验证：**飞书统一向 Lead 交办，原生 Worker 办理，配置和 JSON 记忆通过 dsh 工作区会话维护，是否符合你的工作方式？**

版本 `0.0.2-prototype.1`。这是实际 dsh bundle，包含 Host、原生侧栏面板、Lead/维护 preset，以及原生 continuable 子 Agent。它不计入正式版的功能 PR。

## 1. 启动并选工作区

在仓库根目录运行：

```sh
npm run prototype
```

默认使用相邻已构建的 `deepseek-harness/apps/cli/lib/bin.js`，否则使用 PATH 中的 `dsh`。可通过 `PA24_DSH_CLI` 指定构建入口。脚本使用官方 CLI 初始化独立 Web profile、登记 bundle 后启动，不修改你的其他 profile。

默认 DSH_HOME 为仓库 `.prototype-runtime/home`；首次自动生成的工作区位于其中 `24pa-prototype/workspace`。首次选择自己目录：

```sh
PA24_WORKSPACE=/srv/my-24pa npm run prototype
```

这是 **dsh 所在服务器的目录**。已有 `AGENTS.md` 会保留，需要按生成模板添加唯一的 JSON 配置块。也可在 dsh 原生侧栏添加目录，再到“24PA 工作区 → 工作区”绑定。切换前要先完成或停止运行中的事项；切换工作区会清空当前原型的内存业务视图，文件与原生会话保留。

打开终端输出的完整登录地址，点击 **24PA 工作区**。管理台显示工作区路径、五类 Worker、事项、文档状态和只读记忆查询。点击“进入工作区维护会话”，进入 dsh 原生会话。没有模型凭据时先在 dsh 模型设置中配置；不再用内置示例模型生成貌似真实的结果。

默认监听 `127.0.0.1:3210`，`PA24_PORT` 可改端口。占用时脚本会在安装前退出；先在原终端 Ctrl+C。找不到原终端时可用 `lsof -nP -iTCP:3210 -sTCP:LISTEN` 和 `ps -p <PID> -o pid,command` 确认确为自己的原型，再 `kill -TERM <PID>`。不同实例必须使用不同的 `PA24_DSH_HOME` 和工作区。

## 2. AGENTS.md 是配置源

初始模板的 JSON 包含这些字段：

| 字段 | 作用 |
|---|---|
| version / mode | 配置版本 1；demo 或 feishu |
| larkProfile | 固定飞书 CLI profile，默认 default |
| ownerOpenId | 唯一主人的飞书 open_id |
| folderToken / tasklistId / calendarId | 体验文档目录、任务清单、本人日历；日历默认 primary |
| timeZone | 默认 Asia/Shanghai |
| appIdEnv / appSecretEnv | 应用凭据的环境变量名称，实际密钥不写入文件 |
| maxWorkers | 同时处理数，1–8，默认 2 |
| enabledWorkers | calendar、tasks、reminders、memo、handwriting 中启用哪些 |
| workerModels | 可按 Worker 指定 dsh provider/model；未指定继承宿主模型 |

模式、身份与资源配置只在该文件中维护；旧 `PA24_MODE`、`PA24_LARK_PROFILE` 等环境设置不再读取。文件中的稳定规则也由 dsh 原生 agent-instructions 装载。

在维护会话可以说：

> 查看这个工作区的 AGENTS.md，解释当前配置。
>
> 把 maxWorkers 改为 3，检查配置并重载。

维护助手使用原生文件工具与 `pa24_workspace`。也可以手工编辑文件，再点击管理台“重载 AGENTS.md”；运行中的业务未结束会拒绝重载。同一工作区重载保留本次业务记录，坏配置不替换当前有效配置。

## 3. 接入真实飞书

1. 服务器安装并授权 `lark-cli`，使用同一个机器人应用和固定 profile。可用 `lark-cli --profile default auth status --json` 核对用户 openId；插件会检查其与 ownerOpenId 一致。
2. 在飞书自建应用开启机器人和长连接，订阅 `im.message.receive_v1`、`card.action.trigger`。按 CLI 授权提示配置消息、图片资源、文档/图片、任务和日历权限。主人能访问指定目录、清单和机器人。
3. 将 `.env.example` 所示的应用凭据通过启动 shell 或服务管理器导出，插件不会自动读取 `.env`。使用自己已有的凭据管理方式即可。
4. 在工作区 AGENTS.md 填入 ownerOpenId、folderToken、tasklistId，mode 改为 feishu。不要把密钥原值写进 JSON。已运行进程无法获取之后新增的 shell 环境变量，首次配置凭据需要重启 dsh；已有环境中修改普通配置可重载。
5. 在 dsh 设置中配置 Lead 模型。手写 Worker 需要实际支持图片的路由；可在 workerModels.handwriting 中指定已配置的 provider 和 model。主模型是文字模型时必须单独配视觉模型。
6. 管理台看到长连接启动后，在手机给机器人发 `/24pa`，以真正收到回复为收发验证。

连接启动本身不等于飞书端到端验收。写入的任务和文档标题带 `[24PA原型]`，请使用专门的体验目录和清单。

## 4. 从飞书体验

| 飞书输入 | 助理办理与当前范围 |
|---|---|
| “帮我记一个待办：周末整理书房” | Lead 委派 tasks，创建真实任务；可要求完成该原型创建的任务 |
| “记一下：下周讨论新的合作方向” | memo Worker 写入指定目录的飞书备忘文档 |
| “查一下明天日程，给我安排建议” | calendar 查询本人日历，缺少日期/时区先澄清 |
| “明天 10 点到 11 点安排我写方案” | calendar 在时间明确后创建本人日程；原型不邀请他人、改期或删除日程 |
| “30 秒后提醒我喝水” | reminders 创建单次提醒，计时到期后机器人主动发给本人 |
| “看看正在办理的事”“继续整理那份笔记” | Lead 查询或继续原 Worker；多件事不需要 A–E 切换 |
| “停止书房那项工作” | 停止后续处理；已创建的外部对象不会自动撤销 |
| 飞书 App 拍一页纸质笔记并发送 | 保存收到的原图，Lead 交给 handwriting，实际视觉结果进入待审文档 |

手写输出要求忠实转写、摘要、疑点、候选行动和简单图示说明。看完飞书文档与原稿后，点击机器人发来的“本人审核通过”或“退回修改”。需要修订时回复原卡片，告诉 Lead 修改依据；修订生成新文档版本，旧卡不能批准新版本。

审核通过不会创建任务。需要执行时另发：

```text
/执行 N-笔记编号 需要创建的任务内容
```

一份笔记在原型中每个版本只允许创建一次演示行动。多项选择和幂等批量执行是正式版范围。

原型只能识别单页 PNG/JPEG/WebP，最大 10 MiB；没有录音 Worker、多页合并或 PDF 处理。照片文字不构成新授权，手写 Worker 没有任何业务写入或批准工具。

## 5. 在 dsh 维护 JSON 记忆

点击“进入工作区维护会话”，可以输入：

> 记住我希望会议之间留 15 分钟，这是我明确的偏好。
>
> 查看与项目 X 有关的记忆，给出来源。
>
> 整理项目 X 的记忆，列出重复、冲突和过时条目，再按我的要求修改。
>
> 删除刚才指定的过时偏好。

记忆位于 **工作区 `.24pa-prototype/memory.json`**。维护工具先查询 revision，修改携带 expectedRevision、来源和本人指令依据；并发版本变化就拒绝覆盖。内容按 category、topic、content、source、confirmed/unverified 状态等字段保存。手工改文件后再次查询会读取新内容，无效 JSON 明确报错。

Lead 与获准 Worker 可以检索，写入由维护会话完成。没有自动归纳、定期整理或记忆后台定时器；业务提醒仍会自动到期发送。原型修订逐条提交，记录最后修改依据和原生工具日志，未实现完整修订历史/回滚。

## 6. 安装到已有服务器 dsh

已核对本机 dsh `0.2.1-alpha.1`，Node 实测 `26.4.0`；包要求 `^22.19.0 || >=24.0.0`。使用兼容的常驻 Web profile，纯 headless 不满足该管理面板的依赖。

仓库方式：

```sh
git clone --branch prototype/24pa-dsh git@github.com:benz-ai-x/dsh-24-PA.git
cd dsh-24-PA
PA24_WORKSPACE=/srv/my-24pa npm run prototype
```

或先 `npm run prototype:pack`，上传 `artifacts/benz-ai-x-dsh-24pa-prototype-0.0.2-prototype.1.tgz`，使用独立 DSH_HOME 安装：

```sh
export DSH_HOME=/srv/24pa-prototype-home
export PA24_WORKSPACE=/srv/my-24pa
dsh --profile pa24-prototype --from-default-profile web --dump-config >/dev/null
dsh plugin --profile pa24-prototype add ./benz-ai-x-dsh-24pa-prototype-0.0.2-prototype.1.tgz --ignore-scripts
dsh --profile pa24-prototype --host 127.0.0.1 --port 3210 --no-open
```

已有该 Web profile 时省略初始化行。安装需要获取 SDK 依赖，不运行传递依赖安装脚本。文件无需额外构建。服务器通过已有 SSH 隧道或 dsh 的 HTTPS 代理访问，保留宿主认证。多个进程不要共用运行目录或工作区。

## 7. 原型的持久化与验证边界

| 已实现的持久部分 | 本次运行的内存部分 |
|---|---|
| 工作区选择、AGENTS.md、JSON 记忆、收到的原稿文件、原生 dsh Session 日志 | 事项队列、提醒规则、图片运行索引、审核状态/卡片令牌、消息与事项路由 |

正式版业务使用 PostgreSQL Inbox/工作账本/审核/Outbox；这个原型没有连接 PostgreSQL，也不使用 SQLite。重启后旧卡失效，不能从旧文档标签推断当前正文已审核。配置重载与进程重启不同，前者在同工作区保留运行中的业务视图，后者没有业务恢复保证。

单次提醒使用 dsh-schedule 公开 after 规则与内存计时器，没有实现完整原生 Schedule 周期闭环。正式版智能计划必须挂到顶层 Lead，不能直接挂 child Session。晨报、全面同步、完整项目管理、多页识别与耐久恢复仍在正式规格中。

真实 Loader、原生会话/工具/子 Agent、文件写入和审核状态通过隔离验证；模型使用临时边界夹具，夹具不随包交付。真实模型判断质量、飞书平台收发/权限/回调/文档并发、中文手写识别效果和服务器运行尚需实际环境验收。具体证据见仓库 `docs/prototypes/24PA-原型验收记录.md`。
