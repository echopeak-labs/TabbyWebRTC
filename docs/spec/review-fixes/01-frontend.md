# Review Fixes — Frontend

## Scope

Remediation for frontend gaps and logic flaws found against `frontend/02`–`05`. Does not redefine the Onyx/Amber UI; only session, signaling, launchpad, and stream behavior that is broken or missing.

Related original specs: `frontend/02-auth-session.md`, `frontend/03-webrtc-client.md`, `frontend/05-launchpad.md`.

---

## FE-01 — Auth WS Torn Down Before Streaming (critical / logic)

### Problem

`ConnectPage` creates a dedicated `SignalClient`. On `AUTH_APPROVED` the session token is written to `sessionStorage` and bound server-side to that connection. Cleanup then calls `client.disconnect()`. Launchpad/stream use the singleton `signalClient`, which opens a **new** WebSocket with no token. `SUBSCRIBE` fails on WAN.

### Required Fix

1. Use a single persistent `SignalClient` for the desktop viewer lifetime (or migrate ConnectPage to the singleton before approve).
2. Do **not** disconnect the WebSocket on navigate to `/launchpad` after `AUTH_APPROVED`.
3. If reconnect is required: re-bind the TabbyWebRTC JWT to the new connection (new REST or WS message, e.g. `BIND_SESSION { token }`) before any `SUBSCRIBE`.
4. Document the contract: session token is always attached to the active browser `connectionId`.

### Acceptance

- After QR approve, same WS (or re-bound WS) successfully `SUBSCRIBE`s without local agent HTTP.
- Integration test: approve → launchpad → stream without `127.0.0.1:7700`.

---

## FE-02 — REQUEST_SOURCES Has No Backend Handler (high / gap)

### Problem

`useAgentSources` probes local agent, then sends `{ type: 'REQUEST_SOURCES', agentId }`. Neither Lambda `router.ts` nor testServer handles this. WAN launchpad can show empty sources.

### Required Fix

Choose one (prefer A):

**A.** Backend handles `REQUEST_SOURCES`: verify session token, load agent registration displays/apps, reply `AGENT_SOURCES` to the browser connection.

**B.** On `AGENT_REGISTER` / heartbeat, push `AGENT_SOURCES` to all browser connections for that `agentId`; frontend listens only (no request).

### Acceptance

- WAN-only (no LAN probe) launchpad populates displays and apps after auth.
- testServer and Lambda behavior match.

---

## FE-03 — No JWT Refresh or 401 Session Clear (high / gap)

### Problem

Spec Phase D3: on 401, clear session and redirect to `/`. Not implemented. No proactive refresh before 8h JWT expiry.

### Required Fix

1. Centralize REST fetch helper: on `401`, call `clearSessionStorage()` + `authStore.clearSession()` + navigate `/`.
2. On WS `ERROR` / auth failure for session-scoped messages, same clear path.
3. Optional: refresh endpoint or re-approve before expiry; minimum is hard clear on 401.

### Acceptance

- Expired/invalid token on `GET /agents` or `GET /turn-credentials` returns user to ConnectPage with cleared storage.
- No silent hang on launchpad with dead token.

---

## FE-04 — Agent Switch Leaves Stale JWT (medium / logic)

### Problem

TopBar agent switch navigates to `/` without clearing session. JWT remains scoped to the previous `agentId`.

### Required Fix

On agent switch: `clearSession()` + clear `sessionStorage` + navigate `/` (full re-approve for the new agent), **or** issue a new agent-scoped token via a dedicated switch flow.

### Acceptance

- After switch, no SUBSCRIBE attempts use the previous agentId JWT.

---

## FE-05 — Bitrate Cap UI Is a No-Op (medium / logic)

### Problem

Viewer is receive-only. `applyBitrateCap` on `getSenders()` does nothing.

### Required Fix

- Remove or disable bitrate UI until agent supports a signaling command (e.g. `SET_BITRATE`), **or**
- Implement agent-side encode bitrate and wire control bar → data channel / signaling → encoder.

### Acceptance

- UI either absent or demonstrably changes outbound encode bitrate on the agent.

---

## FE-06 — No CSP / Security Headers on SPA (low / security)

### Problem

CloudFront SPA has HTTPS redirect only. XSS can exfiltrate `sessionStorage` tokens via BroadcastChannel.

### Required Fix

Add CloudFront response headers (or meta CSP): default-src self, connect-src WS/REST origins, frame-ancestors none, etc. Align with Clerk and Vite asset hosts.

### Acceptance

- Deployed SPA responses include CSP and `X-Frame-Options` / `frame-ancestors`.

---

## FE-07 — Local Network Connect Modal Is a Stub (low / gap)

### Problem

ConnectPage modal captures IP but does not probe or connect. LAN only works via hardcoded `127.0.0.1` / `localhost` in `useAgentSources`.

### Required Fix

Wire modal IP to probe `http://{ip}:7700/info` with HMAC `local_token` (after DA-02), set `agentBaseUrl`, and use that for sources/thumbnails.

### Acceptance

- Entering a LAN IP successfully loads sources when agent is reachable on that host.
