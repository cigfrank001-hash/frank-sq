---
name: Bug report
about: Something is broken when using the proxy
title: "[bug] "
labels: bug
assignees: ''
---

## Environment

- OS: [e.g. Windows 11, macOS 14, Ubuntu 22.04]
- Node.js version (`node -v`):
- Proxy version / commit:
- Are you using the bundled `start.bat` or running `node proxy.js` directly?

## What happened

A clear and concise description of what went wrong.

## Reproduction

Minimal curl / HTTP request that triggers the issue:

```bash
curl -X POST http://127.0.0.1:18000/v1/chat/completions \
  -H "Authorization: Bearer sk-workbuddy" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

## Expected behavior

What you expected to see.

## Actual behavior

What actually happened. Paste the full response body and the proxy's log line for the failing request:

```
[req_xxx] ... → 502 | ...ms | in=Ntok out=Mtok
```

## Additional context

Any other context (screenshots, related issues, environment quirks).