#!/usr/bin/env node
/**
 * 并发压力测试：验证代理能正确处理并行请求
 *
 * 场景：WorkBuddy 实际使用时可能同时打开多个对话窗口，每个窗口独立调用 LLM。
 * 代理必须能正确处理并发请求，不能因为一个请求阻塞另一个。
 *
 * 测试方法：
 * 1. 起 mock upstream（带 200ms 延迟，模拟真实网络）
 * 2. 起 proxy
 * 3. 同时发 20 个并发 chat 请求（不同 user 内容）
 * 4. 验证：
 *    - 全部 20 个请求都成功 (status 200)
 *    - 每个请求的响应内容对应其发出的 user 内容（没有串号）
 *    - 总耗时接近于单请求耗时（而不是 20 × 单请求耗时，证明真的并发）
 */
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PROXY_PORT = 18002;
const MOCK_PORT = 19010;
const CONCURRENT = 20;

function spawnBg(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    cwd: __dirname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ERR ${d}`));
  return p;
}

// ────────────────────────────────────────────────────────────
// 起 mock upstream：每次请求都延迟 200ms，echo 用户的 userText
// ────────────────────────────────────────────────────────────
console.log('=== 启动 mock upstream ===');
const mock = spawnBg('mock', 'node', ['-e', `
  const http = require('http');
  http.createServer(async (req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      // 模拟 200ms 网络延迟
      await new Promise(r => setTimeout(r, 200));
      let json;
      try { json = JSON.parse(body); } catch { json = {}; }
      const userText = (json.messages && json.messages.find(m => m.role === 'user') && json.messages.find(m => m.role === 'user').content) || 'unknown';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'message',
        role: 'assistant',
        model: json.model || 'MiniMax-M3',
        content: [{ type: 'text', text: 'Echo: ' + userText }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: userText.length }
      }));
    });
  }).listen(${MOCK_PORT}, '127.0.0.1', () => console.log('[mock] listening on ${MOCK_PORT}'));
`]);

// ────────────────────────────────────────────────────────────
// 起 proxy
// ────────────────────────────────────────────────────────────
setTimeout(() => {
  console.log('\n=== 启动 proxy ===');
  const proxy = spawnBg('proxy', 'node', [
    path.join(__dirname, 'proxy.js'),
    '--port', String(PROXY_PORT),
    '--upstream', `http://127.0.0.1:${MOCK_PORT}`,
    '--log', 'warn',  // 压测时只显示 warn，避免日志爆炸
    '--timeout', '10000',
  ], { MINIMAX_API_KEY: 'sk-cp-concurrency-test' });

  setTimeout(runStress, 1500);

  process.on('SIGINT', () => { mock.kill(); proxy.kill(); process.exit(0); });
}, 500);

// ────────────────────────────────────────────────────────────
// 并发测试主体
// ────────────────────────────────────────────────────────────
async function runStress() {
  console.log(`\n=== 并发 ${CONCURRENT} 个请求 ===`);
  const t0 = Date.now();

  const promises = [];
  for (let i = 0; i < CONCURRENT; i++) {
    promises.push(sendRequest(i));
  }

  const results = await Promise.all(promises);
  const elapsed = Date.now() - t0;

  let passed = 0;
  let failed = 0;
  const ids = new Set();

  for (const r of results) {
    const ok = r.status === 200 && r.content && r.content.includes(`Request-${r.id}`);
    if (ok) {
      passed++;
      ids.add(r.id);
    } else {
      failed++;
      console.log(`  ✗ Request ${r.id}: status=${r.status} content=${JSON.stringify(r.content)}`);
    }
  }

  console.log(`\n=== 结果 ===`);
  console.log(`  并发数:        ${CONCURRENT}`);
  console.log(`  成功:          ${passed}`);
  console.log(`  失败:          ${failed}`);
  console.log(`  唯一响应 ID:   ${ids.size}（应为 ${CONCURRENT}）`);
  console.log(`  总耗时:        ${elapsed}ms`);
  console.log(`  平均单请求:    ${(elapsed / CONCURRENT).toFixed(1)}ms`);
  console.log(`  串行预期:      ${CONCURRENT * 200}ms（每次 200ms 延迟）`);
  const parallelRatio = (elapsed / (CONCURRENT * 200)).toFixed(2);
  console.log(`  并行/串行比:   ${parallelRatio}（越小越好，<0.5 说明真并行）`);

  const ok = passed === CONCURRENT && failed === 0 && ids.size === CONCURRENT;
  if (ok) {
    console.log('\n[PASS] 全部并发请求独立处理，无串号、无丢失');
  } else {
    console.log('\n[FAIL] 并发测试未通过');
  }

  // 清理
  mock.kill();
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
}

function sendRequest(id) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: `Request-${id}-unique-content` }],
      max_tokens: 50,
    });
    const t0 = Date.now();
    const req = http.request({
      hostname: '127.0.0.1',
      port: PROXY_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk-workbuddy',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({
            id,
            status: res.statusCode,
            content: j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content,
            latency: Date.now() - t0,
          });
        } catch (e) {
          resolve({ id, status: res.statusCode, content: null, error: e.message });
        }
      });
      res.on('error', (e) => resolve({ id, status: 0, error: e.message }));
    });
    req.on('error', (e) => resolve({ id, status: 0, error: e.message }));
    req.write(body);
    req.end();
  });
}