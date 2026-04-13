# MCP Authentication (v2.0.0)

Event Horizon's local HTTP server on `127.0.0.1:28765` implements full OAuth 2.1 authentication for its MCP endpoint, compliant with the Model Context Protocol specification (2025-06-18). This document describes the auth flow, the endpoint surface, and the security model.

## What changed in v2.0.0

Prior to v2.0.0, authentication was a single static token passed via `?token=` query-string on every request. Standard MCP clients (Claude Code, Cursor, VS Code MCP) couldn't use it — when they receive a `401`, they discover the server via RFC 9728 well-known metadata and run the full OAuth 2.1 authorization-code flow, not re-issue the request with a query-string token.

**Breaking changes:**
- `?token=<value>` query-string auth is **no longer accepted** on any endpoint. All requests must present `Authorization: Bearer <token>`.
- `/mcp` now requires a **JWT access token** obtained through the OAuth 2.1 authorization-code flow (the default for MCP clients). A `client_credentials` flow is also supported for CLI/automation callers.
- Existing users must run **"Event Horizon: Connect Claude Code"** (or the equivalent for OpenCode / Copilot / Cursor) once after upgrading to regenerate hooks and MCP configs.

Internal hooks continue to authenticate with the startup token directly via `Authorization: Bearer <startup-token>` — no OAuth flow is required for first-party callers. OAuth is specifically what MCP clients use to reach `/mcp`.

## Auth flow for MCP clients (authorization_code + PKCE + refresh_token)

This is the flow Claude Code, Cursor, and the MCP TypeScript SDK use by default. Since EH is localhost-only and has no human user to prompt, the `/oauth/authorize` endpoint auto-approves every valid request and redirects immediately — there's no visible consent screen.

```
┌──────────────┐                                   ┌─────────────────┐
│  MCP client  │                                   │ Event Horizon   │
│ (Claude Code)│                                   │ 127.0.0.1:28765 │
└──────┬───────┘                                   └────────┬────────┘
       │ POST /mcp  (no auth)                               │
       │ ──────────────────────────────────────────────>    │
       │                                                    │
       │ 401 + WWW-Authenticate: Bearer                     │
       │        resource_metadata="<...>"                   │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ GET /.well-known/oauth-protected-resource          │
       │ ──────────────────────────────────────────────>    │
       │ 200 { authorization_servers: [<issuer>] }          │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ GET /.well-known/oauth-authorization-server        │
       │ ──────────────────────────────────────────────>    │
       │ 200 { authorization_endpoint, token_endpoint,      │
       │       registration_endpoint,                       │
       │       grant_types_supported: [auth_code, ...],     │
       │       code_challenge_methods_supported: [S256] }   │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ POST /oauth/register                               │
       │   { redirect_uris: ["http://localhost:PORT/cb"],   │
       │     client_name, grant_types, ... }                │
       │ ──────────────────────────────────────────────>    │
       │ 201 { client_id, client_secret, redirect_uris,     │
       │       grant_types, response_types, ... }           │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ generate PKCE: code_verifier (random),             │
       │                code_challenge = SHA256(verifier)   │
       │                                                    │
       │ GET /oauth/authorize?                              │
       │   response_type=code                               │
       │   &client_id=<from DCR>                            │
       │   &redirect_uri=http://localhost:PORT/cb           │
       │   &state=<random>                                  │
       │   &code_challenge=<SHA256 of verifier>             │
       │   &code_challenge_method=S256                      │
       │ ──────────────────────────────────────────────>    │
       │                                                    │
       │ (auto-approved, no consent UI)                     │
       │                                                    │
       │ 302 Location: http://localhost:PORT/cb?            │
       │              code=<one-time code>&state=<...>      │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ POST /oauth/token  (form-encoded)                  │
       │   grant_type=authorization_code                    │
       │   &code=<from redirect>                            │
       │   &redirect_uri=<same as /authorize>               │
       │   &client_id=<from DCR>                            │
       │   &code_verifier=<plaintext PKCE verifier>         │
       │ ──────────────────────────────────────────────>    │
       │                                                    │
       │ (server verifies PKCE: SHA256(verifier) ==         │
       │  challenge stored with the code)                   │
       │                                                    │
       │ 200 { access_token (JWT, 1h),                      │
       │       refresh_token (JWT, 30d),                    │
       │       token_type: Bearer, expires_in, scope }      │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ POST /mcp                                          │
       │   Authorization: Bearer <JWT access token>         │
       │ ──────────────────────────────────────────────>    │
       │ 200 { tools/list, tools/call, ... }                │
       │ <──────────────────────────────────────────────    │
       │                                                    │
       │ (later, when access_token expires)                 │
       │                                                    │
       │ POST /oauth/token                                  │
       │   grant_type=refresh_token                         │
       │   &refresh_token=<from previous exchange>          │
       │ ──────────────────────────────────────────────>    │
       │ 200 { access_token, refresh_token, ... }           │
       │ <──────────────────────────────────────────────    │
```

## Alternate flow: client_credentials (for scripts & CLI)

For non-browser callers — scripts, curl, custom agents — skipping the redirect dance is fine: any caller that already knows the startup token can bypass `/oauth/authorize` entirely.

```
curl -s -X POST http://127.0.0.1:28765/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=my-script&client_secret=$STARTUP_TOKEN"

# → { "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 3600 }
```

Use the returned JWT as the `Authorization: Bearer` header on `/mcp`. `client_credentials` does not issue a refresh token — re-call `/oauth/token` after expiry.

## Endpoint reference

| Method | Path                                             | Auth                                                | Purpose                                                                      | Spec              |
|--------|--------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------------|-------------------|
| GET    | `/.well-known/oauth-protected-resource`          | Public                                              | Resource server metadata. Declares `authorization_servers`, `logo_uri`.      | RFC 9728          |
| GET    | `/.well-known/oauth-authorization-server`        | Public                                              | Authorization server metadata. Declares endpoints, grants, PKCE methods.     | RFC 8414          |
| GET    | `/logo.png`                                      | Public                                              | Event Horizon icon — referenced from `logo_uri` in RFC 9728 metadata.        | —                 |
| POST   | `/oauth/register`                                | Open (RFC 7591 default)                             | Dynamic Client Registration — returns `client_id`/`client_secret`.           | RFC 7591          |
| GET    | `/oauth/authorize`                               | Public (auto-approved for localhost)                | Authorization endpoint. Validates PKCE params, issues code, redirects.       | RFC 6749 §3.1     |
| POST   | `/oauth/token`                                   | Body credentials (client_secret or PKCE verifier)   | Token endpoint. Supports `authorization_code`, `refresh_token`, `client_credentials`. | RFC 6749 §3.2 |
| POST   | `/mcp`                                           | `Authorization: Bearer <JWT access token>`          | MCP JSON-RPC 2.0 endpoint. 401 responses include `WWW-Authenticate`.         | MCP 2025-06-18    |
| POST   | `/claude`, `/copilot`, `/opencode`, `/cursor`    | `Authorization: Bearer <startup-token>`             | Agent hook ingestion. Internal use.                                          | —                 |
| POST   | `/events`                                        | `Authorization: Bearer <startup-token>`             | Raw AgentEvent ingestion.                                                    | —                 |
| POST   | `/lock`, `/lock/status`                          | `Authorization: Bearer <startup-token>`             | File-lock coordination.                                                      | —                 |
| WS     | `/ws`                                            | `Authorization: Bearer <startup-token>`             | Event broadcast stream.                                                      | —                 |

## Internal callers (hooks, spawners, webview)

Internal callers already possess the startup token (it's written into their generated config files at install time) and therefore send it directly as `Authorization: Bearer <startup-token>` without running the OAuth flow. This keeps hook-script complexity minimal — no token refresh, no client registration, just a static bearer header.

- **Claude Code hooks** (`~/.claude/settings.json`) — curl with `-H "Authorization: Bearer $TOKEN"`.
- **OpenCode plugin** (`~/.config/opencode/plugins/event-horizon.ts`) — `fetch` with the `Authorization` header set to `"Bearer " + AUTH_TOKEN`.
- **Copilot hooks** (`~/.event-horizon/copilot-hooks.json`) — curl with `-H "Authorization: Bearer <token>"`.
- **Cursor hooks** (`~/.cursor/hooks.json`) — curl with `-H "Authorization: Bearer <token>"`.
- **Spawned agents** — inherit `EH_AUTH_TOKEN` via env var; their own hooks carry the Bearer header.

Each install regenerates these files with the current startup token, so a VS Code reload (which rotates the startup token) invalidates prior configs. The stale-detection in each setup module identifies legacy `?token=` configs or mismatched tokens and triggers regeneration.

## Migration for existing users

After upgrading to v2.0.0:

1. Reload VS Code (or restart it). The new server code starts with fresh OAuth endpoints live.
2. Open the Command Palette → "Event Horizon: Connect Claude Code" (and/or the equivalent Copilot/OpenCode/Cursor command).
3. Existing agent sessions continue working — only new hook invocations need the refreshed config, and restart prompts happen automatically.

If you skip step 2, hooks from v1.x will return `401 Unauthorized` on every request because they still use `?token=`. The stale-detection surfaces a notification when this happens.

## Security model

- **Transport**: server binds to `127.0.0.1` only. Not reachable from the network.
- **Startup token**: 192-bit random hex, rotated on every extension activation. Stored in globalState so reconnecting agents can stay authenticated across VS Code reloads until the extension truly restarts.
- **JWT signing**: HS256 with the startup token as the HMAC secret. Tokens are invalidated when the extension restarts (new startup token → old JWTs fail signature check).
- **JWT lifetimes**: access tokens 1 hour, refresh tokens 30 days. Both are invalidated on extension restart regardless of their nominal expiry.
- **PKCE**: required on the `authorization_code` flow. S256 and plain are both supported; S256 is the default for every MCP client we've seen.
- **Auth codes**: one-time, 60-second TTL, held in-memory with a 256-entry cap. Consumed (deleted) on first use; replay returns `invalid_grant`.
- **DCR is open** (RFC 7591 §1.5 default). The real security boundary is the `127.0.0.1` socket binding — any process capable of reaching the port can already read `~/.claude.json`, spawn commands as the user, and so on. An additional gate on DCR would have added no meaningful defense against a local attacker while breaking legit MCP clients that have no way to obtain the startup token.
- **Constant-time comparisons**: secret, token, and PKCE comparisons all use `crypto.timingSafeEqual` to prevent timing side-channels.
- **Auto-approval**: `/oauth/authorize` does not show a consent screen. This is appropriate for a localhost-only server with no multi-user scenario — the user who controls the local machine is the only authorization principal, and they authorized the extension install.
- **Redirect URI safety**: `javascript:`, `data:`, and `vbscript:` schemes are rejected at `/oauth/authorize` even for localhost.

## Why two different auth paths?

| Caller                           | Auth                                                      | Why                                                                                     |
|----------------------------------|-----------------------------------------------------------|-----------------------------------------------------------------------------------------|
| First-party hooks (Claude Code, OpenCode, Copilot, Cursor) | `Authorization: Bearer <startup-token>`                   | Already configured with the startup token at install time. Running an OAuth flow from a shell hook adds token-refresh complexity for no security gain. |
| Standard MCP clients (default)   | OAuth 2.1 authorization_code + PKCE + refresh_token → JWT | MCP spec default. Clients discover the server via RFC 9728, register via DCR, and run the full browser-redirect flow (auto-approved for localhost). |
| CLI / scripts / automation       | OAuth 2.1 client_credentials → JWT                        | Skips the browser redirect. Any caller that already knows the startup token can trade it for a JWT at `/oauth/token` without DCR. |

All three paths ultimately validate knowledge of the startup token, just through different schemes. A third-party MCP client cannot skip the OAuth flow because `/mcp` rejects the raw startup token; conversely, hook scripts don't need OAuth because they send payloads to `/claude`, `/opencode`, etc., not `/mcp`.
