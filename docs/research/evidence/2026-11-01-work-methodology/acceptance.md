# 工作方法实施验收记录

日期：2026-11-01。分支：`codex/work-methodology`。基线：`e06e4cff30fd67721537093e135e2fc2b48c330d`。实现提交：`2bf8bf2`；审查修复：`9a7dcc9`、`6e91381`。

## 可使用流程

对话确认近期成果 → 保存最多三项今日建议 → 明确采纳其中若干项 → 日终对照采纳快照复盘 → 次日参考最近复盘。首页只读同一组持久记录，按钮形成对话草稿。

`daily-planning`、`daily-review` 在 Skill 角色和业务名称明确放行后，可通过通用定时任务运行。后台仅保存建议／复盘，不确认重点或采纳，不写原平台。旧简报入口不接受这两个新名称，原模板不自动迁移。

## 已执行验证

工作目录为 `packages/24pa`，Node 26.4.0，dsh 0.2.1-rc.5，产品包 0.2.1-rc.5.3。

| 检查 | 结果与边界 |
| --- | --- |
| `npm run build` | 通过 |
| `npm run preset:check` | 通过，仍与宿主 rc.5 基线一致 |
| `npm test -- --run tests/unit/work-planning.test.mjs tests/unit/digest-reliability.test.mjs tests/unit/home-panel.test.mjs tests/unit/work-tool-schema.test.mjs tests/unit/prompts.test.mjs tests/unit/skills.test.mjs tests/unit/task-plan-service.test.mjs` | 最终构建 217 项通过，7 个文件；含 SQLite/PostgreSQL、并发与重复、备份导入、跨天、重点变更、采纳时容量、后台权限、部分采纳、草稿即时语言切换 |
| `PA24_E2E_STORAGE=sqlite npm test -- --run tests/e2e/work-methodology.e2e.mjs` | 通过：真实 Loader、原生对话和两个原生定时 Skill、只读首页、同账本重启；模型与平台为隔离桩 |
| `PA24_E2E_STORAGE=postgres npm test -- --run tests/e2e/work-methodology.e2e.mjs` | 同流程通过，PostgreSQL 隔离实例 |
| 桌面 T20 | 真实 dsh 页面检查 1280×800、1440×900、1920×1080，无横向溢出；中文浅色、英文深色、建议展开、复盘展开、键盘打开草稿；浏览器无 error 日志。空态／错误／来源不全／工作区切换由客户端测试补充 |
| `git diff --check`、提交秘密扫描 | 通过 |

完整 `npm run test:unit` 首次运行覆盖 95 个文件：93 文件通过，2 文件合计 8 项失败（1611 通过、1 跳过）。运行期间实现和测试有更新，因此该次不属于最终版本的一致全量运行：工作方法 6 项在最终构建定向复测通过；工具 schema 的 2 项确为宿主支持子集及动作目录契约问题，已修复并复测。上表最终 217 项覆盖全部失败文件及受影响模块；未把首次全量结果写成全量通过，也未在最终提交重复整套全量命令。

截图：[中文浅色](zh-light-1440.jpg)、[英文深色](en-dark-1920.jpg)。由 `node scripts/manticore-home-ui.mjs --work-methodology` 建立实际业务记录；截图不代表真实平台账号验收。

## Standards

初审 3 项：已打开草稿未即时切换语言；旧简报入口没有约束后续规划日期；旧简报入口绕过新方法放行条件。已分别改为按语言派生草稿、固定普通定时 Worker 的原发生窗口、拒绝旧入口绑定新方法。独立复审通过，剩余 0 项。

## Spec

初审 4 项：保存旧建议时未校验原重点版本；Schedule 委派的普通 calendar Worker 可确认；采纳前未重算无时间块的容量；部分采纳后其他候选不可见。已补齐读取时 `focusRevision` 校验、持久触发来源检查、当前容量及证据重算、保留未采纳候选。第一次复审指出容量浮点精确比较会把自然流逝误认为变更，已改为工作时段／忙碌区间的稳定依据指纹，并继续保存采纳时真实剩余容量。`6e91381` 独立复审通过，剩余 0 项。

## 未完成的外部验收与交付

审查汇总：Standards 剩余 0 项；Spec 剩余 0 项。两轴均无未清偿的实现问题。

- 连续五个工作日的真实使用、真实账号与真实模型质量未验收；不由隔离测试代替。
- 此前自动审批拒绝创建 GitHub 实施 Issue，理由为当时授权未明确涵盖向远端发布详细实施方案。用户于 2026-11-01 明确授权创建 PR 后，已推送功能分支并创建 [Draft PR #257](https://github.com/benz-ai-x/dsh-24-PA/pull/257)，目标为 `main`，尚未合并。实施 Issue 与远端父规格同步仍未完成。
- `AGENTS.md` 有独立用户改动，保留且未纳入本功能提交。
