# Contributing

Thanks for your interest in contributing! Here are a few guidelines.

## Development setup

1. Fork and clone the repository
2. Make sure you have Node.js 18+ installed
3. No `npm install` is required — the project has zero runtime dependencies
4. Run the test suite:

```bash
node test-integration.js     # 63 integration assertions
node test-concurrency.js     # 20-request concurrency stress
```

Both tests start their own mock upstream + proxy and clean up after themselves. No real API key required.

## Code style

- Pure Node.js, no build step, no TypeScript — keep `proxy.js` runnable as-is with `node proxy.js`
- Match the existing style: single quotes, 2-space indent, semicolons, JSDoc on exported functions
- New features should be additive (don't break the existing config surface)
- Avoid adding npm dependencies unless absolutely necessary

## Pull request workflow

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make your change, add or update tests
3. Ensure `node --check proxy.js` passes
4. Ensure `node test-integration.js` reports `63 passed, 0 failed` (or more, if you add tests)
5. Open a PR describing the change, linked issue, and test results

## Reporting bugs

Use the GitHub issue template. Include:
- Node.js version (`node -v`)
- OS (Windows / macOS / Linux)
- Proxy startup log (the banner with config)
- The exact request that fails (curl one-liner is ideal)
- The proxy log line for the failing request (the `[req_xxx] → 502 | 1.23s` style line)

## Scope reminder

Already implemented (see README「九、能力状态与未来扩展」):
- Function calling / tools（含 multi-turn tool calls 与 streaming tool_calls）

Not yet supported (contributions welcome):
- Image / multimodal inputs
- `thinking` block passthrough
- Auth, rate-limiting, or accounting

PRs that add these should also update `README.md` and `CHANGELOG.md`.