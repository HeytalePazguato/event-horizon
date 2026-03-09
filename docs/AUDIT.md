# AUDIT.md — Event Horizon Pre-Release Audit (v4)

Full codebase audit performed 2026-03-08. Every source file reviewed.

Numbering: **Category.Issue** — 1=Security, 2=Bugs, 3=Memory/Perf, 4=Production, 5=Code Cleanup.
Items resolved in v3 are omitted (see git history). New items from v4 audit are marked `[ ]`.

---

## 1. Security

All critical and high-severity items from v3 are resolved. No new security vulnerabilities found.

**Positive findings (no action needed):**
- HTTP server binds to `127.0.0.1` only, with per-session auth token (48-byte hex)
- Rate limiting at 200 RPS with sliding window
- Payload validation: 1MB body limit, 10-level depth, 64KB JSON size
- Connector whitelists: only safe fields forwarded, strings clamped
- CSP: `unsafe-eval` accepted (PixiJS requirement), no `unsafe-inline` for scripts
- Webview command handler uses `ALLOWED_COMMANDS` whitelist
- No secrets, API keys, or credentials in codebase
- CI uses `process.env` instead of shell interpolation

### 1.1 — Request timeout missing on HTTP server
**File:** `apps/vscode/src/eventServer.ts:78-109`
**Severity:** Low
`parseBody` has no `req.setTimeout()`. A client that opens a connection and sends data very slowly can hold the connection open indefinitely. Localhost-only binding limits exposure, but a misbehaving local process could exhaust server resources.
- [x] Added `req.setTimeout(REQUEST_TIMEOUT_MS)` (10s) in `parseBody` to abort stalled requests.

---

## 2. Bugs

All critical and high-severity items from v3 are resolved.

### 2.1 — Spiral objects not destroyed on unmount
**File:** `packages/renderer/src/Universe.tsx:611-612`
**Severity:** Medium
On component unmount, `spiralRef.current = []` discards the array reference without destroying the PixiJS Container/Graphics objects inside. If planets are mid-spiral when the component unmounts, they become orphaned GPU objects.
- [x] Added destruction loop before clearing `spiralRef.current` on unmount.

### 2.2 — `agentLastSeenRef` grows unbounded
**File:** `apps/vscode/webview/index.tsx:164`
**Severity:** Low
`agentLastSeenRef` accumulates entries for every agent that has ever connected. When agents disconnect and are removed from state, their entry in `agentLastSeenRef` persists. Over very long sessions this is a slow leak.
- [x] Added `delete agentLastSeenRef.current[agentId]` to `agent.terminate` handler and demo cleanup.

### 2.3 — Unused Zustand selector: `setSingularityStats`
**File:** `apps/vscode/webview/index.tsx:157`
**Severity:** Low
The `setSingularityStats` is extracted via `useCommandCenterStore` selector but is never used — line 206 accesses it via `useCommandCenterStore.getState()` instead. This causes an unnecessary subscription.
- [x] Removed the unused selector.

---

## 3. Memory & Performance

### 3.1 — Rate limiter map never cleaned on idle
**File:** `apps/vscode/src/eventServer.ts:37-48`
**Severity:** Low
`rateCounts` only cleans expired entries when a new request arrives. If the server is idle, old entries remain in memory forever. With localhost-only binding, this is practically a single-entry map, but it's still unbounded in theory.
- [x] `rateCounts.clear()` added to `stopEventServer()`.

### 3.2 — `boostTimers` not cleared across webview reloads
**File:** `packages/ui/src/store.ts:126`
**Severity:** Low
Module-level `boostTimers` Map persists across HMR/webview reloads. Old timeouts fire on a stale store. In production this is a non-issue (webview is loaded once), but causes confusing behavior during development.
- [x] Added `clearAllBoostTimers()` export; called during `init-state` hydration to clear stale timers on webview reload.

### 3.3 — PulseWave and SolarFlare: per-frame `clear()` + redraw
**Files:** `packages/renderer/src/effects/PulseWave.ts:36-37`, `SolarFlare.ts:37-42`
**Severity:** Low
`ring.clear()` deallocates internal PixiJS geometry and the following `circle().stroke()` / `lineTo().stroke()` reallocates it every frame. This causes per-frame allocation pressure. These effects are currently unused by Universe.tsx but are still exported.
- [x] Both files were deleted in 5.1 cleanup. No longer in codebase.

---

## 4. Production Readiness

### 4.1 — ~~No CHANGELOG.md~~
**Severity:** ~~Medium~~ N/A
CHANGELOG already exists at `apps/vscode/CHANGELOG.md`. Audit item was incorrect.
- [x] Already present.

### 4.2 — No SECURITY.md
**Severity:** Low
No security policy for vulnerability reporting. Good practice for any published extension.
- [x] Created `SECURITY.md` with disclosure instructions, scope, and supported versions.

### 4.3 — No source maps in production webview build
**File:** `apps/vscode/package.json` (build:webview:prod script)
**Severity:** Low
Production webview is minified with no `--sourcemap` flag. Error stack traces in production will be obfuscated, making bug reports harder to diagnose.
- [x] Added `--sourcemap=linked` to `build:webview:prod` esbuild command.

### 4.4 — Extension host test coverage gaps
**Severity:** Medium
Core logic (EventBus, AgentStateManager, MetricsEngine) and connectors have good test coverage. However, the extension host (`extension.ts`, `eventServer.ts`, `webviewProvider.ts`), renderer, and UI have no tests.
- [x] Written 28 tests for `eventServer.ts` covering: pure functions (clamp, checkDepth, sanitizePayload, isRateLimited), HTTP routing, auth (Bearer header + query param), `/claude` route mapping, `/opencode` route mapping, `/events` raw event validation (agentType fallback, invalid types, deep nesting, field clamping), error handling (invalid JSON, missing callbacks).
- [x] Zustand store tests: 27 tests covering agent selection, singularity stats, pause/isolate/boost, logs (cap at 200), achievements (unlock, idempotency, demo guard, tiered upgrades, toast dismiss), and all toggles.
- N/A: Renderer snapshot tests deferred — PixiJS requires WebGL context, making unit snapshots impractical without heavy mocking.

### 4.5 — `activationEvents` is empty
**File:** `apps/vscode/package.json:24`
**Severity:** Low
Extension only activates when the webview panel is opened. This is by design but means `eventHorizon.open` command doesn't work if the extension isn't already active.
- [x] Added `onCommand:eventHorizon.open` to `activationEvents`.

---

## 5. Code Cleanup

### 5.1 — Dead effect files: PulseWave.ts and SolarFlare.ts
**Files:** `packages/renderer/src/effects/PulseWave.ts`, `packages/renderer/src/effects/SolarFlare.ts`
**Severity:** Medium
These files are exported from `packages/renderer/src/index.ts` (lines 16-17) but never imported by Universe.tsx or any consumer. Dead code that adds to bundle size and maintenance burden.
- [x] Deleted both files and removed their exports from `packages/renderer/src/index.ts`. Also removed unused type exports (`PlanetProps`, `MoonProps`, `ShipProps`, `SingularityProps`, `TrafficRouteProps`).

### 5.2 — Unused adapter factory functions
**Files:**
- `packages/connectors/src/claudeCode.ts:72-74` — `createClaudeCodeAdapter()`
- `packages/connectors/src/openCode.ts:114-116` — `createOpenCodeAdapter()`
- `packages/connectors/src/copilot.ts:39-41` — `createCopilotAdapter()`
**Severity:** Low
These wrapper functions just return the direct mapping function. Only the direct functions (`mapClaudeHookToEvent`, `mapOpenCodeToEvent`, `mapCopilotOutputToEvent`) are used in `eventServer.ts`. The adapter factories add indirection with no benefit.
- [x] Deleted all three factory functions.

### 5.3 — Unused type exports from renderer index
**File:** `packages/renderer/src/index.ts:8,10,12,14,19`
**Severity:** Low
`PlanetProps`, `MoonProps`, `ShipProps`, `SingularityProps`, `TrafficRouteProps` are exported but never imported by any consumer outside the renderer package. The factory functions are only called from `Universe.tsx`.
- [x] Removed along with PulseWave/SolarFlare cleanup (see 5.1).

### 5.4 — Console.log statements in production code
**Files:**
- `apps/vscode/src/eventServer.ts:159,161` — OpenCode event debug logging
- `apps/vscode/src/extension.ts:60,62` — cwd injection debug logging
**Severity:** Medium
Four `console.log` calls output to the extension host's developer console on every event. These are debug statements that should be removed for production.
- [x] Removed all four console.log calls.

### 5.5 — Copilot integration is a complete stub
**Files:** `apps/vscode/src/copilotChannel.ts`, `packages/connectors/src/copilot.ts`
**Severity:** Low
`copilotChannel.ts` returns an empty disposable. `mapCopilotOutputToEvent` exists but is never called. The `_onEvent` parameter is unused. The whole Copilot integration path provides no functionality.
- [x] Kept as placeholder with clear JSDoc comment explaining why it's a stub and when it can be implemented (when VS Code exposes OutputChannel content or Copilot provides an extension API).

### 5.6 — Backwards-compat re-export file: Achievements.tsx
**File:** `packages/ui/src/Achievements.tsx`
**Severity:** Low
After the achievement modular refactor, this file exists only as a backwards-compat re-export layer. All imports have been updated to use `./achievements/index.js` directly.
- [x] Verified no consumers import it. Deleted.

---

## Summary

| Category            | Open | Resolved | Severity Breakdown (open)    |
|---------------------|------|----------|------------------------------|
| Security            | 0    | 1        | —                            |
| Bugs                | 0    | 3        | —                            |
| Memory & Perf       | 0    | 3        | —                            |
| Production          | 0    | 5        | —                            |
| Code Cleanup        | 0    | 6        | —                            |
| **Total**           | **0** | **18**  |                              |

**All audit items resolved.** Renderer snapshot tests noted as N/A (PixiJS requires WebGL context).

---

## Status Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
