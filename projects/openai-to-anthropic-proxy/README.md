# WorkBuddy ↔ MiniMax Coding Plan 协议转换代理

让 **WorkBuddy**（只支持 OpenAI 协议）通过本地代理，使用 **MiniMax Coding Plan**（仅暴露 Anthropic 兼容协议，`sk-cp-` 订阅 Key）。

---

## 一、解决什么问题

| 客户端 | 支持协议 | 可用的 MiniMax Key |
|---|---|---|
| WorkBuddy 自定义模型 | 仅 OpenAI 兼容 | `sk-cp-` 订阅 Key 不适用（MiniMax 的 OpenAI 兼容端点对订阅 Key 有限制） |
| 本代理（bridge） | OpenAI（入）↔ Anthropic（出） | 转发到 MiniMax `https://api.minimaxi.com/anthropic/v1/messages` |

最终数据流：

```
WorkBuddy ──OpenAI──> 127.0.0.1:18000/v1 ──> [proxy.js] ──Anthropic──> api.minimaxi.com
```

---

## 二、准备工作

1. **Node.js 18 及以上**
   - 下载：<https://nodejs.org/>
   - 验证：命令行执行 `node -v`，输出应 `>= v18`

2. **MiniMax Coding Plan 订阅 Key**
   - 形如 `sk-cp-xxxxxxxxxxxxxxxxxxxxx`
   - 国内版申请：<https://platform.minimaxi.com/>

3. **WorkBuddy**（最新版即可）

---

## 三、启动代理

### 方式 A：一键脚本（推荐）

1. 用记事本打开 `start.bat`
2. 把 `set MINIMAX_API_KEY=sk-cp-请替换成你自己的Key` 中的占位符替换为你的真实 Key
3. 保存后双击运行
4. 看到下面输出即为启动成功：

   ```
   ============================================================
     WorkBuddy + MiniMax (Anthropic) Protocol Proxy
   ============================================================
     MINIMAX_API_KEY = sk-cp-xxxxxx...
     PORT            = 18000
     LOG_LEVEL       = info

     按 Ctrl+C 退出
   ============================================================

   [2026-08-18T10:00:00.000Z] [INFO] 协议转换代理已就绪
   [2026-08-18T10:00:00.000Z] [INFO] 监听端口:      127.0.0.1:18000
   [2026-08-18T10:00:00.000Z] [INFO] 上游地址:      https://api.minimaxi.com/anthropic/v1/messages
   ...
   ```

### 方式 B：命令行

```bash
cd d:\Qoder\2qoder\openai-to-anthropic-proxy

set MINIMAX_API_KEY=sk-cp-你的真实Key
node proxy.js --port 18000 --log info
```

或者一行命令：

```bash
node proxy.js --api-key sk-cp-你的真实Key --port 18000
```

可用参数：

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--port` | `PORT` | `18000` | 本地监听端口 |
| `--api-key` | `MINIMAX_API_KEY` | （必填） | MiniMax 真实订阅 Key |
| `--upstream` | `UPSTREAM_URL` | `https://api.minimaxi.com/anthropic` | 上游 Anthropic Base URL |
| `--model` | `DEFAULT_MODEL` | `MiniMax-M3` | 缺省 model 时使用 |
| `--log` | `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `--allow-keys` | `ALLOW_PLACEHOLDER_KEYS` | `sk-workbuddy,placeholder` | WorkBuddy 端允许填的占位符 Key，逗号分隔 |
| `--timeout` | `TIMEOUT_MS` | `300000` | 上游调用超时（毫秒） |

---

## 四、WorkBuddy 配置

代理保持启动状态，然后在 WorkBuddy 里添加自定义模型：

| 字段 | 填写值 |
|---|---|
| 接口地址 | `http://127.0.0.1:18000/v1` |
| API Key | `sk-workbuddy`（代理默认允许的占位符） |
| 模型名称 | `MiniMax-M3` |

> 如果 WorkBuddy 提示「自定义协议」，勾选后接口地址会被原样发送，我们这个路径正好符合。
> 模型名称也可以填 `MiniMax-M2.7`、`MiniMax-M2.5-highspeed` 等，详见 `/v1/models` 端点。

保存后，在对话界面切到这个模型即可开始使用。

---

## 五、自测（无需 WorkBuddy）

代理启动后，命令行另开一个窗口执行：

### 5.1 非流式

```bash
curl -X POST http://127.0.0.1:18000/v1/chat/completions ^
  -H "Authorization: Bearer sk-workbuddy" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"MiniMax-M3\",\"messages\":[{\"role\":\"user\",\"content\":\"用一句话介绍你自己\"}],\"max_tokens\":200}"
```

期望：返回标准 OpenAI 格式 JSON，含 `choices[0].message.content`。

### 5.2 流式（SSE）

```bash
curl -X POST http://127.0.0.1:18000/v1/chat/completions ^
  -H "Authorization: Bearer sk-workbuddy" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"MiniMax-M3\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"数到5\"}],\"max_tokens\":100}"
```

期望：返回若干 `data: {...}` 行，末尾以 `data: [DONE]` 结束。

### 5.3 模型列表

```bash
curl http://127.0.0.1:18000/v1/models ^
  -H "Authorization: Bearer sk-workbuddy"
```

### 5.4 健康检查

```bash
curl http://127.0.0.1:18000/health
```

### 5.5 Function Call（Tool Use）

```bash
curl -X POST http://127.0.0.1:18000/v1/chat/completions ^
  -H "Authorization: Bearer sk-workbuddy" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"MiniMax-M3\",\"messages\":[{\"role\":\"user\",\"content\":\"北京天气如何\"}],\"max_tokens\":200,\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}}}}}]}"
```

期望：返回 `choices[0].finish_reason="tool_calls"`，`choices[0].message.tool_calls` 含 `id` / `function.name="get_weather"` / `function.arguments` 可 JSON 解析。

> 这个能力是 v1.1 加入的，让 WorkBuddy（乃至其他 OpenAI 兼容客户端）能真正驱动「持续干活」模式——模型可调工具，工具结果可继续进入下一轮对话。

### 5.6 集成测试（推荐，可一键跑全验证）

项目内置 mock 上游 + 集成测试脚本，无需真实 Key 即可验证代理全部路径：

```bash
cd d:\Qoder\2qoder\openai-to-anthropic-proxy
node test-integration.js
```

期望输出：`=== Summary: 63 passed, 0 failed ===`

覆盖场景：

| # | 场景 | 验证点 |
|---|---|---|
| 1 | `GET /health` | 200 + 状态字段 |
| 2 | `GET /v1/models` | 返回模型列表 |
| 3 | 无 Authorization | 401 + OpenAI 错误 |
| 4 | 错误占位 Key | 401 |
| 5 | body 非 JSON | 400 |
| 6 | 非流式 echo | OpenAI 格式全字段（object/choices/finish_reason/usage/model） |
| 7 | SSE 流式 | 首 chunk 含 role+content、末 chunk 含 finish_reason+usage、文本可重组、末尾 `[DONE]` |
| 8a | 多轮对话（system+3 turns） | 消息数组正确转换不丢失 |
| 8b | 特殊字符（换行/引号/中文/emoji/反斜杠） | 往返不损坏 |
| 8c | 空 messages 数组 | 不崩溃 |
| 8d | `stop: ["\n","END"]` | 转换为 `stop_sequences` 数组 |
| 8e | 5KB 长文本 | 大内容正常转发 |
| 8f | 缺省 model 字段 | 使用默认值 `MiniMax-M3` |
| 9a | `tools` + `tool_choice="auto"` | 上游收到 Anthropic 格式 tools、非流式响应中含 `tool_calls` |
| 9b | `tool_choice="required"` | 转换为 Anthropic `any`，模型必须调工具 |
| 9c | 多轮工具调用 | `assistant.tool_calls` + `tool` message 的 `tool_call_id` 保留 |
| 9d | 流式 tool_calls | SSE 首 chunk 含 `tool_calls[].id/name/""`，后续 chunk 填 `arguments` 增量，末 chunk `finish_reason=tool_calls` |
| 10 | 端口冲突（v1.1.1） | proxy 在 `EADDRINUSE` 时立即退码 1 + 输出中文错误 + `Stop-Process` 提示 |
| 9 | 客户端中途断连 | proxy 检测到并中止上游资源，不崩溃 |

---

## 六、故障排查

### 6.1 401 Invalid API key

- 代理会拒绝所有不在 `ALLOW_PLACEHOLDER_KEYS` 里的 Bearer Key。
- WorkBuddy 那边填的 Key 必须等于 `sk-workbuddy`（默认值）；要改的话启动时加 `--allow-keys 你的Key1,你的Key2`。

### 6.2 504 / 502 Upstream call failed

- **504 timeout**：上游 MiniMax 响应太慢或网络不通。可挂代理（系统代理）后重试，或调大 `--timeout`。
- **502 upstream_failure**：网络层失败，检查本地能否访问 `https://api.minimaxi.com`：

  ```bash
  curl -I https://api.minimaxi.com
  ```

### 6.3 透传的上游 401 / 403

- 真实的 `sk-cp-` Key 无效、过期或被限流。
- 重新登录 MiniMax 控制台复制 Key 试一下。
- 用 `LOG_LEVEL=debug` 重启代理可看到更详细的请求体：

  ```bash
  set LOG_LEVEL=debug
  node proxy.js
  ```

### 6.4 流式一直卡住不返回

- 极小概率是 Node 18 的 `Readable.fromWeb` 与某些上游 chunk 边界的兼容问题。
- 临时方案：把 WorkBuddy 里的「流式输出」关掉（非流式调用）。
- 永久方案：在 `proxy.js` 增大缓冲或换 Node 20+ 重试。

### 6.5 想换国际版 MiniMax

```bash
node proxy.js --upstream https://api.minimax.io/anthropic
```

并把你的国际版 `sk-cp-` Key 填进 `MINIMAX_API_KEY`。

### 6.6 端口被占（v1.1.1 新场景）

双击 `start.bat` 后窗口闪现「端口 18000 已被进程占用」就退出。原因：之前启动的代理进程没清理，或者另一个程序占了 18000。**不会一闪而过无提示了**——这是 v1.1.1 修复的。

解决方法：

```powershell
# 查看占用进程
Get-NetTCPConnection -LocalPort 18000 -State Listen

# 杀掉（PowerShell）
Get-Process node | Stop-Process -Force

# 或换个端口启动
node proxy.js --port 18001
```

或者使用 `start.bat` 启动器，它会自动预检查端口。

---

## 七、文件清单

```
openai-to-anthropic-proxy/
├── proxy.js             # 主程序（约 700 行，单文件，零外部依赖）
├── mock-anthropic.js    # 测试用模拟上游（~200 行）
├── test-integration.js  # 集成测试脚本（39 个断言）
├── package.json         # Node 工程描述
├── start.bat            # Windows 一键启动
└── README.md            # 本文档
```

**零外部依赖**：只用了 Node 18+ 内置的 `http`、`stream`、`fetch`、`URL`。

---

## 八、安全提醒

- 本代理默认监听 `127.0.0.1`（仅本机），不暴露到局域网，公网不可达，相对安全。
- 若需要在局域网共享给同事，把 `server.listen` 那行改成 `server.listen(CONFIG.port, '0.0.0.0', ...)`，并强烈建议同时打开防火墙规则。
- `MINIMAX_API_KEY` 仅保存在本机内存与 `start.bat` 文件中，不会上传到任何地方。
- 用完代理后关闭 `start.bat` 窗口即可，进程退出时 Key 即从内存消失。
- **不要把 `start.bat` 截图发到群里**，里面会显示明文 Key（虽已做了 `~0,12` 截断展示，但文件本身是完整 Key）。

---

## 十、双仓结构与发布流程

本仓库是**脱敏后的公开版本**（真源的发布副本）。开发在私有真源上进行，发布时导出脱敏副本合入本仓。

### 双仓定位

| 仓 | 定位 | Key 状态 |
|---|---|---|
| 私有真源仓（本地，不 push） | 日常开发 / 运行 / 测试 | 真实 Key 只放这里 |
| 公开脱敏仓（本仓库） | GitHub 发布、社区可见 | 只有占位符 `sk-cp-REPLACE_ME_WITH_YOUR_MINIMAX_KEY` |

### 发布流程（每次真源改动后）

```bash
# 1. 在真源改完代码并本地验证（npm test 63/63）
# 2. 导出脱敏副本（真源 → 本仓）
# 3. 逐项过脱敏清单（见下）
# 4. 合入本仓并 push
```

### 脱敏清单（逐项过，违反即拒）

- [ ] 无 `*.pem` / `id_ed25519*` / `*.key` / 真实 `.env`
- [ ] 无密码、token、API key 明文（`MINIMAX_API_KEY` 必须是 `sk-cp-REPLACE_ME...` 占位符）
- [ ] 无内网 IP / 内部域名 / 内部服务器绝对路径
- [ ] 无真实数据库连接串 / 账号
- [ ] 日志、临时文件、构建产物、截图已清除
- [ ] `start.bat.example` 只保留占位符（真源里的 `start.bat` 不导出）
- [ ] `DEPLOY-FOR-AGENT.md` 绝不进公开仓

### 铁律

1. 真实 MiniMax Key 只存在于私有真源仓，绝不 push 到任何公开/共享仓
2. 每次 push 公开仓前，先 grep 真实 Key 片段（`sk-cp-` 开头那串）确认零命中，再 push

---

## 九、能力状态与未来扩展

### ✅ 已实现

- `tools`（OpenAI 函数定义）↔ Anthropic `tools`
- `tool_choice`（`auto` / `none` / `required` / `{type, function}`）
- 多轮工具调用：`assistant` 的 `tool_calls` 块 + `tool` message 的 `tool_result` 块互转
- 流式 `tool_calls` 输出（`content_block_start` → `id`/`name`，`content_block_delta` → `arguments` 增量，`message_delta.stop_reason=tool_use` → `finish_reason=tool_calls`）

### ⏳ 未来扩展

| 能力 | 大致工作量 |
|---|---|
| 多模态图片输入 | +80 行：`image_url` ↔ Anthropic image content block |
| Thinking 块透传 | +30 行：识别 `thinking_delta` 并以 `<think>...</think>` 文本拼接 |
| 鉴权与限流（防滥用） | +60 行：rate-limit 中间件、IP 白名单 |

按需增量实现，避免一开始过度设计。
