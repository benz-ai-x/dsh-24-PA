# 24私助（24PA）飞书接入配置指南

本指南面向 AI 助理（也供本人查阅），是配置飞书接入的**唯一权威流程**。配置前先通读本文，按阶段推进；**每个阶段结束时用 `pa24_connection action=check` 验证达标，再进入下一阶段**。检查结果的 `nextSteps` 字段会直接指出当前卡点对应的下一步。

核心心智模型：

1. **两种身份**：机器人身份（应用自己，宿主用它收发消息/卡片/下载图片）与用户身份（本人，lark-cli 以 `--as user` 操作任务/日历/文档）。两者授权相互独立，都要就绪。
2. **顺序铁律**：建应用 → CLI 绑定与用户授权 → 取资源标识 → 补启动环境变量（App ID/Secret，**由本人填写**）→ AGENTS.md 切 `mode: feishu` → 重启宿主 → 端到端验证。乱序会在配置校验或资源获取处卡死。
3. **四类事只有本人能做**：浏览器里的开放平台操作（建应用/开权限/发布）、授权点击、lark-cli 应用凭据绑定（`config init`，Secret 经本人终端输入）、在启动环境填写 App Secret。其余（发起授权流、查资源标识、改 AGENTS.md、健康检查）都可由你代办。

---

## 阶段 0：前置自查（你代办）

| 检查 | 达标标准 | 不达标处置 |
|---|---|---|
| dsh 宿主运行 | 面板可访问，readiness 中 host/config 为 ok | 先解决宿主与工作区问题，飞书接入无从谈起 |
| PostgreSQL 已连接 | readiness 中 postgres 为 ok | 修复 `pgDsnEnv` 指向的环境变量与数据库 |
| lark-cli 可执行 | `pa24_connection check` 的 `cli.state = ok`（返回的 `version` 字段供参考，检查只验证可执行性） | 在服务器安装 lark-cli；注意校验的是 **dsh 宿主进程的 PATH**，不是你的 shell PATH |
| 本人有飞书开发者后台权限 | 能访问 open.feishu.cn 并创建企业自建应用 | 联系企业管理员，或换由管理员完成阶段 1 |

## 阶段 1：创建飞书自建应用（本人浏览器操作，你给操作单）

请把下面清单原样交给本人，让其在浏览器完成；你无法代办：

1. 打开 [open.feishu.cn](https://open.feishu.cn) → 开发者后台 → **创建企业自建应用**（名称建议「24私助」）。
2. **凭证与基础信息**页：记录 `App ID` 与 `App Secret`（Secret 只本人保存，建议存入钥匙串；**不要发给 AI、不要写进任何仓库文件**）。
3. **添加应用能力 → 机器人**。
4. **权限管理**：开通以下权限点（在页面按关键词搜索勾选；以开放平台实际显示的名称为准）：
   - 机器人/应用身份：发送消息（以应用身份发单聊消息）、获取消息中的资源文件、接收用户发给机器人的单聊消息。
   - 用户身份相关：任务读写与分派、日历读写、云文档创建与编辑、云空间目录读取。
5. **事件与回调**：订阅方式选择 **使用长连接接收事件**（无需公网回调地址）；添加事件「接收消息 im.message.receive_v1」；启用「卡片交互回调 card.action.trigger」（审核卡片按钮依赖它）。
6. **可用范围**：把本人加入可用范围（否则收不到机器人的消息）。
7. **创建版本并发布**（企业自建应用通常即时生效；权限点变更后**必须再次发布版本**才生效）。

达标标准：应用已发布；本人已保存 App ID/App Secret。

## 阶段 2：lark-cli 绑定与用户授权（本人绑凭据，你发起授权）

lark-cli 的登录是 **Device Flow**，官方为 AI agent 设计：你发起、本人浏览器确认、你收尾。

1. 绑定应用凭据（**只有本人能做**；若 `lark-cli config show` 已显示正确 App ID 可跳过）：
   由**本人在自己的终端**运行 `lark-cli config init`（按提示填 App ID、经 stdin 输入 App Secret）——你不得经手 Secret，也不要请本人把 Secret 粘贴到对话里。
   多应用时用 `--profile <名>`；该名字必须与 AGENTS.md 的 `larkProfile` 一致。你可用 `lark-cli config show --profile <名>` 核对绑定结果。
2. 发起用户授权（三步法，你代办）：
   - `lark-cli auth login --no-wait --json --profile <名> --domain im,task,calendar,docs,drive`
   - 把返回的**验证 URL**（或 `auth qrcode` 二维码）作为消息交给本人，请其在浏览器完成登录授权后告知你；
   - 本人确认后：`lark-cli auth login --device-code <上一步返回的设备码> --profile <名>` 完成绑定。
   `--domain` 按域圈定授权范围（im/task/calendar/docs/drive 正好覆盖24私助的业务面），避免申请全量权限。
3. 验证：`lark-cli auth status --verify --profile <名>`。

达标标准：`identities.bot.status = ready` 且 `identities.user.status = ready`、`user.tokenStatus = valid`、`user.openId` 与 AGENTS.md `ownerOpenId` 一致。把 `user.openId` 记下来——首次配置时它就是 `ownerOpenId` 的来源。

## 阶段 3：获取资源标识（你代办）

| 配置项 | 获取方式 | 说明 |
|---|---|---|
| `ownerOpenId` | 阶段 2 的 `auth status` 输出 `identities.user.openId` | 已预填则核对一致即可 |
| `folderToken` | 飞书云文档新建（或选定）一个文件夹，从其网页链接复制 token（`…/drive/folder/<token>`）；或 `lark-cli drive files list …` 从既有目录取 | 备忘/纪要/笔记文档都建在此目录 |
| `tasklistId` | 飞书任务（网页或客户端）打开目标清单，从链接复制 guid；或用 lark-cli task 清单命令创建/列出 | 待办任务的真实归属 |
| `calendarId` | 默认 `primary` 即本人主日历，**无需改动** | 除非明确要用其他日历 |

## 阶段 4：切换配置（你改文件，本人填密钥）

顺序不可颠倒——**先环境变量，后 AGENTS.md，再重启**：

1. **启动环境**（本人操作）：在启动脚本/服务环境中设置
   `PA24_FEISHU_APP_ID=<App ID>`、`PA24_FEISHU_APP_SECRET=<App Secret>`
   （变量名可在 AGENTS.md 的 `appIdEnv/appSecretEnv` 改，值只存在服务器环境里）。AGENTS.md 中只出现**变量名**，永不出现密钥值。
2. **AGENTS.md**（你代办）：`mode` 改为 `"feishu"`，填入 `ownerOpenId/folderToken/tasklistId`。配置块必须仍是唯一 json 块。
3. **重启 dsh 宿主**：环境变量变更与 mode 切换都以重启为准（`pa24_workspace reload` 只热载 AGENTS.md，不重载环境变量，也不重建长连接）。你运行在宿主内，无法自重启——请明确告诉本人重启命令（如 `./start.sh`）。

## 阶段 5：健康检查与端到端验收

1. `pa24_connection action=check`，五段全部达标：
   - `source.state=ok`（AGENTS.md 与生效版本一致；`changed` 表示改后未 reload）
   - `cli.state=ok`
   - `auth.state=ok`（用户令牌有效且与 ownerOpenId 一致）
   - `resources` 三项 `state=ok`（folder/tasklist/calendar 可读；写入权限由首个真实任务回执验证）
   - 面板 readiness：`feishu` 显示「飞书长连接已启动」，收/发时间戳非空
2. 端到端：请本人在飞书里对机器人发送 `/24pa` → 应收到状态回复；再发一条非主人账号的消息验证被拒（安全默认）。
3. 首次业务试单：委派一条 memo（验证 docs 写入）或一个任务（验证 task 写入），核对回执链接真实可开。

## 阶段 6：故障对照表

| 现象（check/状态） | 原因 | 处置 |
|---|---|---|
| `cli.state=error`：找不到可执行 | 宿主进程 PATH 无 lark-cli | 安装并确保宿主启动环境能找到；改完必须重启宿主 |
| `auth.state=missing`：尚无用户授权 | 未做阶段 2 | 按三步法发起 `auth login`（Device Flow） |
| `auth.state=unbound` | ownerOpenId 为空 | 用 auth status 的 `user.openId` 填 AGENTS.md |
| `auth.state=mismatch` | CLI 授权用户 ≠ 配置主人 | 本人重新授权，或把 ownerOpenId 改为实际授权者（确认后者就是主人） |
| `auth.state=unverified` | 令牌失效/无法验证 | 重新 `auth login` 刷新令牌 |
| `auth.state=error` | `auth status --verify` 本身失败 | `lark-cli config show --profile <名>` 核对应用配置（App ID/brand）与网络；配置损坏时由本人 `config remove` 后重新 `config init` |
| `resources.*.state=error` | 权限点未开或应用未发布新版本 | 对照阶段 1 权限清单；**权限变更后重新发布版本** |
| 收不到飞书消息 | 长连接未启用/事件未订阅/不在可用范围 | 对照阶段 1 第 5、6 步 |
| 机器人能收不能发 | 发送权限点缺失或版本未发布 | 同上 |
| transport 启动报凭据错误 | env 未设或 App Secret 有误 | 阶段 4 第 1 步；重启宿主 |
| 改了 AGENTS.md 不生效 | 未 reload 或 json 块格式错 | `pa24_workspace reload`；错误会保留旧配置并报 `configError` |

## 安全红线

- App Secret 与令牌只存在服务器环境/钥匙串：**不读取、不回显、不写入任何文件或消息**；AGENTS.md 只保存环境变量名。
- 浏览器授权与密钥填写永远由本人完成；你只发起流程、转交链接、验证结果。
- 配置失败可随时回退：AGENTS.md 改回 `mode: "demo"` 并重启即可恢复无飞书的本地体验；业务账本不受影响。
- 多轮未达标时，先 `check` 定位当前阶段，再按 `nextSteps` 收敛——不要在未验证的假设上反复尝试外部写入。
