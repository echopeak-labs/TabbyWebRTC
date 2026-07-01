# Backend — Architecture SDD

## Scope

Defines the complete serverless backend architecture: control plane, data plane, service boundaries, cost model, and runtime environment. This is the authoritative reference for all backend AWS and Cloudflare resources.

---

## Critical Design Principle: AWS Never Carries Video

**AWS only carries signaling** — the SDP offer/answer and ICE candidates exchanged once at connection setup time. This is a few kilobytes of JSON. Once the WebRTC `RTCPeerConnection` is established, all H.264 video, audio, and input data channel traffic flows **directly** between the browser and the desktop agent over the best available network path. AWS never sees a single byte of the stream.

This is identical to how [PairDrop](https://pairdrop.net) works: a lightweight server brokers the initial peer introduction, then all data is P2P. The server's job ends the moment the connection is made.

---

## Unified Product: Local + Remote

TabbyWebRTC supports **both** scenarios with the **same user flow**. The viewer never picks "LAN mode" vs "remote mode" — they always scan a QR code with their phone and approve. The system picks the fastest path after auth.

| Scenario | Where viewer is | Where agent is | Auth | Signaling | Video path |
|---|---|---|---|---|---|
| **At home (LAN)** | Upstairs in bed (tablet/laptop) | Downstairs desktop, same Wi‑Fi | QR + phone (same as remote) | Prefer local WS if reachable | WebRTC P2P over LAN (low latency, no internet) |
| **Away (WAN)** | Airport / library / office | Home desktop, different network | QR + phone | AWS WebSocket | WebRTC P2P over internet, or TURN if NAT blocks direct P2P |

The home agent is **always** registered with AWS (persistent WebSocket + heartbeat) so remote sessions work. The agent **also** runs the local server on port 7700 so LAN sessions can skip cloud signaling when possible.

---

## Two Connection Paths (Auto-Selected After Auth)

Auth is identical in both cases. Only the **signaling channel** and **ICE candidate set** differ after `AUTH_APPROVED`.

```
PATH A — LAN (Same Network)
─────────────────────────────
Browser Tab ──── WS ws://192.168.x.x:7700/signal ────► Desktop Agent
                 (local signaling — optional optimization)
Browser Tab ◄═══════════════════════════════════════► Desktop Agent
                 WebRTC P2P, host/srflx candidates on LAN
                 H.264 + input data channel stay on local network


PATH B — WAN (Remote)
─────────────────────
Browser Tab ──── WSS wss://signal.tabbywebrtc.com ────► AWS API GW ◄──► Desktop Agent
                 SDP + ICE only (setup, few KB)

Browser Tab ◄═══════════════════════════════════════► Desktop Agent
                 WebRTC P2P over internet, or TURN relay if needed
                 AWS never carries video bytes
```

### Path Selection (Automatic, Not a User Mode)

After mobile approves the session, the desktop viewer runs **path negotiation**:

1. **Always** receive `AUTH_APPROVED { token, agentId, localEndpoint? }` over AWS WebSocket (auth always uses cloud — works at airport and at home).
2. If `localEndpoint` is present **and** a probe to `GET <localEndpoint>/info` succeeds within 2 s → use **Path A** for WebRTC signaling (local WS). Mark connection badge **LAN**.
3. Otherwise → use **Path B** (AWS signaling for SDP/ICE). Mark connection badge **WAN**.
4. WebRTC ICE gathers **both** host (LAN) and srflx/relay (WAN) candidates; the browser and agent prefer the path that completes first with the lowest RTT.

`localEndpoint` is included when any of these is true at approval time:

- Mobile key device is on the same LAN as the agent and relays `{ url, localToken }` in `POST /auth/approve`.
- Agent registered its current LAN IP with AWS in `AGENT_REGISTER` / heartbeat and Lambda attaches it to `AUTH_APPROVED` when the viewer's IP is in the same /24 (best-effort; not required for LAN-only discovery).
- Viewer discovers the agent via mDNS on `ConnectPage` before or during auth (see below).

**Manual fallback:** ConnectPage may show discovered LAN agents under "Nearby on this network" for users who want to connect without phone auth on a trusted home LAN only. That is optional and secondary — the primary flow remains QR + phone everywhere.

### Example Flows

**Airport → home desktop**

1. User opens TabbyWebRTC on a library PC → QR appears.
2. Phone scans QR → Face ID → picks "Home Desktop" → Approve.
3. No `localEndpoint` (different network). Path B. AWS relays SDP/ICE.
4. WebRTC connects over internet; TURN used if home router blocks inbound UDP.
5. User streams display from home machine.

**Bedroom → downstairs desktop (same house)**

1. User opens TabbyWebRTC on tablet → same QR flow (or token cloned from another tab).
2. Phone on same Wi‑Fi scans → Approve. Mobile includes agent's LAN URL in approve payload.
3. Viewer probes `192.168.1.42:7700` → success. Path A for signaling.
4. WebRTC uses LAN host candidates → sub‑5 ms latency, no cloud bandwidth for video.
5. If local probe fails (guest Wi‑Fi isolation), falls back to Path B automatically.

---

## Path A — Local Network Architecture (No AWS)

The desktop agent's local HTTP server (port 7700) doubles as a local WebSocket signaling endpoint.

```
Desktop Agent local server (port 7700):
  GET  /thumbnail/<sourceId>     → JPEG thumbnail
  GET  /sources                  → list of displays + apps
  WS   /signal                   → local WebSocket signaling (SDP/ICE relay)
  GET  /info                     → { agentId, name, platform, version }
```

### Local Signaling Auth (Path A Only)

Path A does **not** skip identity checks — it only skips **AWS for SDP/ICE**. The viewer must already hold a valid TabbyWebRTC JWT from the QR approval (Path B auth step). The local WebSocket upgrade requires:

- `Authorization: Bearer <tabbyRDP JWT>`, or
- `X-Local-Token: <localToken>` from `AUTH_APPROVED.localEndpoint` (HMAC, 60 s TTL)

This blocks random LAN devices from streaming without going through phone approval first.

```ts
interface AuthApprovedMessage {
  type: 'AUTH_APPROVED'
  token: string
  agentId: string
  localEndpoint?: {
    url: string
    localToken: string
  }
}
```

When `localEndpoint` is present and reachable, `signal-client.ts` opens a second connection to local WS for WebRTC setup while keeping the AWS socket for session lifecycle (or closes AWS after LAN path is established).

### LAN Discovery via mDNS

The desktop agent advertises itself on the local network using mDNS (multicast DNS). Service name: `_tabbywebrtc._tcp.local`.

```
Service record:
  name:    <agentName>._tabbywebrtc._tcp.local
  port:    7700
  txt:     agentId=<uuid> version=1 platform=linux
```

The mobile app can discover agents on the LAN using the browser's mDNS API (limited support — fallback to manual IP entry). The `ConnectPage` "Connect on local network" section shows a list of mDNS-discovered agents automatically when available.

---

## Path B — WAN Architecture (AWS Signaling)

```
[Browser / Mobile App]
        |
        | WSS (TLS 1.3)
        v
[AWS API Gateway — WebSocket API]
        |
        |---> [Lambda: $connect]       — registers connectionId
        |---> [Lambda: $disconnect]    — deregisters connectionId
        |---> [Lambda: $default]       — routes messages to handlers
        |
        +---> [Lambda: auth-handler]   — processes QR scan approval from mobile
        +---> [Lambda: signal-handler] — routes SDP / ICE between browser <-> agent
        +---> [Lambda: agent-handler]  — manages agent registration / heartbeat
        |
        v
[DynamoDB]
  - Table: connections    (connectionId, type[browser|agent], userId, agentId, TTL)
  - Table: pending-sessions (pendingSessionId, connectionId, expiresAt)
  - Table: agents         (agentId, userId, publicKey, lastSeen, online)

[Cloudflare Pages]  — hosts static frontend build

[CoTURN VPS] — TURN relay ONLY for WAN users behind symmetric NAT
              (Hetzner/OVH ~$5/month)
              Used only when direct P2P fails ICE negotiation
```

---

## Service Responsibilities

### API Gateway WebSocket

- Single endpoint: `wss://signal.tabbywebrtc.com`
- Routes: `$connect`, `$disconnect`, `$default`
- Passes `connectionId` to all Lambda invocations.
- Max message size: 128 KB (sufficient for SDP offers; typical SDP ~4 KB).
- Idle connection timeout: 10 minutes (API GW default). Desktop Agent sends a ping every 9 minutes to maintain connection.

### Lambda Functions

All Lambdas: Node.js 22.x runtime, ARM64 (Graviton2), 128 MB memory.

| Function | Handler File | Trigger | Avg Duration |
|---|---|---|---|
| `ws-connect` | `connect.ts` | `$connect` route | < 10 ms |
| `ws-disconnect` | `disconnect.ts` | `$disconnect` route | < 15 ms |
| `ws-default` | `router.ts` | `$default` route | < 20 ms |
| `auth-handler` | `auth.ts` | `$default` → type=AUTH | < 50 ms |
| `signal-handler` | `signal.ts` | `$default` → type=SDP/ICE | < 15 ms |
| `agent-handler` | `agent.ts` | `$default` → type=AGENT | < 20 ms |
| `turn-credentials` | `turn.ts` | HTTP GET (REST API) | < 10 ms |

### DynamoDB

- `connections` table: primary key `connectionId`. GSI on `userId` and `agentId`.
- `pending-sessions` table: primary key `pendingSessionId`. TTL attribute `expiresAt` (30 s default).
- `agents` table: primary key `agentId`. GSI on `userId`.
- All tables: PAY_PER_REQUEST billing. Strongly consistent reads on critical paths only.

---

## Cost Model

### LAN Users (Path A) — $0/month, always

LAN users never touch AWS or TURN. Zero cloud cost regardless of hours streamed, resolution, or number of users. All traffic stays on the local network.

### WAN Users (Path B) — $0–$5/month

| Service | Free Tier | Projected Monthly Usage | Cost |
|---|---|---|---|
| API GW WebSocket | 1M connection-minutes + 1M messages | ~150K conn-min, ~500K msgs (signaling only) | $0 |
| Lambda | 1M invocations + 400K GB-s | ~100K invocations | $0 |
| DynamoDB | 25 GB storage + 200M req | < 1 GB, < 1M req | $0 |
| Cloudflare Pages | Unlimited static | Static hosting | $0 |
| CoTURN VPS | N/A | 1 Hetzner CX22 (~20% of WAN users need TURN) | ~$5/mo |
| STUN (Google) | Public | N/A | $0 |

Total WAN: ~$0/month for users with standard NAT (direct P2P). ~$5/month flat for the TURN server shared across all users who need relay.

**AWS data egress cost for video: $0.** AWS never carries video bytes in either path.

---

## Message Routing Architecture

The `ws-default` handler reads the `type` field from the WebSocket message and dispatches to the appropriate sub-handler module. All sub-handlers share a single Lambda deployment package.

```ts
type InboundWSMessage =
  | { type: 'AUTH_APPROVE'; pendingSessionId: string; clerkJwt: string; agentId: string }
  | { type: 'AGENT_REGISTER'; agentId: string; publicKey: string; platform: string }
  | { type: 'AGENT_HEARTBEAT'; agentId: string }
  | { type: 'SUBSCRIBE'; sourceId: string; tabId: string }
  | { type: 'UNSUBSCRIBE'; sourceId: string; tabId: string }
  | { type: 'SDP_OFFER'; sourceId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'SDP_ANSWER'; sourceId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; sourceId: string; candidate: RTCIceCandidateInit }
```

---

## Security Boundaries

- All Lambda functions validate the Clerk JWT on every privileged operation using Clerk's public JWKS endpoint.
- `pending-sessions` records are single-use: deleted immediately after `AUTH_APPROVE` is processed.
- `connectionId` is treated as an opaque nonce — never returned to clients as a navigable resource.
- API Gateway enforces HTTPS/WSS — no plaintext connections.
- DynamoDB access uses IAM role attached to Lambda execution role (least-privilege, no wildcard).
- Agent-to-Lambda connection is authenticated via the agent's JWT issued at registration.

---

## Non-Functional Requirements

- All Lambda cold starts < 200 ms (ARM64 + minimal dependencies).
- DynamoDB single-digit ms P99 latency.
- API GW WebSocket connection limit: default 500 concurrent (sufficient for < 50 concurrent users; request increase via AWS support if needed).
- Backend code deployed via AWS CDK (see `03-aws-infra.md`).
