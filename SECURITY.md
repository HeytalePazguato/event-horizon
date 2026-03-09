# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Event Horizon, please report it responsibly.

**Email:** Open a private issue or contact the maintainers directly via GitHub.

**Do NOT** open a public GitHub issue for security vulnerabilities.

## Scope

Event Horizon runs a localhost-only HTTP server (port 28765) to receive agent events. The server:
- Binds to `127.0.0.1` only — not reachable from the network
- Requires a per-session auth token on all requests
- Validates and constrains all input (body size, depth, string lengths)
- Rate-limits requests (200/s per IP)

The VS Code webview runs in a sandboxed browser context with a Content Security Policy. `unsafe-eval` is required by PixiJS for WebGL shader compilation.

## Supported Versions

Only the latest release is supported with security updates.
