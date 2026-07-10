# Review Fixes — Task List

Checklist for `docs/spec-1/review-fixes/`. Work findings in priority order from `00-overview.md` unless blocked. Mark `[x]` when acceptance criteria in the domain spec are met.

---

## Wave 0 — Unblock WAN session (critical)

### FE-01 Auth WebSocket lifecycle
- [x] Migrate ConnectPage to persistent singleton `SignalClient` (or equivalent)
- [x] Stop disconnecting WS on navigate to `/launchpad` after `AUTH_APPROVED`
- [x] If reconnect needed: implement `BIND_SESSION` (or equivalent) to re-attach JWT to new `connectionId`
- [ ] Integration test: approve → launchpad → `SUBSCRIBE` without local agent HTTP

### DA-01 Pairing JWT delivery
- [x] Mobile pair flow reads `agentJwt` from `POST /agents/pair` response
- [x] Deliver JWT to agent `POST /pair` (LAN endpoint from QR / probe) or implement poll-claim alternative
- [x] Agent stores JWT and reaches signaling online without manual copy
- [ ] E2E: fresh agent pair → `AGENT_REGISTER`

### INF-01 Authenticate SDP_OFFER
- [x] Require sender `clientType === 'agent'`
- [x] Verify agent owns source lock / target subscription before relay
- [x] Mirror in testServer
- [x] Unit test: foreign offer rejected

### INF-02 Bind AGENT_REGISTER to JWT
- [x] Use `connection.agentId` from JWT; reject mismatched `message.agentId`
- [x] Same check on `AGENT_HEARTBEAT`
- [x] Unit test: identity mismatch rejected

---

## Wave 1 — WAN launchpad + session hygiene (high)

### FE-02 REQUEST_SOURCES / AGENT_SOURCES
- [x] Implement Lambda + testServer handler **or** push sources on register to browsers
- [x] Frontend populates launchpad on WAN-only path
- [x] Types aligned in `signaling.ts`

### FE-03 401 / session clear
- [x] Central REST helper clears sessionStorage + authStore + redirect `/` on 401
- [x] WS auth failures use same clear path
- [ ] Manual verify with expired token

### INF-03 Pending session expiry
- [x] `getPendingSession` / approve rejects when `expiresAt <= now`
- [x] Delete stale record on read
- [x] Parity with testServer

### INF-04 Agent JWT revocation
- [x] Persist `jti` or token version on agent record at pair
- [x] Validate on agent `$connect`
- [x] `POST /agents/{id}/revoke` (Clerk) invalidates and disconnects

### INF-05 CORS + rate limits
- [x] Restrict REST CORS to web app origins
- [x] Add API Gateway throttling in CDK
- [x] Verify via `cdk synth`

### DA-02 Local HTTP auth
- [x] Require HMAC `local_token` on `/sources`, `/thumbnail/:id`, `/signal`
- [x] Frontend LAN probe passes token from `/info`
- [x] Default bind `127.0.0.1` or document LAN opt-in
- [x] Unauthenticated `/sources` → 401

### DA-03 Input / power consent
- [x] Default-deny or confirm remote `SHUTDOWN` / `RESTART`
- [x] Config or local toggle for input enable
- [x] Document agent trust model

### DA-04 Auto-update client
- [x] Implement tasks under `desktop-agent/05-auto-update.md` / `tasks.md` section
- [x] SHA-256 verify before install
- [x] Idle-gate while peers active

---

## Wave 2 — Hardening + completeness (medium)

### INF-06 UNSUBSCRIBE / ICE auth
- [x] `requireValidSessionToken` on browser `UNSUBSCRIBE`
- [x] Browser SDP_ANSWER / ICE require token + lock ownership
- [x] Agent ICE requires agent clientType + agentId match

### INF-07 Update download policy
- [x] Record public vs private decision
- [x] If private: auth or signed URLs on download routes

### INF-08 Secrets Manager
- [x] Move JWT / R2 / TURN / Clerk secrets to Secrets Manager (or SSM SecureString)
- [x] Lambda IAM + load at runtime
- [x] Update `rotate-secrets.sh`

### DA-05 Ed25519 / encryptedSalt E2E
- [x] Backend accepts and uses `encryptedSalt` on approve
- [x] Agent proves key possession before accepting stream/input
- [x] Feature-flagged rejection path

### DA-06 Release capture features
- [x] Enable `scap-capture` in release CI matrix
- [x] Fail or warn if release binary lacks real capture
- [x] Decide hardware-encode wiring

### DA-07 Agent TURN
- [x] Fetch TURN credentials for agent (REST or via NOTIFY)
- [x] Pass into `start_peer_stack` ICE config
- [ ] Strict-NAT relay smoke test

### FE-04 Agent switch clears session
- [x] TopBar switch clears JWT / sessionStorage before re-auth
- [x] No SUBSCRIBE with previous agentId token

### FE-05 Bitrate cap
- [x] Remove no-op UI **or** implement agent-side bitrate command + wire control bar

---

## Wave 3 — Polish (low)

### FE-06 CSP / security headers
- [x] CloudFront (or equivalent) CSP + frame denial for SPA

### FE-07 Local network modal
- [x] Wire IP modal to probe `:7700/info` + authenticated sources

### DA-08 Pairing /pair challenge
- [x] One-time code, localhost-only bind, or signed nonce on `POST /pair`

### INF-09 SESSION_EXPIRED from Lambda
- [x] Emit `SESSION_EXPIRED` when pending TTL elapsed without refresh

---

## Tracking

| Wave | Finding IDs |
|---|---|
| 0 | FE-01, DA-01, INF-01, INF-02 |
| 1 | FE-02, FE-03, INF-03, INF-04, INF-05, DA-02, DA-03, DA-04 |
| 2 | INF-06, INF-07, INF-08, DA-05, DA-06, DA-07, FE-04, FE-05 |
| 3 | FE-06, FE-07, DA-08, INF-09 |

When a finding is fully done, check all its tasks above and note completion in any PR description with the finding ID.
