# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.3] - 2026-08-21

### Changed
- **`start.bat` rewritten to delegate all Chinese output to PowerShell**: cmd.exe's parser can mis-tokenize Chinese text containing brackets/parentheses (e.g. `（`, `）`, `：`), producing garbled or truncated console output. The launcher now prints ASCII-only text from cmd itself and routes every Chinese message (port-conflict hint, exit-code reference, debug guidance) through `powershell -NoProfile -Command`, so `cmd /c start.bat` renders correctly regardless of the active code page.
- Added `cd /d "%~dp0"` at the top so `proxy.js` resolves correctly even when the launcher is invoked from a different working directory.

## [1.1.2] - 2026-08-18

### Added
- **Process exit signal tracking**: `proxy.js` now registers handlers for `SIGINT`, `SIGTERM`, and `SIGHUP`, plus `process.on('exit')`, `beforeExit`, and `unhandledRejection`. A global `exitReason` is updated as each signal arrives, and on exit a synchronous stderr line is written: `[proxy] === EXIT code=X reason=... ===`. This makes "proxy exited silently with no log" diagnosable — the previous version could only log if `uncaughtException` fired, which it does not on signals.
- `server.on('error')` (introduced in 1.1.1) now also sets `exitReason` to `EADDRINUSE 启动期` / `EACCES 启动期` / `启动期错误: <code>` before calling `process.exit(1)`.
- `start.bat` end-of-run banner now prints the full exit-code reference table (`0` / `1` / `130` / `143` / `3221225786` / `other → see EXIT line above`) and recommends `node proxy.js --log debug` for next-time diagnosis.

### Motivation
A user reported the proxy was dying mid-session while WorkBuddy was making requests: the console window showed only `代理已退出 (code=X)` with no error log. The new tracking will reveal whether the cause is `SIGTERM` (e.g. an IDE / antivirus killing the process), `SIGINT` (Ctrl+C / external interrupt), or an internal JS exception.

## [1.1.1] - 2026-08-18

### Fixed
- **Startup race condition on `EADDRINUSE`**: proxy.js did not listen to `server.on('error')`, so when port 18000 was already in use the `EADDRINUSE` error went to `uncaughtException` (logged but not exited) and `start.bat` silently closed. Now `server.on('error')` recognizes `EADDRINUSE` / `EACCES`, prints actionable Chinese guidance + `Get-Process node | Stop-Process -Force`, and exits with code 1.
- `uncaughtException` now exits with code 1 only during startup (`!server.listening`); runtime exceptions still log without killing the live proxy.
- `start.bat` now pre-checks port availability with `Get-NetTCPConnection` and always `pause` (no longer relies on `errorlevel`).

### Added
- **Test 10: port-conflict regression test** — spawns a TCP blocker on port 18999, starts a second proxy pointing at it, asserts `exit code = 1`, asserts output mentions `EADDRINUSE` / `端口.*已被占用`, and asserts output includes `Stop-Process` / `Get-Process` remediation hint. Total integration assertions now **63/63**.

## [1.1.0] - 2026-08-18

### Added
- **Function Calling / Tool Use** full support: `tools`, `tool_choice` (`auto` / `none` / `required` / `{type, function}`), and multi-turn `tool_calls` + `tool_result` round-trip.
- **Streaming `tool_calls` output**: SSE `content_block_start` → `id/name/""`, `content_block_delta` → `arguments` partial chunks, `message_delta.stop_reason="tool_use"` → `finish_reason="tool_calls"`.
- Mock Anthropic upstream now auto-detects `tools` in request body and switches to `tool_nonstr` / `tool_stream` scenarios (previously only honored explicit `?scenario=` query).
- New self-test section in README: `5.5 Function Call (Tool Use)`.
- New integration tests: **9a / 9b / 9c / 9d** (21 new assertions). Total now **60/60** passing.
- `npm test` script in `package.json` (alias for `node test-integration.js`).

### Changed
- README: test counts bumped from `39` → `60`; new test scenario rows added to the coverage table; section "九、未来扩展" rewritten as "九、能力状态与未来扩展" (already-implemented tool_use moved into "✅ 已实现").

## [1.0.0] - 2026-08-18

### Added
- Initial release
- OpenAI Chat Completions → Anthropic Messages protocol bridge (single-file Node.js, zero npm deps)
- Support for streaming (SSE) and non-streaming responses
- `/v1/chat/completions`, `/v1/models`, `/health` endpoints
- Placeholder API key authentication (WorkBuddy side never sees the real MiniMax key)
- ASCII validation on `MINIMAX_API_KEY` (fail-fast with clear error pointing to offending characters)
- Configurable via CLI args, environment variables, or `start.bat`
- Windows one-click launcher (`start.bat`)
- Integration test suite: 39 assertions across 14 scenarios
- Concurrency stress test (20 parallel requests)
- Mock Anthropic upstream for offline testing (`mock-anthropic.js`)
- Comprehensive Chinese-language README with troubleshooting section

### Security
- Listens on `127.0.0.1` only by default (not exposed to LAN)
- Real API key never leaves the local proxy