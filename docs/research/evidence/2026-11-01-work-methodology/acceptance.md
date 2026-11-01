# 工作方法实施验收记录

日期：2026-11-01。分支：`codex/work-methodology`。基线：`e06e4cff30fd67721537093e135e2fc2b48c330d`。首个实现提交：`2bf8bf2`。

## 可使用流程

对话确认近期成果 → 保存最多三项今日建议 → 明确采纳其中若干项 → 日终对照采纳快照复盘 → 次日参考最近复盘。首页只读同一组持久记录，按钮形成对话草稿。

`daily-planning`、`daily-review` 在 Skill 角色和业务名称明确放行后，可通过通用定时任务运行。后台仅保存建议／复盘，不确认重点或采纳，不写原平台。旧简报入口不接受这两个新名称，原模板不自动迁移。

## 已执行验证

工作目录为 `packages/24pa`，Node 26.4.0，dsh 0.2.1-rc.5，产品包 0.2.1-rc.5.3。

| 检查 | 结果与边界 |
| --- | --- |
| `npm run build` | 通过 |
| `npm run preset:check` | 通过，仍与宿主 rc.5 基线一致 |
| `npm test -- --run tests/unit/work-planning.test.mjs tests/unit/digest-reliability.test.mjs tests/unit/home-panel.test.mjs` | 93 项通过：工作方法 28、周期耐久交付 54、首页 11；含 SQLite/PostgreSQL、并发与重复、备份导入、跨天、重点变更、采纳时容量、后台权限、部分采纳、草稿即时语言切换 |
| `PA24_E2E_STORAGE=sqlite npm test -- --run tests/e2e/work-methodology.e2e.mjs` | 通过：真实 Loader、原生对话和两个原生定时 Skill、只读首页、同账本重启；模型与平台为隔离桩 |
| `PA24_E2E_STORAGE=postgres npm test -- --run tests/e2e/work-methodology.e2e.mjs` | 同流程通过，PostgreSQL 隔离实例 |
| 桌面 T20 | 真实 dsh 页面检查 1280×800、1440×900、1920×1080，无横向溢出；中文浅色、英文深色、建议展开、复盘展开、键盘打开草稿；浏览器无 error 日志。空态／错误／来源不全／工作区切换由客户端测试补充 |
| `git diff --check`、提交秘密扫描 | 通过 |

完整单元回归另外运行，最终结果随后补记；以上针对性证据不冒充全量通过。

截图：[中文浅色](zh-light-1440.jpg)、[英文深色](en-dark-1920.jpg)。由 `node scripts/manticore-home-ui.mjs --work-methodology` 建立实际业务记录；截图不代表真实平台账号验收。

## Standards

初审 3 项：已打开草稿未即时切换语言；旧简报入口没有约束后续规划日期；旧简报入口绕过新方法放行条件。已分别改为按语言派生草稿、固定普通定时 Worker 的原发生窗口、拒绝旧入口绑定新方法。复审结果待补。

## Spec

初审 4 项：保存旧建议时未校验原重点版本；Schedule 委派的普通 calendar Worker 可确认；采纳前未重算无时间块的容量；部分采纳后其他候选不可见。已补齐读取时 `focusRevision` 校验、持久触发来源检查、当前容量及证据重算、保留未采纳候选。复审结果待补。

## 未完成的外部验收与交付

- 连续五个工作日的真实使用、真实账号与真实模型质量未验收；不由隔离测试代替。
- 自动审批拒绝创建 GitHub 实施 Issue，理由为当前授权未明确涵盖向远端发布详细实施方案。尚未创建 Issue／PR、推送分支或同步远端父规格；本地文件可供批准后发布。
- `AGENTS.md` 有独立用户改动，保留且未纳入本功能提交。
