#!/usr/bin/env node
/**
 * OpenAI ↔ Anthropic 协议转换代理
 *
 * 作用：让只支持 OpenAI 协议的客户端（WorkBuddy）通过本地代理
 *      调用 MiniMax 仅暴露 Anthropic 协议的 Coding Plan 接口（sk-cp-*）。
 *
 *   WorkBuddy  →  http://127.0.0.1:<port>/v1/chat/completions  (OpenAI)
 *                       │
 *                  [proxy.js]
 *                       │
 *                  https://api.minimaxi.com/anthropic/v1/messages (Anthropic)
 *
 * 依赖：Node.js >= 18（使用原生 fetch / ReadableStream）
 *
 * 启动：node proxy.js --port 18000
 *       或：MINIMAX_API_KEY=sk-cp-xxx node proxy.js
 */

'use strict';

const http = require('http');
const { Readable } = require('stream');

// ──────────────────────────────────────────────────────────────
// 1. 配置加载（CLI 参数 > 环境变量 > 默认值）
// ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const cli = parseArgs(process.argv.slice(2));

const CONFIG = {
  port: parseInt(cli.port || process.env.PORT || '18000', 10),
  apiKey: cli['api-key'] || process.env.MINIMAX_API_KEY || '',
  upstreamUrl: cli.upstream || process.env.UPSTREAM_URL || 'https://api.minimaxi.com/anthropic',
  defaultModel: cli.model || process.env.DEFAULT_MODEL || 'MiniMax-M3',
  logLevel: cli.log || process.env.LOG_LEVEL || 'info',
  placeholderKeys: (cli['allow-keys'] || process.env.ALLOW_PLACEHOLDER_KEYS || 'sk-workbuddy,placeholder')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  timeoutMs: parseInt(cli.timeout || process.env.TIMEOUT_MS || '300000', 10),
};

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level, ...args) {
  if (LOG_LEVELS[level] < (LOG_LEVELS[CONFIG.logLevel] || 20)) return;
  const ts = new Date().toISOString();
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`[${ts}] [${level.toUpperCase()}] ${args.join(' ')}\n`);
}

// ──────────────────────────────────────────────────────────────
// 2. 启动校验
// ──────────────────────────────────────────────────────────────

if (!CONFIG.apiKey) {
  log('error', '═══════════════════════════════════════════════════════════');
  log('error', '  缺少 MINIMAX_API_KEY');
  log('error', '  请通过以下任一方式设置后再启动：');
  log('error', '    1) 环境变量：  set MINIMAX_API_KEY=sk-cp-你的Key');
  log('error', '    2) CLI 参数：  node proxy.js --api-key sk-cp-你的Key');
  log('error', '    3) 直接编辑 start.bat 中的 MINIMAX_API_KEY');
  log('error', '═══════════════════════════════════════════════════════════');
  process.exit(1);
}

if (CONFIG.apiKey.startsWith('placeholder') || CONFIG.apiKey === 'sk-cp-你的Key') {
  log('error', '检测到占位符 API Key，请填入真实的 sk-cp-... 订阅 Key');
  process.exit(1);
}

// 校验 Key 必须是纯 ASCII（HTTP 头不允许非 ASCII 字符；混入中文会触发
// "Cannot convert argument to a ByteString because the character at index N has a value of ..."）。
const offending = [];
for (let i = 0; i < CONFIG.apiKey.length; i++) {
  const code = CONFIG.apiKey.charCodeAt(i);
  if (code > 127) {
    offending.push({ index: i, char: CONFIG.apiKey[i], code, hex: '0x' + code.toString(16).toUpperCase() });
  }
}
if (offending.length > 0) {
  log('error', '═══════════════════════════════════════════════════════════');
  log('error', '  MINIMAX_API_KEY 包含非 ASCII 字符，HTTP 请求头不允许！');
  log('error', `  Key 长度: ${CONFIG.apiKey.length}，非法字符数: ${offending.length}`);
  for (const o of offending.slice(0, 5)) {
    log('error', `    位置 ${o.index}: "${o.char}" (Unicode ${o.code} / ${o.hex})`);
  }
  if (offending.length > 5) log('error', `    ... 还有 ${offending.length - 5} 个`);
  log('error', '  常见原因：');
  log('error', '    1) 没替换干净 start.bat 里的占位文本（如 "请替换成你自己的Key"）');
  log('error', '    2) 从带中文提示的网页复制 Key 时粘进了多余字符');
  log('error', '    3) Key 末尾不小心带了空格或全角符号');
  log('error', '  请到 MiniMax 控制台重新复制完整 Key（应以 sk-cp- 开头），');
  log('error', '  确保粘贴后没有中文 / 全角字符 / 空格。');
  log('error', '═══════════════════════════════════════════════════════════');
  process.exit(1);
}

log('info', '═══════════════════════════════════════════════════════════');
log('info', `  协议转换代理已就绪`);
log('info', `  监听端口:      127.0.0.1:${CONFIG.port}`);
log('info', `  上游地址:      ${CONFIG.upstreamUrl}/v1/messages`);
log('info', `  默认模型:      ${CONFIG.defaultModel}`);
log('info', `  占位符 Key:    ${CONFIG.placeholderKeys.join(', ')}`);
log('info', `  日志级别:      ${CONFIG.logLevel}`);
log('info', '═══════════════════════════════════════════════════════════');

// ──────────────────────────────────────────────────────────────
// 3. 协议转换函数
// ──────────────────────────────────────────────────────────────

/**
 * OpenAI 请求 → Anthropic 请求
 * - system 消息合并到顶层 system 字段
 * - max_tokens 必填，缺省补 4096
 * - stop (string) → stop_sequences (string[])
 * - tools / tool_choice / tool message / assistant tool_calls 双向转换
 */
function convertRequest(openaiBody) {
  const src = openaiBody || {};
  const out = {
    model: src.model || CONFIG.defaultModel,
    messages: [],
    max_tokens: typeof src.max_tokens === 'number' ? src.max_tokens : 4096,
  };

  // 抽取 system，合并为单个字符串
  const systemParts = [];
  const msgs = Array.isArray(src.messages) ? src.messages : [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemParts.push(m.content);
      else if (Array.isArray(m.content)) {
        // 部分客户端会把 system 写成 content 数组形式
        for (const b of m.content) {
          if (b && b.type === 'text' && typeof b.text === 'string') systemParts.push(b.text);
        }
      }
      continue;
    }

    if (m.role === 'tool') {
      // OpenAI tool message → Anthropic tool_result block
      // OpenAI: {role: "tool", tool_call_id, content}
      // Anthropic: {role: "user", content: [{type: "tool_result", tool_use_id, content}]}
      const toolUseId = m.tool_call_id;
      let resultContent = m.content;
      if (Array.isArray(resultContent)) {
        // 合并为字符串（Anthropic tool_result content 是 string | array of blocks）
        const texts = [];
        for (const b of resultContent) {
          if (b && b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
        }
        resultContent = texts.join('\n');
      }
      out.messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: resultContent == null ? '' : String(resultContent),
        }],
      });
      continue;
    }

    if (m.role === 'assistant') {
      // assistant 消息可能携带 tool_calls（上一轮模型调用工具后）
      // OpenAI: {role: "assistant", content: null|string, tool_calls: [{id, type, function: {name, arguments}}]}
      // Anthropic: {role: "assistant", content: [{type: "text", text}, {type: "tool_use", id, name, input}]}
      const blocks = [];
      if (typeof m.content === 'string' && m.content.length > 0) {
        blocks.push({ type: 'text', text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b && b.type === 'text' && typeof b.text === 'string') blocks.push({ type: 'text', text: b.text });
        }
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (!tc || !tc.function) continue;
          let input = {};
          if (typeof tc.function.arguments === 'string' && tc.function.arguments.length > 0) {
            try {
              input = JSON.parse(tc.function.arguments);
            } catch (_) {
              // 参数不是合法 JSON，按字符串透传（不常见但防御一下）
              input = { _raw: tc.function.arguments };
            }
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id || `toolu_${Math.random().toString(36).slice(2, 18)}`,
            name: tc.function.name || '',
            input,
          });
        }
      }
      // 如果只有 tool_use 没有文本，Anthropic 也允许空 content 数组；这里保证至少有 []
      if (blocks.length > 0) {
        out.messages.push({ role: 'assistant', content: blocks });
      } else {
        out.messages.push({ role: 'assistant', content: '' });
      }
      continue;
    }

    if (m.role !== 'user' && m.role !== 'assistant') {
      // 其他未知 role，本版不支持，丢弃
      continue;
    }

    // user 消息：content 既可能是字符串也可能是数组（多模态）
    // 本版只透传字符串形式；数组形式降级为 JSON 字符串，避免协议层报错
    let content = m.content;
    if (Array.isArray(content)) {
      // 仅取 text 块拼接，图片块丢弃（本版不支持）
      const texts = [];
      for (const b of content) {
        if (b && b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      }
      content = texts.join('\n');
    }
    out.messages.push({ role: m.role, content: content ?? '' });
  }

  if (systemParts.length > 0) {
    out.system = systemParts.join('\n\n');
  }

  if (typeof src.temperature === 'number') out.temperature = src.temperature;
  if (typeof src.top_p === 'number') out.top_p = src.top_p;
  if (src.stream === true) out.stream = true;
  if (src.stop !== undefined) {
    out.stop_sequences = Array.isArray(src.stop) ? src.stop : [String(src.stop)];
  }

  // tools 转换
  // OpenAI: [{type: "function", function: {name, description, parameters}}]
  // Anthropic: [{name, description, input_schema}]
  if (Array.isArray(src.tools) && src.tools.length > 0) {
    const toolsOut = [];
    for (const t of src.tools) {
      if (!t) continue;
      if (t.type === 'function' && t.function) {
        const f = t.function;
        toolsOut.push({
          name: f.name,
          description: typeof f.description === 'string' ? f.description : undefined,
          input_schema: f.parameters || { type: 'object', properties: {} },
        });
      } else if (t.name) {
        // 已经是 Anthropic 形态，直接透传
        toolsOut.push({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : undefined,
          input_schema: t.input_schema || { type: 'object', properties: {} },
        });
      }
    }
    if (toolsOut.length > 0) out.tools = toolsOut;
  }

  // tool_choice 转换
  // OpenAI: "none" | "auto" | "required" | {type: "function", function: {name}}
  // Anthropic: {type: "auto"} | {type: "any"} | {type: "tool", name} | 省略
  if (src.tool_choice !== undefined && src.tool_choice !== null) {
    if (src.tool_choice === 'none') {
      // Anthropic 不需要单独传，丢掉即可（模型不会调用）
    } else if (src.tool_choice === 'auto') {
      out.tool_choice = { type: 'auto' };
    } else if (src.tool_choice === 'required') {
      out.tool_choice = { type: 'any' };
    } else if (typeof src.tool_choice === 'object' && src.tool_choice.type === 'function' && src.tool_choice.function && src.tool_choice.function.name) {
      out.tool_choice = { type: 'tool', name: src.tool_choice.function.name };
    } else if (typeof src.tool_choice === 'string') {
      // 未知字符串，降级为 auto
      out.tool_choice = { type: 'auto' };
    }
  }

  return out;
}

/** Anthropic stop_reason → OpenAI finish_reason */
function mapStopReason(reason) {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return reason || 'stop';
  }
}

/**
 * Anthropic 非流式响应 → OpenAI 非流式响应
 * - content 块里：text → message.content，tool_use → message.tool_calls
 * - stop_reason 映射（含 tool_use → tool_calls）
 */
function convertResponse(anthropicResp, requestedModel) {
  const blocks = Array.isArray(anthropicResp.content) ? anthropicResp.content : [];

  // 文本拼接
  const textParts = [];
  // 工具调用
  const toolCalls = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') {
      textParts.push(b.text);
    } else if (b.type === 'tool_use') {
      // tool_use.id 一般形如 toolu_xxx，OpenAI 习惯上叫 call_xxx。
      // 这里保留原始 id 以确保 client 能反查（多轮时 tool_call_id 必须一致）。
      toolCalls.push({
        id: b.id || `call_${Math.random().toString(36).slice(2, 18)}`,
        type: 'function',
        function: {
          name: b.name || '',
          // OpenAI 协议要求 arguments 是 JSON 字符串
          arguments: JSON.stringify(b.input == null ? {} : b.input),
        },
      });
    }
    // 其他块类型（thinking / image 等）本版不处理
  }
  const text = textParts.join('\n');

  const usage = anthropicResp.usage || {};
  const promptTokens = usage.input_tokens || 0;
  const completionTokens = usage.output_tokens || 0;

  const message = { role: 'assistant', content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  // 如果有 tool_calls，OpenAI 规范允许 content 为 null（但有些客户端仍期望字符串）
  if (message.content === null && toolCalls.length > 0) message.content = '';

  return {
    id: anthropicResp.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel || anthropicResp.model || CONFIG.defaultModel,
    choices: [
      {
        index: 0,
        message: message,
        finish_reason: mapStopReason(anthropicResp.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// 4. SSE 解析与转发（核心）
// ──────────────────────────────────────────────────────────────

/**
 * 把 Web ReadableStream 转成 Node Readable。
 * 调用方负责监听 'data' 事件。
 */
function webStreamToNode(webStream) {
  return Readable.fromWeb(webStream);
}

/**
 * 构造一个 OpenAI 格式的 chunk（流式）
 */
function makeOaiChunk(responseId, model, delta, finishReason, usage) {
  const chunk = {
    id: responseId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [
      {
        index: 0,
        delta: delta,
        finish_reason: finishReason || null,
      },
    ],
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

/**
 * SSE 转换器：读取 Anthropic SSE，逐事件转换为 OpenAI SSE 并写入 clientRes。
 * upstreamNodeStream: Readable（来自 Readable.fromWeb）
 * clientRes: http.ServerResponse
 * meta: { requestId, model }
 * returns: 当上游流结束时 resolve
 */
function pumpAnthropicSseToOpenAI(upstreamNodeStream, clientRes, meta) {
  return new Promise((resolve, reject) => {
    let responseId = `chatcmpl-${Date.now()}`;
    const model = meta.model || CONFIG.defaultModel;
    let buffer = '';
    let roleSent = false;
    let finished = false;

    // 按 Anthropic content_block.index 记录其类型（text / tool_use）
    // 同一个 response 里可能有多个块同时存在，需要按 index 分别追踪。
    const blockTypes = new Map();

    function sendOaiChunk(delta, finishReason, usage) {
      if (finished) return;
      if (!clientRes.writable || clientRes.writableEnded) {
        // 客户端已断开，丢弃该 chunk
        return;
      }
      try {
        // 首次带 role 字段（OpenAI 客户端通常期望首个 chunk 含 role）
        const d = roleSent ? delta : { role: 'assistant', ...delta };
        const chunk = makeOaiChunk(responseId, model, d, finishReason, usage);
        clientRes.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (!roleSent && delta && (delta.role || delta.content !== undefined || delta.tool_calls)) roleSent = true;
      } catch (e) {
        // EPIPE 等错误，标记结束
        finished = true;
        log('warn', `[${meta.requestId}] 写客户端失败:`, e.message);
      }
    }

    function sendDone() {
      if (finished) return;
      finished = true;
      try {
        clientRes.write('data: [DONE]\n\n');
        clientRes.end();
      } catch (_) {
        // 客户端可能已断
      }
    }

    function sendError(errMsg, errType = 'upstream_error') {
      if (finished) return;
      finished = true;
      const payload = { error: { message: errMsg, type: errType } };
      // 仍以 SSE 形态输出（OpenAI 流式错误格式）
      try {
        clientRes.write(`data: ${JSON.stringify(payload)}\n\n`);
        clientRes.write('data: [DONE]\n\n');
        clientRes.end();
      } catch (_) {}
    }

    upstreamNodeStream.on('data', (buf) => {
      try {
        buffer += buf.toString('utf8');
        // SSE 事件以 \n\n 分隔
        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          handleSseEvent(rawEvent);
        }
      } catch (e) {
        log('error', `[${meta.requestId}] SSE 解析异常:`, e.message);
        sendError(`SSE parse error: ${e.message}`, 'stream_parse_error');
        upstreamNodeStream.destroy();
      }
    });

    upstreamNodeStream.on('end', () => {
      // 处理残留 buffer
      if (buffer.trim()) handleSseEvent(buffer);
      sendDone();
      resolve();
    });

    upstreamNodeStream.on('error', (err) => {
      log('error', `[${meta.requestId}] 上游流错误:`, err.message);
      sendError(`Upstream stream error: ${err.message}`, 'upstream_failure');
      resolve();
    });

    function handleSseEvent(rawEvent) {
      // 解析单条 SSE 事件
      const lines = rawEvent.split(/\r?\n/);
      let eventName = '';
      let dataLines = [];
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) return;
      const dataStr = dataLines.join('\n');
      if (!dataStr || dataStr === '[DONE]') return;

      let payload;
      try {
        payload = JSON.parse(dataStr);
      } catch (e) {
        log('warn', `[${meta.requestId}] 无法解析 SSE data JSON:`, dataStr.slice(0, 200));
        return;
      }

      const type = payload.type || eventName;
      switch (type) {
        case 'message_start': {
          if (payload.message && payload.message.id) {
            responseId = payload.message.id;
          }
          // 可选：把 usage.input_tokens 透传，但 OpenAI 流式首个 chunk 不带 usage，跳过
          break;
        }
        case 'content_block_start': {
          // 记录该块类型，供后续 content_block_delta 区分处理
          const idx = payload.index;
          const cb = payload.content_block || {};
          if (cb.type === 'tool_use') {
            blockTypes.set(idx, 'tool_use');
            // 发一个 chunk 携带 tool_call 的 id + name + 空 arguments
            // OpenAI 流式 tool_calls 的标准模式：
            //   chunk1: tool_calls: [{index, id, type: "function", function: {name, arguments: ""}}]
            //   chunk2+: tool_calls: [{index, function: {arguments: "partial..."}}]
            sendOaiChunk({
              tool_calls: [{
                index: idx,
                id: cb.id || `call_${Math.random().toString(36).slice(2, 18)}`,
                type: 'function',
                function: {
                  name: cb.name || '',
                  arguments: '',
                },
              }],
            });
          } else {
            // text 块首：发送 role + 空 content（OpenAI 首个 chunk 期望）
            // 后续 text_delta 会补上 content
            blockTypes.set(idx, 'text');
          }
          break;
        }
        case 'content_block_delta': {
          const delta = payload.delta || {};
          const idx = payload.index;
          const blockType = blockTypes.get(idx);
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            sendOaiChunk({ content: delta.text });
          } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            // 工具调用参数增量。OpenAI 流式下，arguments 只发 partial_json 部分。
            sendOaiChunk({
              tool_calls: [{
                index: idx,
                function: {
                  arguments: delta.partial_json,
                },
              }],
            });
          } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            // 本版不专门处理 thinking，将推理内容当文本追加到 content
            if (blockType !== 'tool_use') {
              sendOaiChunk({ content: delta.thinking });
            }
          }
          break;
        }
        case 'content_block_stop': {
          const idx = payload.index;
          blockTypes.delete(idx);
          // 块结束；本版不主动发额外 chunk
          break;
        }
        case 'message_delta': {
          const stopReason = payload.delta && payload.delta.stop_reason;
          if (stopReason) {
            const fr = mapStopReason(stopReason);
            const usage = payload.usage
              ? {
                  prompt_tokens: payload.usage.input_tokens || 0,
                  completion_tokens: payload.usage.output_tokens || 0,
                  total_tokens:
                    (payload.usage.input_tokens || 0) + (payload.usage.output_tokens || 0),
                }
              : undefined;
            sendOaiChunk({}, fr, usage);
          }
          break;
        }
        case 'message_stop': {
          sendDone();
          break;
        }
        case 'error':
        case 'ping': {
          // ping 忽略；error 已在下方分支处理
          if (type === 'error') {
            const msg = (payload.error && payload.error.message) || 'Upstream error';
            log('error', `[${meta.requestId}] 上游 SSE error 事件:`, msg);
            sendError(msg, (payload.error && payload.error.type) || 'upstream_error');
          }
          break;
        }
        default: {
          // 未知事件类型，记录后忽略
          if (CONFIG.logLevel === 'debug') {
            log('debug', `[${meta.requestId}] 未处理 SSE 事件:`, type);
          }
        }
      }
    }
  });
}

// ──────────────────────────────────────────────────────────────
// 5. 上游调用
// ──────────────────────────────────────────────────────────────

async function callUpstream(anthropicBody, requestId) {
  const url = `${CONFIG.upstreamUrl.replace(/\/+$/, '')}/v1/messages`;
  log('debug', `[${requestId}] → ${url}`, JSON.stringify(anthropicBody));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Anthropic 标准鉴权头：x-api-key（MiniMax 兼容端点也要求这个）
        'x-api-key': CONFIG.apiKey,
        'anthropic-version': '2023-06-01',
        Accept: anthropicBody.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(anthropicBody),
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────
// 6. 路由处理
// ──────────────────────────────────────────────────────────────

function sendJsonError(res, status, message, type = 'invalid_request_error') {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { message, type, code: status } }));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function checkAuth(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: 'missing Authorization header' };
  const key = m[1].trim();
  if (!CONFIG.placeholderKeys.includes(key)) {
    return { ok: false, reason: `API key "${key.slice(0, 12)}..." not in allowlist` };
  }
  return { ok: true };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const limit = 10 * 1024 * 1024; // 10MB
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('Request body too large (>10MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

async function handleChatCompletions(req, res, requestId) {
  const t0 = Date.now();
  // 鉴权
  const auth = checkAuth(req);
  if (!auth.ok) {
    log('warn', `[${requestId}] 鉴权失败: ${auth.reason}`);
    return sendJsonError(res, 401, `Invalid API key: ${auth.reason}`, 'invalid_request_error');
  }

  // 读 body
  let openaiBody;
  try {
    openaiBody = await readBody(req);
  } catch (e) {
    return sendJsonError(res, 400, e.message, 'invalid_request_error');
  }

  const requestedModel = openaiBody.model || CONFIG.defaultModel;
  const wantStream = openaiBody.stream === true;
  let anthropicBody;
  try {
    anthropicBody = convertRequest(openaiBody);
  } catch (e) {
    return sendJsonError(res, 400, `convertRequest failed: ${e.message}`, 'invalid_request_error');
  }

  log('info', `[${requestId}] → upstream model=${anthropicBody.model} stream=${wantStream}`);

  // 上游调用
  let upstreamResp;
  try {
    upstreamResp = await callUpstream(anthropicBody, requestId);
  } catch (e) {
    log('error', `[${requestId}] 调用上游失败:`, e.message);
    const status = e.name === 'AbortError' ? 504 : 502;
    return sendJsonError(
      res,
      status,
      `Upstream call failed: ${e.message}`,
      e.name === 'AbortError' ? 'timeout' : 'upstream_failure'
    );
  }

  // 上游错误
  if (!upstreamResp.ok) {
    const txt = await upstreamResp.text().catch(() => '');
    log('error', `[${requestId}] ← upstream ${upstreamResp.status}: ${txt.slice(0, 500)}`);
    // 透传 status；body 转 OpenAI error 格式
    let msg = txt;
    let type = 'upstream_error';
    try {
      const j = JSON.parse(txt);
      msg = (j.error && j.error.message) || j.message || txt;
      type = (j.error && j.error.type) || type;
    } catch (_) {}
    res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: { message: msg, type, code: upstreamResp.status } }));
  }

  // 流式分支
  if (wantStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 立即 flush 头
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let nodeStream;
    try {
      nodeStream = webStreamToNode(upstreamResp.body);
    } catch (e) {
      return sendErrorInStream(res, `Cannot read upstream stream: ${e.message}`);
    }

    // 跟踪是否正常结束（与中途断连区分）
    let aborted = false;
    let finishedNormally = false;
    const onClientGone = () => {
      if (finishedNormally || aborted) return;
      aborted = true;
      log('warn', `[${requestId}] 客户端中途断连，销毁上游流`);
      try {
        nodeStream.destroy(new Error('client disconnected'));
      } catch (_) {}
    };
    req.on('close', onClientGone);
    if (typeof req.on === 'function') {
      req.on('aborted', onClientGone);
    }

    try {
      await pumpAnthropicSseToOpenAI(nodeStream, res, { requestId, model: requestedModel });
      finishedNormally = true;
    } catch (e) {
      log('error', `[${requestId}] 流式转发异常:`, e.message);
    }
    const dt = Date.now() - t0;
    log('info', `[${requestId}] ← 200 stream | ${dt}ms | aborted=${aborted}`);
    return;
  }

  // 非流式分支
  try {
    const anthropicResp = await upstreamResp.json();
    const oaiResp = convertResponse(anthropicResp, requestedModel);
    const dt = Date.now() - t0;
    log(
      'info',
      `[${requestId}] ← 200 | ${dt}ms | in=${oaiResp.usage.prompt_tokens}tok out=${oaiResp.usage.completion_tokens}tok`
    );
    if (CONFIG.logLevel === 'debug') {
      log('debug', `[${requestId}] ← OpenAI resp:`, JSON.stringify(oaiResp).slice(0, 500));
    }
    sendJson(res, 200, oaiResp);
  } catch (e) {
    log('error', `[${requestId}] 非流式响应解析失败:`, e.message);
    sendJsonError(res, 502, `Bad upstream response: ${e.message}`, 'upstream_failure');
  }
}

function sendErrorInStream(res, msg) {
  if (res.writableEnded) return;
  res.write(
    `data: ${JSON.stringify({ error: { message: msg, type: 'upstream_failure' } })}\n\n`
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function handleModels(req, res) {
  const list = ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'];
  sendJson(res, 200, {
    object: 'list',
    data: list.map((id) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'MiniMax',
    })),
  });
}

function handleHealth(req, res) {
  sendJson(res, 200, {
    status: 'ok',
    upstream: CONFIG.upstreamUrl,
    placeholder_keys: CONFIG.placeholderKeys,
    pid: process.pid,
    uptime_sec: Math.floor(process.uptime()),
  });
}

// ──────────────────────────────────────────────────────────────
// 7. HTTP Server
// ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const url = new URL(req.url, `http://127.0.0.1:${CONFIG.port}`);

  try {
    // POST /v1/chat/completions
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      return await handleChatCompletions(req, res, requestId);
    }
    // GET /v1/models
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return handleModels(req, res);
    }
    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      return handleHealth(req, res);
    }
    // 兜底
    log('warn', `[${requestId}] ${req.method} ${url.pathname} → 404`);
    return sendJsonError(res, 404, `Not found: ${req.method} ${url.pathname}`, 'invalid_request_error');
  } catch (e) {
    log('error', `[${requestId}] 未捕获异常:`, e.stack || e.message);
    if (!res.headersSent) {
      sendJsonError(res, 500, `Internal proxy error: ${e.message}`, 'proxy_error');
    } else {
      sendErrorInStream(res, e.message);
    }
  }
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  // 已在上方打印启动信息
});

// 监听失败（端口被占 / 权限不足）—— 这是同步 throw 不会触发 uncaughtException
server.on('error', (err) => {
  log('error', '═════════════════════════════════════════════════════════�?');
  log('error', '  代理启动失败');
  log('error', '═════════════════════════════════════════════════════════�?');
  if (err && err.code === 'EADDRINUSE') {
    exitReason = 'EADDRINUSE 启动期';
    log('error', `  端口 ${CONFIG.port} 已被占用（可能是之前的代理进程没干净退出）。`);
    log('error', '  解决方法（PowerShell）：');
    log('error', `    Get-Process node | Stop-Process -Force`);
    log('error', `  或换个端口启动：`);
    log('error', `    node proxy.js --port 18001`);
  } else if (err && err.code === 'EACCES') {
    exitReason = 'EACCES 启动期';
    log('error', `  端口 ${CONFIG.port} 无权限绑定（需要管理员或换 ≥1024 端口）。`);
  } else {
    exitReason = `启动期错误: ${err && err.code}`;
    log('error', '  错误：', err && (err.stack || err.message));
  }
  log('error', '═════════════════════════════════════════════════════════�?');
  process.exit(1);
});

// ─── 信号追踪：任何进程退出都留痕 ───
let exitReason = 'normal';

process.on('SIGINT', () => {
  exitReason = 'SIGINT (Ctrl+C 或作业控制中断)';
  log('info', `收到 SIGINT (${exitReason})，正在关闭代理...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});

process.on('SIGTERM', () => {
  exitReason = 'SIGTERM (taskkill / 外部终止信号)';
  log('info', `收到 SIGTERM (${exitReason})，正在关闭代理...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});

process.on('SIGHUP', () => {
  // Windows 上很少发 SIGHUP；Linux/macOS 上是终端断开
  log('warn', '收到 SIGHUP（终端挂起）。继续运行。如需要退出请用 Ctrl+C。');
});

// 退出的最后一秒记录原因（同步写，防止被后续 async 事件打断）
process.on('exit', (code) => {
  // 注意：这里只能用同步 IO；不要调 async 函数
  try {
    process.stderr.write(`\n[proxy] === EXIT code=${code} reason=${exitReason} ===\n`);
  } catch (_) { /* ignore */ }
});

process.on('beforeExit', (code) => {
  // beforeExit 在事件循环为空时触发，如果带 code 则说明自然退出
  if (exitReason === 'normal') {
    exitReason = `beforeExit code=${code}`;
  }
});

process.on('uncaughtException', (e) => {
  exitReason = `uncaughtException: ${e && e.message}`;
  log('error', 'uncaughtException:', e.stack || e.message);
  // 启动阶段的未捕获异常多为配置/环境问题，留 1 秒让日志冲出 stdout 后退出 1
  // （启动后运行期的异常仅记日志，避免误杀正在服务的进程）
  if (!server.listening) {
    setTimeout(() => process.exit(1), 200);
  }
});
process.on('unhandledRejection', (e) => {
  log('error', 'unhandledRejection:', e && (e.stack || e.message));
  // 仍然不主动退出，仅记录
  if (exitReason === 'normal') {
    exitReason = `unhandledRejection: ${e && e.message}`;
  }
});
