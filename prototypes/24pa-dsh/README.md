# 24PA：可安装的 dsh 体验原型

这个可丢弃原型回答一个问题：**私人助理常规操作、多 dsh 会话切换，以及手写笔记按版本人工审核，放进同一个飞书入口后是否顺手？**

它是实际 dsh 插件 bundle，包含 Host 插件、原生 Client 面板和受限 Agent preset。正式版规格及 PostgreSQL 方案不变；这次只实现可体验的部分，不计为 F01–F12 的生产交付。

## 先在本机体验

在仓库根目录执行：

```sh
npm run prototype
```

打开命令输出的 dsh 地址，进入左侧 **24PA 原型**。没有模型密钥时选择“稍后配置”，仍能体验待办、备忘、会话切换、示例稿审核和提醒。

命令优先使用相邻 `deepseek-harness/apps/cli/lib/bin.js`，其次使用 PATH 中的 `dsh`；也可用 `PA24_DSH_CLI` 指定已构建的 CLI 文件。它通过 dsh 官方 CLI 初始化独立 Web profile，再安装 bundle，不手工改写 profile 配置。默认监听 `127.0.0.1:3210`，端口可用 `PA24_PORT` 修改。

运行数据位于仓库内 `.prototype-runtime/home`，依赖缓存位于 `.pnpm-store`，均不入 Git。首次运行需要下载 npm 依赖。停止用 Ctrl+C；业务状态清空，但原生 dsh 会话、附件和已经创建的飞书对象保留。

不安装 dsh 也可以双击同目录的 **[demo.html](demo.html)**。它使用同一份纯状态转换逻辑，所有会话、识别稿与投递均是离线模拟。生成命令为 `npm run prototype:demo`。

## 可以体验什么

| 操作 | demo 模式 | feishu 模式 |
|---|---|---|
| 对话、规划建议 | 提交给真实 dsh 模型，需要配置密钥 | 飞书私聊进入同一套原生会话 |
| 创建/完成待办、保存备忘 | 内存体验对象 | 固定 CLI profile 创建真实任务/文档 |
| A–E 切换、查看、返回、停止 | 对应独立真实 dsh Session | 同一飞书主人、同一 CLI profile；引用已知机器人消息沿用其来源会话 |
| 单次提醒 | 到期显示在来源会话 | 机器人主动给绑定主人发私聊 |
| 单页手写识别 | 真正提交原图给 dsh 视觉路由；结果留在面板 | 下载飞书原图，识别后创建含原稿的待审文档并发审核卡 |
| 审核、退回、修订 | 本人按版本点击，旧按钮被拒绝 | 核验飞书正文，更新带版本/指纹的审核标识 |
| 从笔记创建行动 | 本人另行授权后创建演示任务 | 本人另行授权后创建真实飞书任务 |

“加载示例稿”只演练审核流程，**没有进行 OCR**。上传图片的“通过 dsh 视觉模型识别”才会调用模型。主助手可讨论日程和安排，但原型没有日历查询/写入，也没有把建议冒充真实日程。

## 服务器安装

已针对本地 dsh `0.2.1-alpha.1` 源码构建核验。服务器需要兼容的 **Web profile**、Node `^22.19.0 || >=24.0.0`；实际验证使用 Node `26.4.0`。纯 headless profile 缺少本原型需要的 Web/Connection 服务。

### 方法一：仓库一键启动

```sh
git clone --branch prototype/24pa-dsh git@github.com:benz-ai-x/dsh-24-PA.git
cd dsh-24-PA
npm run prototype
```

如果服务器使用已安装的 `dsh`，确保它在 PATH 中。服务器入口默认只监听 loopback；可用已有 SSH 隧道或 dsh 的既有 HTTPS 反向代理访问。使用代理时沿用 dsh 的 `--public-url` / `--trusted-host` 配置，不绕过 dsh 自带认证。

### 方法二：安装 tgz

在仓库根目录打包：

```sh
npm run prototype:pack
```

将 `artifacts/benz-ai-x-dsh-24pa-prototype-0.0.1-prototype.1.tgz` 上传到服务器。新建体验 profile 时，**先从 web 初始化**；该初始化只执行一次：

```sh
dsh --profile pa24-prototype --from-default-profile web --dump-config >/dev/null
dsh plugin --profile pa24-prototype add ./benz-ai-x-dsh-24pa-prototype-0.0.1-prototype.1.tgz --ignore-scripts
dsh --profile pa24-prototype --host 127.0.0.1 --port 3210 --no-open
```

已有同名 Web profile 时省略第一行。也可以通过 dsh Plugin Manager 安装本目录，但原型会向该 profile 增加面板和 preset；推荐独立体验 profile。tgz 无需编译，安装时仍需下载 SDK 依赖。安装明确使用 `--ignore-scripts`：所用 SDK 有现成 JS，原型不需要运行其传递依赖的安装脚本。

## 启用真实飞书

默认 `PA24_MODE=demo`，没有飞书写入。将本目录 `.env.example` 复制为服务器上的私有环境文件，填写后由启动 shell 或服务管理器导出；插件不会自动加载 `.env`。

必需配置：

| 环境变量 | 内容 |
|---|---|
| `PA24_MODE` | `feishu` |
| `PA24_LARK_PROFILE` | 固定的飞书 CLI profile，例如已确认使用的 `default` |
| `PA24_OWNER_OPEN_ID` | 本人的 open_id |
| `PA24_FOLDER_TOKEN` | 专门用于体验的云空间目录 token |
| `PA24_TASKLIST_ID` | 专门用于体验的任务清单 GUID |
| `PA24_FEISHU_APP_ID` / `PA24_FEISHU_APP_SECRET` | 机器人应用的配置，保留在服务器环境中 |

准备流程：

1. 在服务器安装并授权 `lark-cli`。机器人和固定 CLI profile 使用同一个飞书应用；`lark-cli --profile default auth status --json` 中的用户 openId 必须等于绑定主人。插件启动会检查这一点，不切换 profile。
2. 在飞书应用中开启机器人及事件长连接，订阅 `im.message.receive_v1` 和 `card.action.trigger`；开放机器人私聊收发、消息图片资源读取，以及 CLI 用户访问文档、上传图片和操作任务所需权限。按服务器 CLI 的实际授权提示补齐 scopes，不在代码内代办授权。
3. 确认主人能访问指定体验目录、任务清单和机器人。真实写入的对象标题带 `[24PA原型]`。
4. 在所用 dsh profile 配置模型凭据和支持图片输入的模型路由。模型仍由 dsh 提供，插件不直接调用另一套模型 SDK。文字模型不支持图片时，dsh 会拒绝图片请求，不能用文字输出假装识别成功。
5. 导出上述环境变量后重启 dsh。先看“连接状态”，再给机器人发 `/24pa` 验证实际收发。长连接启动本身不表示已完成飞书端到端验收。

本机有一个隔离演示环境，但没有配置你的真实飞书应用或读取生产业务数据。部署前请以你的服务器实际 dsh/CLI 版本验证命令与授权。

## 建议的体验顺序

1. **常规助理**：创建待办、完成任务、保存备忘；配置模型后询问“帮我规划明天，先只给建议”。
2. **五会话**：建立 A–E，在 A 发起模型工作，切到 B 继续其他事项；查看 A 不改变当前输入的目标。没有默认跨会话拼接模型历史。
3. **提醒**：在 A 设提醒，切到 B，等 A 的提醒到达；发送成功只表示通道接受，不表示已读。
4. **手写**：从飞书发单张 PNG/JPEG/WebP，或在面板上传。查看忠实转写、摘要、疑点与候选待办，并对照原图。
5. **人工审核**：在文档/面板核对指定版本，再点本人批准。编辑框未保存的修改会禁用批准按钮；保存修订后产生待审的新版本。
6. **旧卡与另行授权**：点击旧审核卡应拒绝；未审核时执行行动应拒绝；当前版通过审核后还要单独授权创建任务。
7. **缺配置与停止**：没有模型凭据时出现明确失败回执；停止工作会取消对应原生会话和视觉工作。

在原生面板的“引导演练”可一步步点击四种边界情景。每次开始只重置原型内存；已建立的真实 Session 与 dsh 日志保留。

飞书文字命令：`/会话`、`/切换 B`、`/查看 A`、`/返回`、`/停止`、`/待办 内容`、`/备忘 内容`、`/提醒 30 内容`。未知来源的引用消息会要求明确目标，不猜所属会话。每个会话同时处理一项对话工作，总模型并发默认 2。

## 技术复用与原型边界

- 使用 Loader bundle patch、原生 sidebar/main slot、宿主主题/locale、Connection 的受认证 Fetch 路由、SessionController、SessionStore flush、Session events、受限 Tools 和 Agent preset。
- 单次时间规则用 `dsh-schedule` 的 `createAfterScheduleRecord` 校验和计算。本原型只用内存计时器送达固定文字；没有伪装为完整原生 Schedule 作业，也没有重做周期调度。正式版仍按规格区分固定通知的 PostgreSQL worker 与智能工作的原生 Schedule。
- 业务状态不落数据库，**没有 SQLite**；正式版的 PostgreSQL、durable inbox/outbox、重启续办、联合备份仍未实现。dsh 自己保存原生 Session 日志和模型附件；这不等于 24PA 业务状态能恢复。
- 原始图片在本次运行的内存中保留，真实模式文档附原图；模型附件可能被 dsh 规范化，不能冒充原件。每次修订创建新的版本文档，旧文档保留为历史。
- 审核按钮在服务端绑定本人、笔记 ID、版本和内容指纹。模型工具不包含批准/执行笔记行动；这些动作只能由飞书主人或已认证的 dsh 操作者明确触发。
- 审核前回读全文和资源引用指纹，携带读到的 revision 更新状态后再次回读。发现外部修改、读写不确定或不支持的动态内容时停止批准。飞书 API 并发修订的真实语义尚待租户联调，这不是生产级事务/CAS 验收。
- 文档标签写明“仅覆盖指纹对应的保存版本；当前正文有效性以 24PA 核验为准”。原型没有文档编辑事件订阅；云端手工编辑后需“核验飞书当前内容”，不能把旧标签当作现有正文始终有效。重启后旧卡无效，旧文档不自动恢复为可信笔记。
- 仅单页，最大 10 MiB；中文夹英文、待办、简单图示由视觉提示约束，不保证识别准确率。多页合并、30–50 页评测、周期提醒、日历写入、晨晚报、任务全面同步、五会话跨重启恢复留在正式规格中。
- 飞书长连接接收去重和按钮凭证仅在内存。外部写入不自动重试；超时后需要核对对象，不承诺生产级 exactly-once。模型请求及 dsh 的额外日志行为沿用该 profile 的既有配置。

## 验证记录

2026-10-05：通过真实 dsh Loader/原生 Web UI 安装运行；人工点通 A–E 创建、A/B 切换、旧版审核拒绝、先审后单独授权，以及 A 设置提醒后保持 B。确认真实 prompt 进入原生日志；未配置模型密钥时 turn 正常结束并回传失败。单独记录 tgz 安装验证结果于仓库 `docs/prototypes/24PA-原型验收记录.md`。

通过真实 dsh Tools 单独派发确认：助理工具创建待办与界面操作共用结果；工具状态不返回其他会话历史；批准笔记和 shell 调用被拒绝。

**待验证**：真实模型决定调用工具的过程、中文手写识别质量、真实飞书 CLI 写入/卡片回调/主动消息、服务器部署与 PG 恢复。原型阶段不添加测试套件；正式实现按规格的真实 Loader + PostgreSQL 主测试边界执行。

代码保存在 `prototype/24pa-dsh`，尚未形成可合并的生产功能 PR。技术通路的验证不代替你对交互体验的认可。
