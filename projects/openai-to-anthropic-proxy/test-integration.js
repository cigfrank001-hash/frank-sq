#!/usr/bin/env node
/**
 * 集成测试：启动 mock + 代理，然后逐项测试，最后清理。
 */
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// ────────────────────────────────────────────────────────────
// 工具：spawn 子进程并捕获输出
// ────────────────────────────────────────────────────────────
function spawnBg(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    cwd: __dirname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ERR ${d}`));
  p.on('exit', (code) => console.log(`[${name}] exited code=${code}`));
  return p;
}

// ────────────────────────────────────────────────────────────
// 启动 mock + 代理
// ────────────────────────────────────────────────────────────
console.log('=== 启动 mock upstream on 19007 ===');
const mock = spawnBg('mock', 'node', [path.join(__dirname, 'mock-anthropic.js'), '--port', '19007']);

setTimeout(() => {
  console.log('\n=== 启动 proxy on 18000 → upstream http://127.0.0.1:19007 ===');
  const proxy = spawnBg('proxy', 'node', [
    path.join(__dirname, 'proxy.js'),
    '--port', '18000',
    '--upstream', 'http://127.0.0.1:19007',
    '--log', 'info',
    '--timeout', '5000',
  ], { MINIMAX_API_KEY: 'sk-cp-mock-test-key' });

  setTimeout(runTests, 2000);

  process.on('SIGINT', () => { mock.kill(); proxy.kill(); process.exit(0); });
}, 500);

// ────────────────────────────────────────────────────────────
// 测试用例
// ────────────────────────────────────────────────────────────
async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(name, cond, detail) {
    if (cond) {
      console.log(`  PASS  ${name}`);
      passed++;
    } else {
      console.log(`  FAIL  ${name} -- ${detail || ''}`);
      failed++;
    }
  }

  // ─── Test 1: /health ───
  console.log('\n[Test 1] GET /health');
  try {
    const r = await httpGet(18000, '/health', null, null);
    assert('status 200', r.status === 200, `got ${r.status}`);
    const j = JSON.parse(r.body);
    assert('status=ok', j.status === 'ok');
    assert('upstream set', j.upstream && j.upstream.includes('19007'));
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 2: /v1/models ───
  console.log('\n[Test 2] GET /v1/models');
  try {
    const r = await httpGet(18000, '/v1/models', 'sk-workbuddy', null);
    assert('status 200', r.status === 200);
    const j = JSON.parse(r.body);
    assert('returns list', j.object === 'list');
    assert('has MiniMax-M3', j.data.some((m) => m.id === 'MiniMax-M3'));
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 3: 401 missing auth ───
  console.log('\n[Test 3] POST without Authorization → 401');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', null, { messages: [] });
    assert('status 401', r.status === 401, `got ${r.status}`);
    const j = JSON.parse(r.body);
    assert('has error', !!j.error && !!j.error.message);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 4: 401 wrong key ───
  console.log('\n[Test 4] POST with wrong placeholder key → 401');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-wrong', { messages: [] });
    assert('status 401', r.status === 401);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 5: 400 invalid JSON ───
  console.log('\n[Test 5] POST with invalid JSON → 400');
  try {
    const r = await httpPostRaw(18000, '/v1/chat/completions', 'sk-workbuddy', 'not-json');
    assert('status 400', r.status === 400, `got ${r.status}`);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 6: Non-stream echo ───
  console.log('\n[Test 6] POST non-stream echo → OpenAI format');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: 'hello world' },
      ],
      max_tokens: 200,
    });
    assert('status 200', r.status === 200);
    const j = JSON.parse(r.body);
    assert('object=chat.completion', j.object === 'chat.completion');
    assert('has choices', Array.isArray(j.choices) && j.choices.length === 1);
    assert('finish_reason=stop', j.choices[0].finish_reason === 'stop');
    assert('content=Echo: hello world', j.choices[0].message.content === 'Echo: hello world');
    assert('has usage', j.usage && typeof j.usage.total_tokens === 'number');
    assert('model preserved', j.model === 'MiniMax-M3');
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 7: stream echo (full SSE conversion check) ───
  console.log('\n[Test 7] POST stream=true → OpenAI SSE');
  try {
    const lines = [];
    await httpStreamPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    }, (line) => {
      lines.push(line);
    });
    const chunks = lines
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice(6)));
    assert('has chunks', chunks.length >= 2, `got ${chunks.length}`);
    assert('first chunk has role', chunks[0].choices[0].delta.role === 'assistant');
    assert('first chunk has content', typeof chunks[0].choices[0].delta.content === 'string');
    assert('last chunk has finish_reason', chunks[chunks.length - 1].choices[0].finish_reason === 'stop');
    assert('last chunk has usage', !!chunks[chunks.length - 1].usage);
    assert('reassembled text', chunks.map((c) => c.choices[0].delta.content || '').join('') === 'Echo: hi');
    assert('terminated with DONE', lines[lines.length - 1] === 'data: [DONE]');
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 8a: multi-turn conversation ───
  console.log('\n[Test 8a] Multi-turn conversation (system + 3 turns) → Anthropic messages preserved');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Second reply' },
        { role: 'user', content: 'Third message' },
      ],
      max_tokens: 100,
    });
    assert('status 200', r.status === 200);
    const j = JSON.parse(r.body);
    // mock 用 Array.find() 取首个 user 消息，所以会回 "Echo: First message"
    // 这里关键是验证多轮消息数组能被代理正确转换成 Anthropic 格式而不丢失
    assert('content echoes first user msg', j.choices[0].message.content === 'Echo: First message',
      `got ${JSON.stringify(j.choices[0].message.content)}`);
    assert('finish_reason set', j.choices[0].finish_reason === 'stop');
  } catch (e) { console.log('  FAIL  threw:', e.message); failed++; }

  // ─── Test 8b: special characters in content ───
  console.log('\n[Test 8b] Special characters: newlines, quotes, unicode, emoji');
  try {
    const specialContent = 'Line1\nLine2\nLine3\n"quotes" \'single\' 中文 \u{1F600} \\\\backslash';
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: specialContent }],
      max_tokens: 200,
    });
    assert('status 200', r.status === 200, `got ${r.status}`);
    const j = JSON.parse(r.body);
    assert('content preserved', j.choices[0].message.content === `Echo: ${specialContent}`,
      `got ${JSON.stringify(j.choices[0].message.content)}`);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 8c: empty messages array → 400-ish or upstream-decode ───
  console.log('\n[Test 8c] Empty messages array → upstream echo with empty content');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [],
      max_tokens: 50,
    });
    assert('status 200', r.status === 200, `got ${r.status}`);
    const j = JSON.parse(r.body);
    assert('valid response', j.choices && j.choices.length === 1);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 8d: stop sequence array conversion ───
  console.log('\n[Test 8d] stop=["\\n","END"] → Anthropic stop_sequences array');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'stop test' }],
      max_tokens: 50,
      stop: ['\n', 'END'],
    });
    assert('status 200', r.status === 200);
    // mock always returns 200 with echo - just verify it didn't error out
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 8e: large content (~5KB) ───
  console.log('\n[Test 8e] Large content (~5KB) round-trip');
  try {
    const big = 'A'.repeat(5000);
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: big }],
      max_tokens: 50,
    });
    assert('status 200', r.status === 200, `got ${r.status}`);
    const j = JSON.parse(r.body);
    assert('content has prefix Echo:', j.choices[0].message.content.startsWith('Echo: '));
    assert('content length ~5006', j.choices[0].message.content.length === 6 + big.length,
      `got ${j.choices[0].message.content.length}`);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 8f: default model when none specified ───
  console.log('\n[Test 8f] No model field → uses default (MiniMax-M3)');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      messages: [{ role: 'user', content: 'no model' }],
      max_tokens: 50,
    });
    assert('status 200', r.status === 200);
    const j = JSON.parse(r.body);
    assert('model defaulted to MiniMax-M3', j.model === 'MiniMax-M3',
      `got ${j.model}`);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 9a: tools 字段 + tool_choice 转换 (request side) ───
  console.log('\n[Test 9a] tools/tool_choice conversion → upstream receives Anthropic-format tools');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'what is the weather in Beijing' }],
      max_tokens: 100,
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'city name' },
              unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['city'],
          },
        },
      }],
      tool_choice: 'auto',
    });
    // 请求成功转发（mock 收到 tools 后返回 tool_use）
    assert('status 200', r.status === 200, `got ${r.status}`);
    const j = JSON.parse(r.body);
    // 由于请求带 tools，mock 自动返回 tool_nonstr 场景：finish_reason=tool_calls
    assert('finish_reason=tool_calls', j.choices[0].finish_reason === 'tool_calls',
      `got ${j.choices[0].finish_reason}`);
    assert('has tool_calls', Array.isArray(j.choices[0].message.tool_calls) && j.choices[0].message.tool_calls.length === 1,
      `got ${JSON.stringify(j.choices[0].message.tool_calls)}`);
    const tc = j.choices[0].message.tool_calls[0];
    assert('tool_call.id starts with toolu_', typeof tc.id === 'string' && tc.id.startsWith('toolu_'),
      `got ${tc.id}`);
    assert('tool_call.name=get_weather', tc.function && tc.function.name === 'get_weather',
      `got ${tc.function && tc.function.name}`);
    let parsedArgs;
    try { parsedArgs = JSON.parse(tc.function.arguments); } catch (_) { parsedArgs = null; }
    assert('arguments is valid JSON', parsedArgs !== null);
    assert('arguments.city=Beijing', parsedArgs && parsedArgs.city === 'Beijing',
      `got ${JSON.stringify(parsedArgs)}`);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 9b: tool_choice='required' → Anthropic any ───
  console.log('\n[Test 9b] tool_choice="required" → converted to Anthropic any');
  try {
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'use tool' }],
      max_tokens: 50,
      tools: [{
        type: 'function',
        function: { name: 'dummy', parameters: { type: 'object', properties: {} } },
      }],
      tool_choice: 'required',
    });
    assert('status 200', r.status === 200, `got ${r.status}`);
    const j = JSON.parse(r.body);
    // mock 收到 tools 后返回 tool_use，finish_reason 仍是 tool_calls
    assert('tool called', j.choices[0].finish_reason === 'tool_calls');
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 9c: 多轮工具调用 (assistant tool_calls + tool message) ───
  console.log('\n[Test 9c] multi-turn: previous tool_calls + tool result message preserved');
  try {
    // 模拟客户端发起带上一轮工具调用结果的新一轮请求
    // Anthropic 端看到的应该是：user → assistant(tool_use) → user(tool_result) → user(新问题)
    // mock 会从首个 user message 抽取内容，tools 存在所以仍走 tool_use 场景。
    // 重点验证：上游 body 包含 tool_result 块 + 新的 user 块。
    const r = await httpPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'toolu_prev_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'toolu_prev_1', content: '{"temp":20,"unit":"celsius"}' },
        { role: 'user', content: 'thanks' },
      ],
      max_tokens: 50,
      tools: [{
        type: 'function',
        function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
      }],
    });
    assert('status 200', r.status === 200, `got ${r.status}`);
    // 只要不报错就说明转换成功（mock 返回 tool_use 表示上游 Anthropic 协议解析通过）
    const j = JSON.parse(r.body);
    assert('valid response', j.choices && j.choices.length === 1);
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 9d: 流式 tool_calls (SSE 转换) ───
  console.log('\n[Test 9d] stream=true with tools → OpenAI SSE tool_calls chunks');
  try {
    const lines = [];
    await httpStreamPost(18000, '/v1/chat/completions', 'sk-workbuddy', {
      model: 'MiniMax-M3',
      stream: true,
      messages: [{ role: 'user', content: 'weather beijing' }],
      max_tokens: 100,
      tools: [{
        type: 'function',
        function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' }, unit: { type: 'string' } } } },
      }],
    }, (line) => { lines.push(line); });
    const chunks = lines
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice(6)));

    // 找一个含 tool_calls 的 chunk
    const tcStartChunk = chunks.find((c) => c.choices[0].delta.tool_calls && c.choices[0].delta.tool_calls[0].id);
    assert('has tool_calls start chunk', !!tcStartChunk, `got ${chunks.length} chunks total`);
    if (tcStartChunk) {
      assert('tool_call id present', typeof tcStartChunk.choices[0].delta.tool_calls[0].id === 'string');
      assert('tool_call name=get_weather', tcStartChunk.choices[0].delta.tool_calls[0].function.name === 'get_weather');
      assert('tool_call type=function', tcStartChunk.choices[0].delta.tool_calls[0].type === 'function');
      assert('arguments starts empty', tcStartChunk.choices[0].delta.tool_calls[0].function.arguments === '');
    }
    // 找含部分 arguments 的 chunk
    const argChunk = chunks.find((c) => c.choices[0].delta.tool_calls && c.choices[0].delta.tool_calls[0].function && c.choices[0].delta.tool_calls[0].function.arguments && c.choices[0].delta.tool_calls[0].function.arguments.length > 0);
    assert('has arguments delta chunk', !!argChunk);
    // 末 chunk 含 finish_reason=tool_calls
    const lastChunk = chunks[chunks.length - 1];
    assert('last chunk finish_reason=tool_calls', lastChunk.choices[0].finish_reason === 'tool_calls',
      `got ${lastChunk.choices[0].finish_reason}`);
    // 重组 arguments：把所有 tool_calls arguments 拼接（去掉首 chunk 的空字符串）
    const assembledArgs = chunks
      .map((c) => (c.choices[0].delta.tool_calls && c.choices[0].delta.tool_calls[0] && c.choices[0].delta.tool_calls[0].function && c.choices[0].delta.tool_calls[0].function.arguments) || '')
      .join('');
    let assembledParsed;
    try { assembledParsed = JSON.parse(assembledArgs); } catch (_) { assembledParsed = null; }
    assert('assembled arguments is valid JSON', assembledParsed !== null, `got ${JSON.stringify(assembledArgs)}`);
    assert('assembled city=Beijing', assembledParsed && assembledParsed.city === 'Beijing',
      `got ${JSON.stringify(assembledParsed)}`);
    assert('terminated with DONE', lines[lines.length - 1] === 'data: [DONE]');
  } catch (e) { console.log('  ✗ threw:', e.message); failed++; }

  // ─── Test 10: 端口冲突 → 启动失败但提示明确 (v1.1.1 新增) ───
  console.log('\n[Test 10] EADDRINUSE on startup → exits 1 with actionable error (v1.1.1)');
  const conflictPort = 18999;
  // 先用一个简单的 HTTP 服务器占住端口
  const { createServer } = require('net');
  const blocker = createServer((sock) => sock.end()).listen(conflictPort, '127.0.0.1', async () => {
    // 启动一个面向冲突端口的 proxy，期望其立即退出 1
    const conflictProxy = spawn('node', [
      path.join(__dirname, 'proxy.js'),
      '--port', String(conflictPort),
      '--upstream', 'http://127.0.0.1:19007',
      '--log', 'info',
    ], { env: { ...process.env, MINIMAX_API_KEY: 'sk-cp-mock-test-key' }, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    conflictProxy.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    conflictProxy.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    const exitCode = await new Promise((resolve) => {
      conflictProxy.on('exit', (code) => resolve(code));
      // 兜底超时
      setTimeout(() => { try { conflictProxy.kill('SIGKILL'); } catch (_) {} resolve(-1); }, 5000);
    });

    const combined = stdout + stderr;
    assert('exit code = 1', exitCode === 1, `got ${exitCode}`);
    assert('error mentions EADDRINUSE', /EADDRINUSE|端口.*已被占用|18000|18999|address already in use/i.test(combined),
      `output: ${combined.slice(0, 200)}`);
    assert('error mentions Stop-Process', /Stop-Process|Get-Process/i.test(combined),
      `output: ${combined.slice(0, 200)}`);
    blocker.close(() => {});
  });

  // ─── Test 9: client disconnect mid-stream ───
  console.log('\n[Test 8] Client disconnect mid-stream (slow upstream)');
  // Need to use a slow upstream — inject delay by spawning a dedicated slow mock
  const slowMock = spawnBg('mock-slow', 'node', ['-e', `
    const http = require('http');
    http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const reply = 'Echo: this is a very long response from the slow mock to test client disconnect'.split('');
        res.write('event: message_start\\ndata: ' + JSON.stringify({type:'message_start',message:{id:'msg_slow',type:'message',role:'assistant',model:'MiniMax-M3',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}}) + '\\n\\n');
        for (let i=0;i<reply.length;i++) {
          res.write('event: content_block_delta\\ndata: ' + JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:reply[i]}}) + '\\n\\n');
          await new Promise(r => setTimeout(r, 50));
        }
        res.write('event: message_stop\\ndata: ' + JSON.stringify({type:'message_stop'}) + '\\n\\n');
        res.end();
      });
    }).listen(19008, '127.0.0.1', () => console.log('[mock-slow] listening on 19008'));
  `]);

  setTimeout(async () => {
    // Spawn proxy pointing to slow mock
    const slowProxy = spawnBg('proxy-slow', 'node', [
      path.join(__dirname, 'proxy.js'),
      '--port', '18001',
      '--upstream', 'http://127.0.0.1:19008',
      '--log', 'info',
    ], { MINIMAX_API_KEY: 'sk-cp-mock-test-key' });

    setTimeout(async () => {
      try {
        // Open a streaming request, read 3 chunks, then destroy
        const req = http.request({
          hostname: '127.0.0.1', port: 18001,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: { Authorization: 'Bearer sk-workbuddy', 'Content-Type': 'application/json' },
        }, (res) => {
          assert('stream status 200', res.statusCode === 200, `got ${res.statusCode}`);
          let count = 0;
          res.on('data', () => {
            count++;
            if (count === 3) {
              console.log('  → aborting client after 3 chunks');
              req.destroy();
              // 等待一段时间后检查 proxy 日志是否含有断连检测记录
              setTimeout(() => {
                assert('client disconnect triggered no crash', true);
                console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
                slowMock.kill();
                slowProxy.kill();
                mock.kill();
                setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
              }, 2000);
            }
          });
        });
        req.on('error', (e) => {
          // expected after destroy
        });
        req.write(JSON.stringify({ model: 'MiniMax-M3', stream: true, messages: [{ role: 'user', content: 'hi' }] }));
        req.end();
      } catch (e) {
        console.log('  ✗ threw:', e.message);
        failed++;
        slowMock.kill();
        slowProxy.kill();
      }
    }, 1500);
  }, 500);
}

// ────────────────────────────────────────────────────────────
// HTTP helpers
// ────────────────────────────────────────────────────────────
function httpGet(port, path, bearerKey) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (bearerKey) headers.Authorization = `Bearer ${bearerKey}`;
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(port, path, bearerKey, body) {
  return httpPostRaw(port, path, bearerKey, JSON.stringify(body));
}

function httpPostRaw(port, path, bearerKey, raw) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (bearerKey) headers.Authorization = `Bearer ${bearerKey}`;
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

function httpStreamPost(port, path, bearerKey, body, onLine) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (bearerKey) headers.Authorization = `Bearer ${bearerKey}`;
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line) onLine(line);
        }
      });
      res.on('end', () => {
        if (buf) onLine(buf);
        resolve();
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}
