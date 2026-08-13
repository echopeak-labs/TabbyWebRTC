# Test Server — Local Development SDD

## Scope

Defines a standalone NestJS server at the repository root (`testServer/`) that replicates the production backend APIs required for local end-to-end testing of the desktop agent, browser viewer, and mobile auth flow — without AWS deployment, DynamoDB, or SAM.

**In scope:** QR session auth, Clerk JWT validation, TabbyWebRTC/agent JWT issuance, WebSocket signaling (SDP/ICE relay, agent registration, source locks), and TURN credential generation.

**Out of scope:** Update distribution (`backend/05`), video relay, DynamoDB, API Gateway, Lambda, Cloudflare, and production secrets management.

---

## Purpose

Developers and QA need to exercise the full TabbyWebRTC user flow on a LAN:

1. Desktop viewer shows QR on a laptop.
2. Mobile phone on the same Wi‑Fi scans QR, approves with Clerk + biometrics.
3. Desktop agent registers over WebSocket and streams via WebRTC.

The current `scripts/dev-backend.sh` path depends on AWS SAM and local DynamoDB table names. The test server removes that dependency and binds to the host's LAN address so phones and secondary machines can reach it.

---

## Component Location

```
testServer/
  package.json
  tsconfig.json
  nest-cli.json
  .env.example
  src/
    main.ts
    app.module.ts
    config/
    storage/           # in-memory replacements for DynamoDB tables
    auth/
    signaling/
    agents/
    turn/
    shared/            # thin adapters over infra/lambda business logic
```

The test server is a **separate component** at the project root, not nested under `infra/`.

---

## API Parity

Behavior and message shapes must match `backend/02-signaling-server.md` and `backend/04-auth-service.md`. Clients (frontend, desktop-agent) must work unchanged when pointed at the test server via env vars.

### REST Endpoints

| Method | Path | Auth | Source spec |
|---|---|---|---|
| `POST` | `/auth/approve` | Clerk JWT | `backend/04` |
| `POST` | `/agents/pair` | Clerk JWT | `backend/04` |
| `GET` | `/agents` | TabbyWebRTC JWT | `backend/04` |
| `GET` | `/turn-credentials` | TabbyWebRTC JWT | `backend/02`, `backend/04` |

### WebSocket

Single endpoint: `ws://<host>:3001` (no path prefix).

Query parameters (same as production):

- Browser: `?clientType=browser`
- Agent: `?clientType=agent&agentId=<id>&token=<agentJwt>`

On browser connect: create `pendingSessionId`, send `SESSION_PENDING { pendingSessionId, expiresIn: 30 }`.

Inbound message types routed identically to `infra/lambda/src/router.ts`:

| Type | Handler domain |
|---|---|
| `REFRESH_SESSION` | auth |
| `AGENT_REGISTER`, `AGENT_HEARTBEAT` | agents |
| `SUBSCRIBE`, `UNSUBSCRIBE` | signaling |
| `SDP_OFFER`, `SDP_ANSWER`, `ICE_CANDIDATE` | signaling |

Outbound messages: `AUTH_APPROVED`, `SESSION_EXPIRED`, `NOTIFY_SUBSCRIBER`, `NOTIFY_UNSUBSCRIBE`, `SOURCE_IN_USE`, `STREAM_CLOSED`, `AGENT_OFFLINE`, `ERROR`.

WebSocket delivery uses NestJS `@WebSocketGateway` with a `connectionId` (UUID per socket) stored in memory — replacing API Gateway's `connectionId` and `sendToConnection`.

---

## Storage

Replace DynamoDB with in-memory stores (Maps) with the same record shapes as `infra/lambda/src/types.ts`:

| Production table | Test server store |
|---|---|
| `connections` | `ConnectionStore` |
| `pending-sessions` | `PendingSessionStore` (30 s TTL via `setTimeout`) |
| `agents` | `AgentStore` |
| `source_locks` | `SourceLockStore` |

Data is ephemeral. Restart clears all state.

---

## Shared Logic with Lambda

Prefer importing or re-exporting pure functions from `infra/lambda/src/lib/` and `infra/lambda/src/handlers/` rather than duplicating JWT, TURN credential, and message-handling logic.

Approach:

1. Add a `testServer` dependency on `infra/lambda` via a local file path or shared `packages/` workspace entry.
2. Inject a `MessageSender` interface: Lambda uses `sendToConnection` (API GW Management API); test server uses `WebSocket.send` on the stored socket.
3. Handlers receive storage through dependency injection instead of `process.env` + DynamoDB client.

If direct imports create bundling friction, copy only the `lib/jwt.ts` helpers and keep handler logic in one place under `testServer/src/shared/`.

---

## Network Binding

The server must be reachable from other devices on the LAN (mobile phone, tablet on same Wi‑Fi).

### Bind address

- HTTP + WebSocket: `0.0.0.0:3001`
- CORS: allow all origins in dev (`origin: true`)

### LAN IP discovery

On startup, resolve the primary non-loopback IPv4 address and log:

```
TabbyWebRTC test server listening on:
  REST/WS  http://192.168.1.42:3001  ws://192.168.1.42:3001
  (also http://127.0.0.1:3001 for localhost)
```

Detection order:

1. `os.networkInterfaces()` — first non-internal IPv4 that is not `127.0.0.1`
2. Fallback: `hostname -I` first token (Linux)

Expose `LAN_IP` env var override for multi-NIC hosts.

### Frontend dev server

Vite must bind `0.0.0.0` so mobile browsers can load the PWA:

```
VITE_WS_URL=ws://<LAN_IP>:3001
VITE_REST_URL=http://<LAN_IP>:3001
vite --host 0.0.0.0 --port 5173
```

### Desktop agent

`scripts/dev-local.sh` writes or patches `agent.toml` signaling URL:

```toml
[signaling]
url = "ws://192.168.1.42:3001"
```

Agent HTTP thumbnail server already binds `0.0.0.0:7700` per `desktop-agent/01`.

---

## Environment Variables

`testServer/.env.example`:

| Variable | Description |
|---|---|
| `PORT` | HTTP/WS port (default `3001`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `LAN_IP` | Optional override for advertised address |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint |
| `CLERK_ISSUER` | Clerk JWT issuer |
| `TABBYWEBRTC_JWT_SECRET` | HS256 secret for session tokens |
| `TURN_SECRET` | HMAC secret for TURN REST credentials |
| `TURN_URLS` | Comma-separated TURN URLs (e.g. `turn:localhost:3478`) |

Copy from `scripts/env.local.json.example` values where applicable.

---

## NestJS Structure

| Module | Responsibility |
|---|---|
| `AppModule` | Bootstrap, global config, CORS |
| `AuthModule` | `POST /auth/approve`, pending session lifecycle, `REFRESH_SESSION` |
| `AgentsModule` | `POST /agents/pair`, `GET /agents`, `AGENT_REGISTER`, `AGENT_HEARTBEAT` |
| `SignalingModule` | WebSocket gateway, SDP/ICE relay, subscribe/unsubscribe locks |
| `TurnModule` | `GET /turn-credentials` |
| `StorageModule` | In-memory stores (singleton providers) |

Use `@nestjs/websockets` with the `ws` adapter (not Socket.IO) so the wire protocol matches API Gateway WebSocket JSON frames.

---

## Dev Orchestration

Root `package.json` script:

```json
"dev:local": "bash scripts/dev-local.sh"
```

`scripts/dev-local.sh` starts three processes and tears them down on `Ctrl+C`:

1. **testServer** — `npm run start:dev --prefix testServer`
2. **frontend** — Vite on `0.0.0.0:5173` with LAN-prefixed `VITE_*` URLs
3. **desktop-agent** — `cargo run --manifest-path desktop-agent/Cargo.toml` with signaling URL set to `ws://<LAN_IP>:3001`

Prerequisites: Node 22+, Rust toolchain, `CLERK_PUBLISHABLE_KEY` in environment, `testServer/.env` populated.

Print a summary banner with URLs for desktop viewer and mobile PWA after all processes are up.

---

## Testing

| Level | Scope |
|---|---|
| Unit | JWT issue/verify, pending session TTL, source lock contention |
| Integration | WebSocket round-trip: browser connect → SESSION_PENDING → approve → AUTH_APPROVED → SUBSCRIBE → SDP relay |
| Manual E2E | `npm run dev:local` → open viewer on laptop, approve from phone on same Wi‑Fi, verify WebRTC stream |

---

## Relationship to Production Backend

```
Production                          Local test
──────────                          ──────────
API Gateway WebSocket        →      NestJS WebSocketGateway
API Gateway REST             →      NestJS controllers
DynamoDB                     →      In-memory Maps
Lambda handlers              →      Shared handler logic + DI adapters
SAM local (dev-backend.sh)   →      testServer (preferred for E2E)
```

`scripts/dev-backend.sh` remains for Lambda-focused development. `dev:local` is the recommended path for full-stack LAN testing.
