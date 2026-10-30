# SQ-INDEX — 子项目指针索引

> 本表为对外脱敏口径：只登记「子项目名 ↔ 来源 ↔ 协议 ↔ 状态」，不含本地路径与敏感信息。

| 子项目 | 目录 | 来源 | 协议 | 状态 | 跟进日志 |
|--------|------|------|------|------|----------|
| openai-to-anthropic-proxy | `projects/openai-to-anthropic-proxy/` | 脱敏导出 | MIT | 🟢 v1.1.3 | `PROJECT-LOG.md` |
| ai-pose-gallery-frank | `projects/ai-pose-gallery-frank/` | 上游镜像 · `anhao/ai-pose-gallery-zh@072a3690` | MIT（仅代码；图片与原始数据非 MIT，不入库） | 🟢 v0.1.0 | `PROJECT-LOG.md` |

## 入仓规则

1. 每个子项目必须有独立 `projects/<name>/README.md` + `PROJECT-LOG.md`。
2. 「来源」栏写 `脱敏导出` / `直接开发` / `上游镜像 · <repo>@<commit>`，不写本地绝对路径。
   - `上游镜像` 类子项目必须带 `UPSTREAM.md`（固定 commit + 取件校验 + 本副本改动清单）与 `NOTICE.md`（许可分层与权利人异议通道）。
3. 入仓 / 更新后同步本表与 `project.md` 操作日志。
