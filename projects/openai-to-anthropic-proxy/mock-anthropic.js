#!/usr/bin/env node
/**
 * Mock Anthropic Server
 *
 * 模拟 api.minimaxi.com/anthropic 行为，用于端到端测试 proxy.js 的协议转换。
 *
 * 支持场景（通过 query 参数 ?scenario=xxx 或 header X-Test-Scenario 切换）：
 *   - nonstream   ：返回标准 Anthropic 非流式 JSON
 *   - stream      ：返回标准 Anthropic SSE 事件流（含 message_start / deltas / stop）
 *   - tool_nonstr ：返回带 tool_use content block 的非流式响应（验证 proxy tool_calls 转换）
 *   - tool_stream ：返回 SSE + tool_use content block（验证流式 tool_calls 转换）
 *   - error401    ：返回 401 + Anthropic 错误体
 *   - error500    ：返回 500 + 错误文本
 *
 * 注意：当请求 body 里包含 tools 字段时，会自动返回 tool_use 响应（无需显式指定场景）。
 * 手动指定 tool_* 场景可覆盖这个自动行为。
 *
 * 启动：node mock-anthropic.js --port 19000
 */

'use strict';

const http = require('http');

const PORT = parseInt((process.argv.find((_, i, a) => a[i - 1] === '--port') || '19000'), 10);

function sseEvent(eventName, data) {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  // 允许通过 query 或自定义 header 指定场景（以便从代理转发的场景也能控制）
  const scenario =
    url.searchParams.get('scenario') || (req.headers['x-test-scenario'] || '').trim() || 'nonstream';
  const upstreamHeaders = {
    'x-api-key': req.headers['x-api-key'] || '',
    'anthropic-version': req.headers['anthropic-version'] || '',
    'content-type': req.headers['content-type'] || '',
    accept: req.headers['accept'] || '',
  };
  console.log(`[mock] ${req.method} ${req.url} | scenario=${scenario} | upstream headers:`, upstreamHeaders);

  if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not found' } }));
  }

  const body = await readBody(req);

  // 校验上游 header
  if (!upstreamHeaders['x-api-key']) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: "missing 'X-Api-Key' header" },
      })
    );
  }
  if (upstreamHeaders['anthropic-version'] !== '2023-06-01') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'invalid anthropic-version' },
      })
    );
  }

  if (scenario === 'error401') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      })
    );
  }
  if (scenario === 'error500') {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('internal server error');
  }

  // 模拟一些延迟
  const delay = parseInt(url.searchParams.get('delay') || '0', 10);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  // 如果请求里携带了 tools 且场景不是显式错误场景，默认返回 tool_use 响应
  // 同时根据 body.stream 决定流式 / 非流式，避免 proxy 拿 JSON 当 stream 处理
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const wantsTool = scenario === 'tool_nonstr' || scenario === 'tool_stream';
  let effectiveScenario = scenario;
  if (wantsTool) {
    // 显式 tool_*：尊重 scenario，不再改
    effectiveScenario = scenario;
  } else if (scenario === 'stream' && hasTools) {
    effectiveScenario = 'tool_stream';
  } else if (scenario === 'nonstream' && hasTools && body.stream === true) {
    // 默认 nonstream，但 body.stream=true → 升级为流式 tool_use
    effectiveScenario = 'tool_stream';
  } else if (scenario === 'nonstream' && hasTools) {
    effectiveScenario = 'tool_nonstr';
  } else if (scenario === 'nonstream' && body.stream === true) {
    // 默认 nonstream，但 body.stream=true → 升级为流式文本
    effectiveScenario = 'stream';
  }
  // 额外日志便于排查
  console.log(`[mock] effective scenario=${effectiveScenario} (input scenario=${scenario}, hasTools=${hasTools}, body.stream=${body.stream})`);

  // 流式分支
  if (effectiveScenario === 'tool_stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const id = `msg_test_${Date.now()}`;
    const model = body.model || 'MiniMax-M3';
    // 取得第一个 tool 名
    const firstTool = (Array.isArray(body.tools) && body.tools[0]) || {};
    const toolName = (firstTool.name) || 'get_weather';
    const toolUseId = `toolu_test_${Math.random().toString(36).slice(2, 12)}`;
    // JSON 拆片发送，模拟 input_json_delta
    const toolInput = JSON.stringify({ city: 'Beijing', unit: 'celsius' });
    const inputChunks = [toolInput.slice(0, 5), toolInput.slice(5, 15), toolInput.slice(15)];

    res.write(
      sseEvent('message_start', {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      })
    );
    // tool_use content_block start
    res.write(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: toolUseId, name: toolName, input: {} },
      })
    );
    // input_json_delta 分片
    for (const chunk of inputChunks) {
      res.write(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: chunk },
        })
      );
    }
    res.write(
      sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 })
    );
    res.write(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 25 },
      })
    );
    res.write(sseEvent('message_stop', { type: 'message_stop' }));
    return res.end();
  }

  if (effectiveScenario === 'tool_nonstr') {
    const id = `msg_test_${Date.now()}`;
    const model = body.model || 'MiniMax-M3';
    const firstTool = (Array.isArray(body.tools) && body.tools[0]) || {};
    const toolName = (firstTool.name) || 'get_weather';
    const toolUseId = `toolu_test_${Math.random().toString(36).slice(2, 12)}`;
    const resp = {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [
        { type: 'tool_use', id: toolUseId, name: toolName, input: { city: 'Beijing', unit: 'celsius' } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(resp));
  }

  // 流式分支
  if (body.stream === true) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const id = `msg_test_${Date.now()}`;
    const model = body.model || 'MiniMax-M3';
    const userText =
      (body.messages && body.messages.find((m) => m.role === 'user') && body.messages.find((m) => m.role === 'user').content) ||
      'hi';

    // 拆词发送，模拟 Anthropic 真实行为
    const reply = `Echo: ${userText}`.split('');

    res.write(
      sseEvent('message_start', {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      })
    );
    res.write(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })
    );

    for (let i = 0; i < reply.length; i++) {
      // 字符级别 delta，模拟增量
      res.write(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: reply[i] },
        })
      );
      // 可选：每 N 字符延迟一段时间（用于测试客户端断连场景）
      const chunkDelay = parseInt(url.searchParams.get('chunk_delay') || '0', 10);
      if (chunkDelay > 0 && i % 5 === 0) {
        await new Promise((r) => setTimeout(r, chunkDelay));
      }
    }

    res.write(
      sseEvent('content_block_stop', {
        type: 'content_block_stop',
        index: 0,
      })
    );

    res.write(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: reply.length },
      })
    );

    res.write(sseEvent('message_stop', { type: 'message_stop' }));
    return res.end();
  }

  // 非流式分支
  const userText =
    (body.messages && body.messages.find((m) => m.role === 'user') && body.messages.find((m) => m.role === 'user').content) ||
    'hi';
  const id = `msg_test_${Date.now()}`;
  const resp = {
    id,
    type: 'message',
    role: 'assistant',
    model: body.model || 'MiniMax-M3',
    content: [{ type: 'text', text: `Echo: ${userText}` }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: userText.length + 6,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(resp));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] Anthropic mock listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock] scenarios: ?scenario=nonstream (default) | stream | error401 | error500`);
});
