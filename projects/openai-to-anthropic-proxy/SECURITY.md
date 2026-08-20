# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | ✅ Active          |
| < 1.0   | ❌ Not maintained  |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Send a private report to the maintainers (see GitHub repo sidebar for contact). Include:

- Description of the vulnerability
- Reproduction steps
- Impact assessment (what an attacker could achieve)

You can expect an initial response within 72 hours.

## Security model

This proxy is a **local development tool**. By default it binds to `127.0.0.1` and is not reachable from the network. The threat model assumes:

- The host machine is trusted
- The proxy is used by one human user, or a small set of trusted users on the same machine
- `MINIMAX_API_KEY` is treated as a secret

If you need to expose this proxy on a LAN, you MUST add an authentication layer in front of it. The proxy itself does not implement user authentication beyond a placeholder key check.

## Known non-issues

- The placeholder key (`sk-workbuddy` by default) is intentionally trivial — it is not a security boundary. Anyone who can reach `127.0.0.1:18000` can use the proxy. The real security boundary is your machine's network access control.
- The real `MINIMAX_API_KEY` is held in process memory only. It is not logged.