# 智能工作晨报验收记录

日期：2026-11-02，Asia/Shanghai。对应 F48／[#259](https://github.com/benz-ai-x/dsh-24-PA/issues/259)。比较基线 `27f58d4650e44c3a0a22b5516870e7d8ca3dee21`，初始实现提交 `34fe6ac9cebf34acb3111a7b37ddb605f122d7b3`，日期清空修复提交 `637cc24949c95491064ae987c6293c6207fbf2e7`。

## 隔离验证

命令在 `packages/24pa` 运行。真实宿主为 dsh `0.2.1-rc.5`，通过 `DSH_BIN` 指向本机已构建的 CLI；测试使用独立工作区和数据库，未修改运行中的主人实例。

| 范围 | 命令／条件 | 结果与证据 |
|---|---|---|
| 构建 | `npm run build` | 通过：[最终构建](build-final.log) |
| 预设契约 | `npm run preset:check` | 通过，宿主基线 `0.2.1-rc.5`：[日志](preset-check.log) |
| 完整单元回归 | `npm run test:unit` | 98 文件，1670 通过、1 跳过：[完整日志](unit-full.log) |
| 最终文案与界面增量 | `npx vitest run tests/unit/manticore-panel.test.mjs tests/unit/skills.test.mjs` | 最后调整日期标签与完成标准后复验，45 通过：[增量日志](ui-skill-retest.log) |
| 日期清空修复增量 | `npx vitest run tests/unit/manticore-panel.test.mjs` | 审查发现填写后清空仍提交空字符串；修复预览／保存时省略可选日期后，34 通过：[回归日志](date-clear-retest.log) |
| SQLite Loader | `PA24_E2E_STORAGE=sqlite npx vitest run tests/e2e/work-methodology.e2e.mjs tests/e2e/manticore-task-plan.e2e.mjs` | 通用计划 8 通过；工作方法最终复验 1 通过：[首轮](loader-sqlite.log)、[最终复验](work-methodology-sqlite-final.log) |
| PostgreSQL Loader | 上述命令改为 `PA24_E2E_STORAGE=postgres` | 通用计划 8 通过；工作方法最终复验 1 通过：[首轮](loader-postgres.log)、[最终复验](work-methodology-postgres-final.log) |

完整单元回归覆盖 SQLite／PostgreSQL 的昨日准确日期、复盘引用的不可变采纳版本、后续重新采纳、历史版本缺失、较早复盘不能冒充昨天等场景。界面测试覆盖智能晨报新建、暂停后修改同一计划、保留名称／时间／投递、旧授权不能直接启用新 Skill，以及空／加载／读取失败状态。语音测试验证关键缺失和后续取舍不被整段丢弃。

首轮 Loader 的工作方法用例读取了公开结果中不存在的 `snapshot.definition`，因此失败；改用真实公开契约 `contract.expectedResult` 与 `contract.mode` 后，两种存储均通过。首轮日志保留，不将失败轮记作通过；日志仅去掉文件末尾空白行。最后两行 Skill 完成标准调整后，又分别执行最终工作方法复验；中间复验日志亦保留。

真实 Loader 链路覆盖近期重点→保存建议→本人采纳→复盘→次日读取准确历史版本→原生定时建议→重启读取。原模板同一计划切换为智能 Skill 后，旧授权直接启用被拒绝，明确重新核验后启用成功，时间与投递配置保留。

## 电脑界面

使用同一实际 Loader 的隔离 SQLite 实例，通过浏览器界面执行；仅存结果，无真实平台投递。

- 1280×800／中文浅色：晨报预设选择智能 Skill，说明使用模型和采纳边界，工作日期为自然语言标签；Tab 从名称到 Skill 再到日期，焦点清晰，文档宽度等于视口宽度。[截图](ui-1280-zh-light.jpg)
- 1440×900／中文浅色：暂停的原模板计划切换、预览、保存后仍为同一计划，名称及 08:30／Asia/Shanghai 保留；启用前显示真实 Skill、工具、投递和未来时间，未确认时按钮禁用。[截图](ui-1440-migration-preview.jpg)
- 1920×1080／英文深色：智能晨报名称、模型提示和日期标签均可读，长说明正常折行，键盘焦点可见。[截图](ui-1920-en-dark.jpg)

截图来自隔离验收数据；中文名称「原模板晨报」是测试计划名称。无需手机端验收。显示设置与临时视口在结束后恢复。

日期清空修复后重新加载实际界面，执行“填入 2026-11-02→清空→预览→保存为暂停”，再展开已保存配置，确认 `parameters: {}`；未来时间按每日规则计算。[界面回读](ui-date-clear-readback.txt)

## 证据边界

模型及外部服务使用可控测试替身；以上证明真实宿主调用、权限、保存、切换、重启和界面行为，不证明真实模型的晨报质量或飞书／企微真实投递质量。样稿是虚构内容示例。真实模型对完整晨报场景的表达质量和主人的实际使用效果仍待试用评价。

本次未部署、未发布，未替换主人正在运行的晨报计划。Standards／Spec 审查以 [PR #260](https://github.com/benz-ai-x/dsh-24-PA/pull/260) 中记录的固定提交为准；首审 Standards 0 项、Spec 1 项（可选日期清空），修复和复审在两轴下分别登记。
