# Review Fixes — Task List

Checklist for `docs/spec-1/review-fixes/`. Work findings in priority order from `00-overview.md` unless blocked. Mark `[x]` when acceptance criteria in the domain spec are met.

---

## Wave 0 — Unblock WAN session (critical)

### FE-01 Auth WebSocket lifecycle
- [ ] Migrate ConnectPage to persistent singleton `SignalClient` (or equivalent)
- [ ] Stop disconnecting WS on navigate to `/launchpad` after `AUTH_APPROVED`
- [ ] If reconnect needed: implement `BIND_SESSION` (or equivalent) to re-attach JWT to new `connectionId`
- [ ] Integration test: approve → launchpad → `SUBSCRIBE` without local agent HTTP

### DA-01 Pairing JWT delivery
- [ ] Mobile pair flow reads `agentJwt` from `POST /agents/pair` response
- [ ] Deliver JWT to agent `POST /pair` (LAN endpoint from QR / probe) or implement poll-claim alternative
- [ ] Agent stores JWT and reaches signaling online without manual copy
- [ ] E2E: fresh agent pair → `AGENT_REGISTER`

### INF-01 Authenticate SDP_OFFER
- [ ] Require sender `clientType === 'agent'`
- [ ] Verify agent owns source lock / target subscription before relay
- [ ] Mirror in testServer
- [ ] Unit test: foreign offer rejected

### INF-02 Bind AGENT_REGISTER to JWT
- [ ] Use `connection.agentId` from JWT; reject mismatched `message.agentId`
- [ ] Same check on `AGENT_HEARTBEAT`
- [ ] Unit test: identity mismatch rejected

---

## Wave 1 — WAN launchpad + session hygiene (high)

### FE-02 REQUEST_SOURCES / AGENT_SOURCES
- [ ] Implement Lambda + testServer handler **or** push sources on register to browsers
- [ ] Frontend populates launchpad on WAN-only path
- [ ] Types aligned in `signaling.ts`

### FE-03 401 / session clear
- [ ] Central REST helper clears sessionStorage + authStore + redirect `/` on 401
- [ ] WS auth failures use same clear path
- [ ] Manual verify with expired token

### INF-03 Pending session expiry
- [ ] `getPendingSession` / approve rejects when `expiresAt <= now`
- [ ] Delete stale record on read
- [ ] Parity with testServer

### INF-04 Agent JWT revocation
- [ ] Persist `jti` or token version on agent record at pair
- [ ] Validate on agent `$connect`
- [ ] `POST /agents/{id}/revoke` (Clerk) invalidates and disconnects

### INF-05 CORS + rate limits
- [ ] Restrict REST CORS to web app origins
- [ ] Add API Gateway throttling in CDK
- [ ] Verify via `cdk synth`

### DA-02 Local HTTP auth
- [ ] Require HMAC `local_token` on `/sources`, `/thumbnail/:id`, `/signal`
- [ ] Frontend LAN probe passes token from `/info`
- [ ] Default bind `127.0.0.1` or document LAN opt-in
- [ ] Unauthenticated `/sources` → 401

### DA-03 Input / power consent
- [ ] Default-deny or confirm remote `SHUTDOWN` / `RESTART`
- [ ] Config or local toggle for input enable
- [ ] Document agent trust model

### DA-04 Auto-update client
- [ ] Implement tasks under `desktop-agent/05-auto-update.md` / `tasks.md` section
- [ ] SHA-256 verify before install
- [ ] Idle-gate while peers active

---

## Wave 2 — Hardening + completeness (medium)

### INF-06 UNSUBSCRIBE / ICE auth
- [ ] `requireValidSessionToken` on browser `UNSUBSCRIBE`
- [ ] Browser SDP_ANSWER / ICE require token + lock ownership
- [ ] Agent ICE requires agent clientType + agentId match

### INF-07 Update download policy
- [ ] Record public vs private decision
- [ ] If private: auth or signed URLs on download routes

### INF-08 Secrets Manager
- [ ] Move JWT / R2 / TURN / Clerk secrets to Secrets Manager (or SSM SecureString)
- [ ] Lambda IAM + load at runtime
- [ ] Update `rotate-secrets.sh`

### DA-05 Ed25519 / encryptedSalt E2E
- [ ] Backend accepts and uses `encryptedSalt` on approve
- [ ] Agent proves key possession before accepting stream/input
- [ ] Feature-flagged rejection path

### DA-06 Release capture features
- [ ] Enable `scap-capture` in release CI matrix
- [ ] Fail or warn if release binary lacks real capture
- [ ] Decide hardware-encode wiring

### DA-07 Agent TURN
- [ ] Fetch TURN credentials for agent (REST or via NOTIFY)
- [ ] Pass into `start_peer_stack` ICE config
- [ ] Strict-NAT relay smoke test

### FE-04 Agent switch clears session
- [ ] TopBar switch clears JWT / sessionStorage before re-auth
- [ ] No SUBSCRIBE with previous agentId token

### FE-05 Bitrate cap
- [ ] Remove no-op UI **or** implement agent-side bitrate command + wire control bar

---

## Wave 3 — Polish (low)

### FE-06 CSP / security headers
- [ ] CloudFront (or equivalent) CSP + frame denial for SPA

### FE-07 Local network modal
- [ ] Wire IP modal to probe `:7700/info` + authenticated sources

### DA-08 Pairing /pair challenge
- [ ] One-time code, localhost-only bind, or signed nonce on `POST /pair`

### INF-09 SESSION_EXPIRED from Lambda
- [ ] Emit `SESSION_EXPIRED` when pending TTL elapsed without refresh

---

## Tracking

| Wave | Finding IDs |
|---|---|
| 0 | FE-01, DA-01, INF-01, INF-02 |
| 1 | FE-02, FE-03, INF-03, INF-04, INF-05, DA-02, DA-03, DA-04 |
| 2 | INF-06, INF-07, INF-08, DA-05, DA-06, DA-07, FE-04, FE-05 |
| 3 | FE-06, FE-07, DA-08, INF-09 |

When a finding is fully done, check all its tasks above and note completion in any PR description with the finding ID.
