# 秘密脱敏与扫描

本目录是 #228 的统一脱敏与扫描工具，不随 npm 包发布（`files` 白名单不含 scripts）。

## 组件

| 文件 | 用途 |
|---|---|
| `patterns.mjs` | 凭据形态单一来源（redact 与 scan 共用，不会漂移） |
| `redact.mjs` | 脱敏库＋CLI。探针／测试助手在写证据文件前 `redactString()`；既有文件用 `node redact.mjs <file...>` 原地修复 |
| `scan.mjs` | 扫描器。`--paths`（默认只扫 git 跟踪文件，与 CI 一致）、`--staged`（pre-commit 只扫暂存新增行）、`--history`（全历史评估，报告模式恒退出 0） |
| `allowlist.json` | 精准豁免：按值 sha256（可限定文件）＋理由。**不支持整目录忽略** |
| `hooks/pre-commit` | pre-commit 钩子，经 `install-hooks.mjs` 安装 |
| `install-hooks.mjs` | `git config core.hooksPath packages/24pa/scripts/secrets/hooks`（幂等） |

## 覆盖的形态

- dsh web 启动 URL 的 `?token=` 一次性令牌；
- 凭据字段值（`token`／`approveToken`／`accessToken`／`secret`／`password` 等，值 ≥16 且为凭据字符集，含审核卡 `<48hex>:body` 冒号后缀与 `\"token\"` 转义引号形态）；
- JWT、GitHub `ghp_`、OpenAI `sk-`、Slack `xox*`、AWS `AKIA`、Google `AIza`、PEM 私钥块；
- 嵌套／转义 JSON：`redactString` 迭代至不动点（≤5 轮）。

环境变量名形态（`FEISHU_APP_SECRET` 等，含标识符内 `SECRET` 子串）、占位符前缀（`replace_with_*` 等）、飞书资源标识（`media-`／`media_v2_`／`img_v2_`／`file_v`，取资源仍需租户鉴权）与已脱敏标记（`[REDACTED:len=N]`）按规则自动跳过；均不需要进豁免清单。标识符赋值（`token: params.appSecret`）按「含数字或 ≥32 字符」凭据启发式排除。

`tests/helpers/host.mjs` 的 `logs()` 已接入 `redactString`——启动 stdout 带出的一次性令牌在测试取证落盘前自动脱敏；探针脚本写证据前同样应过 `redactString()`（提交时另有 staged 扫描兜底）。

## 新增豁免

只允许「值哈希＋（可选）文件＋理由」条目，值必须重新生成或确认为无效凭据；禁止用路径通配或目录忽略让扫描失效。CI（`.github/workflows/secret-scan.yml`）在每次 push／PR 对全仓执行 `--paths`，历史扫描可手动触发。

## 本次处置记录（2026-10-24）

- 已脱敏：`docs/research/evidence/2026-10-20-main-final/pa24-final-p0-runtime-host-log.json`（启动令牌，一次性换取会话 cookie 后失效，见 `tests/helpers/host.mjs`；探针收尾 `host.stop()`）、`docs/research/evidence/2026-10-20-p1-implementation/pa24-v01-spec-legacy-card{,-rereview}.log`（FakeFeishuTransport 进程内生成的审核卡令牌，从未触网）。
- 扫描结果：跟踪文件全树 `--paths` clean；`--history` 仅命中上述三份文件的引入提交（`77d3232`、`c567a27`、`5bf5765`），无其他残留。`prototypes/24pa-dsh/.env.example` 历史版本的 `replace_with_your_…_secret` 为占位符，按规则豁免。GitHub Secret Scanning 告警 0；Actions 无 artifacts；npm 包 `files` 白名单不含 docs／scripts，证据不随发布外泄。
- 历史残留处置：三处引入提交保留在 Git 历史，凭据均为隔离测试产物且已失效（见 #228 处置评论），不做历史重写；如后续需要重写，先协调并行分支。
- 阻断演示：暂存含新生成 48-hex 无效令牌的文件时 `--staged` 以退出码 1 阻断（2026-10-24 实测）。
