# frank-sq — 开源项目与插件仓库（仓级管理日志）

> 对外开源发布仓。仓内只放脱敏后的可发布内容；内部完整指针与敏感信息不在此仓。

## 项目信息

| 项目 | 内容 |
|------|------|
| 名称 | frank-sq |
| 定位 | 对外开源项目 / 插件共享仓 |
| 仓库 | `git@github.com-frank-sq:cigfrank001-hash/frank-sq.git` |
| 协议 | MIT |
| 结构 | `projects/<子项目>/` 一项目一文件夹 |

## 操作日志

| 日期 | 操作 | 结果 |
|------|------|------|
| 2026-08-20 | 首个子项目入仓 — `openai-to-anthropic-proxy`（WorkBuddy↔MiniMax 协议转换代理 v1.1.2）脱敏开源：排除 DEPLOY-FOR-AGENT.md（内部部署说明）+ screenshots，修正 README 内部路径 2 处 + CONTRIBUTING 过时说明，MIT 协议 | ✅ |
| 2026-08-20 | 首次 push 上线 — deploy key（frank-sq-claude，写权限）由 Frank 添加，`git push -u origin main` 成功，main 上线（HEAD `34a8e8b`） | ✅ 已上线 |
| 2026-08-20 | 初始化开源仓骨架（README / LICENSE(MIT) / .gitignore / CLAUDE.md / project.md / SQ-INDEX.md + projects/_template 样板 + 独立 SSH key） | ✅ |

## 故障记录

| 日期 | 严重度 | 故障 | 根因 | 修复 | 预防 | 状态 |
|------|--------|------|------|------|------|------|
| — | — | — | — | — | — | — |
