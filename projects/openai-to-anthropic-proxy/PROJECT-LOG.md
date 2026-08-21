# PROJECT-LOG — openai-to-anthropic-proxy 跟进日志

> 子项目：WorkBuddy ↔ MiniMax Coding Plan 协议转换代理（OpenAI↔Anthropic 双向转换，零外部依赖）
> 来源：脱敏导出（真实 Key 与内部部署说明未随行）

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.1.3 | 2026-08-21 | start.bat 重构：中文输出全部委托 PowerShell，规避 cmd 解析中文括号误判 |
| v1.1.2 | 2026-08-18 | 进程退出信号追踪 + EADDRINUSE 回归测试（63/63） |
| v1.1.1 | 2026-08-18 | 端口冲突清晰报错 + start.bat 预检查 |
| v1.1.0 | 2026-08-18 | Function Calling / Tool Use + 流式 tool_calls |
| v1.0.0 | 2026-08-18 | 初始发布 |

## 开源发布

- 2026-08-20 首次开源：脱敏后入仓（排除内部部署说明与验证截图），MIT 协议。

## 待办

- [ ] 无

详见 [CHANGELOG.md](./CHANGELOG.md)。
