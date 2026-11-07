# dsh 0.2.2-rc.1 适配核验（插件 0.2.2-rc.1.1 / PR #265＋#266）

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

## API 移植（PR #266，#265 的编译/运行时缺口）

0.2.2 重写 Schedule 请求面：`create(sessionId, 键控request)` → `create({title,prompt,timing 判别联合,target})`（归属进 `target.sessionId`）；`update({sessionId,id,expected,change,title,prompt})` → `edit({id,action,patch,expectedUpdatedAt})`（删除也走 edit）；`RecurringScheduleRecord` 新增 rrule 变体（无 `.time`）。处置＝`schedule-bridge.ts` 能力探测方言、对内统一旧面；内部键控时间面与全部业务代码不变。**#265 教训：发布流程曾吞掉 tsc 失败（`npm run build 2>&1 | tail -1` 空输出）——发版前必须显式核对 tsc 退出码**；真实服务级验证（digest-reliability 直连 0.2.2 ScheduleService）才是方言移植的有效回路，类型编译通过≠请求面兼容。

## 踩坑记录

- 冒烟工作区 AGENTS.md：配置校验要求多个字符串字段**显式存在**（folderToken/appIdEnv…），最小 json 会连环报「必须为字符串」；正解＝DEFAULT_CONFIG 全字段生成（tests/helpers/runtime.mjs 同款）。
- `dsh plugin add` 首次失败＝pnpm 构建脚本门（protobufjs），补 allowBuilds 后重跑即过；错误日志（pnpm.log）只留命令行，需手动复跑看真因。

## 生产部署（8010，2026-11-06 14:20–14:27，部署与核验分两会话）

- 全栈：宿主＝`deployments/dsh-0.2.2-rc.1` 目录形态（start.sh exec 指其 `node_modules/.bin/dsh`；全局 `/usr/local/bin/dsh` 仍 0.2.1-rc.5，不作为实例证据）＋mcp-client/双 subagent 各 0.2.2-rc.1＋research-graph@0.2.1-rc.5.2 豁免（14:26 首启豁免未生效被 skip，重办后 14:27 轮加载正常）。
- 插件 0.2.2-rc.1.1＝**含 #266 方言桥的制品**：发布顺序为先合 #266 再打包（版本号沿用 .1.1，无 .1.2）；tag `v0.2.2-rc.1.1` 指向 5a87eef（#266 之后），npm 与 GitHub Release 同制品（SHA-1 `79600707…`，tarball 含 `lib/schedule-bridge.js` 与 plan-time `nativeTiming`）。
- 核验：当前轮启动零 error／零 skip；readiness **6/6**（host 行指纹＝dsh 0.2.2-rc.1＋插件 0.2.2-rc.1.1＋飞书 SDK 1.74.0；飞书 sdk-ws 长连接已启动）；SQLite 账本 ok；智能晨报 daily 计划 active，宿主 `storages/schedule.json` 记录在位（schedule-0a29fb56 → feishu 会话）；旧 morning 计划 stopped（规格 2.17 智能晨报取代）。
- 待真实业务观察：schedule 原生投递＝次日 08:00 晨报窗口；企微通道、子代理真实派发待首跑。

## 首次原生投递复盘（2026-11-07 08:00–08:10，两个缺陷）

**业务本身成功**：08:00 唤醒（旧 BATCH 信封，19 条历史全部可解析）→ 触发准入 → daily-planning skill 运行 → 08:01:56 文本＋语音 outbox 均 sent，run outcome completed。**但 08:10:02 计划被自毁**（暂停＋原生 schedule 删除＋主人通知「超过宽限仍无对应完成回执」），随后 recover() 每轮询重抛刷屏（至 16:15 约 7.3 万条 journal 行）。

- **缺陷一（24私助侧潜伏 bug，与 0.2.2 无关）**：`digest supervise` 漏加「已升级」守卫——task_config 计划的完成记录在任务运行侧（task_plan_run_outcome／task_plan_delivery），`completedSources` 只读旧简报表（digest_occurrence＋digest_work_binding），对 skill 计划恒为空 → 当前代次的首次投递超 10 分钟宽限＝误判漏发 → `plans.stop` 暂停＋拆除。此前未触发仅因每天 09:41 的例行编辑轮换了 schedule 代次（旧投递归 previousUnconfirmed 不算 overdue）。修复＝supervise 跳过 task_config 计划（与 digest.ts 其余三处「已升级」守卫对齐，并收口为本文件共用 `upgradedPlan` 判定）；其唤醒核对由会话历史恢复路径负责。**方案取舍**：备选＝`completedSources` 改读任务运行侧回执——未选，旧监督对定时任务没有一致的真值来源口径，运行侧对账属于任务运行域自身闭环；如后续需要跨域漏发告警，随迭代单独设计。
- **缺陷二（#266 接收面缺口）**：0.2.2 新增 `[SCHEDULE CHANGE]` 通知（计划在会话外被变更时投给会话，自带 schedule 来源、明确「不是投递、无需动作」）——`scheduleReminders` 只认 REMINDER 两信封，遇 CHANGE 抛「宿主计划消息格式无法核验」→ 消费/恢复路径中断、恢复备忘录永不落 → 每个轮询周期全量重跑＝刷屏。0.2.2 宿主消息信封全集＝REMINDER／REMINDER BATCH／CHANGE 三种。修复＝CHANGE 前缀直接返回 null（与被引用框定同待遇，永不作为触发准入）。
- 生产证据链：会话存储 zstd 逐条复检（19 条 REMINDER 全 OK、1 条 CHANGE NO-ENVELOPE）；`schedule.json` 现为 0 条；outbox #71＝自毁通知；计划行 updated_at 与 CHANGE 消息时间同毫秒级吻合。
- 生产恢复：修复版部署后走 `plan.change` op=enable（preview→fingerprint→confirm）重新启用智能晨报并重建原生 schedule；次晨 08:00 复验。
