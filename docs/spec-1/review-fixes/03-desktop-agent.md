# Review Fixes — Desktop Agent

## Scope

Remediation for pairing, local HTTP, input trust, capture defaults, TURN, crypto, and auto-update gaps in `components/desktop-agent`. Some items require frontend/infra changes called out explicitly.

Related original specs: `desktop-agent/01-overview.md` through `05-auto-update.md`, `frontend/02-auth-session.md`, `backend/04-auth-service.md`, `backend/05-update-distribution.md`.

---

## DA-01 — Pairing JWT Never Reaches the Agent (critical / logic)

### Problem

Agent waits for `POST http://{agent}:7700/pair` with `{ token: agentJwt }`. Mobile `MobileScanPage` calls `POST /agents/pair`, stores Clerk metadata, and navigates away — never reads `agentJwt` or POSTs to the agent.

### Required Fix

1. `POST /agents/pair` response must include `agentJwt` (already does).
2. Mobile pair flow must deliver JWT to the agent:
   - Prefer: after pair, prompt user / auto-try LAN endpoints from QR (`localEndpoint` if present) → `POST {local}/pair` with token.
   - Or: agent polls a short-lived pairing claim from REST (new endpoint) using public key proof.
3. On success, agent stores JWT in keychain and continues (prefer auto-continue without mandatory process exit).

### Acceptance

- Fresh agent with no JWT completes pairing via mobile QR and comes online on signaling without manual token copy.
- E2E: pair → agent `AGENT_REGISTER` visible in backend.

---

## DA-02 — Local HTTP Server Open on LAN (high / security)

### Problem

Binds `0.0.0.0:7700`, permissive CORS. `/sources` and `/thumbnail/:id` unauthenticated. `local_token` from `/info` never validated. `/signal` is echo-only.

### Required Fix

1. Require `Authorization: Bearer {local_token}` (or query) on `/sources`, `/thumbnail/:id`, and `/signal`.
2. Validate HMAC window token from `/info` (current + previous minute window).
3. Restrict CORS to known web origins (or reflect only after token check).
4. Prefer bind `127.0.0.1` by default; document opt-in `0.0.0.0` for LAN.
5. Implement real LAN `/signal` per original spec or remove the route until ready.

### Acceptance

- Unauthenticated GET `/sources` returns 401.
- Frontend LAN probe uses token from `/info` for subsequent calls.

---

## DA-03 — Full Input + Power Commands Without Agent Consent (high / security)

### Problem

Any peer that completes WebRTC after `NOTIFY_SUBSCRIBER` gets keyboard, mouse, clipboard, and SHUTDOWN/RESTART/LOCK. Agent does not verify session locally.

### Required Fix

1. Treat signaling as necessary but not sufficient: optionally require a short-lived session claim in `NOTIFY_SUBSCRIBER` (or first data-channel auth message) verified with agent public/private crypto (ties to DA-05).
2. Gate destructive commands (`SHUTDOWN`, `RESTART`) behind local confirmation or a config flag `allow_remote_power: false` default.
3. Allow `input_enabled: false` until user toggles on agent tray/CLI (minimum viable consent).

### Acceptance

- Default install cannot remote-shutdown without explicit local allow.
- Document trust model in agent overview.

---

## DA-04 — Auto-Update Client Not Started (high / gap)

### Problem

`desktop-agent/05-auto-update.md` is `not-started`. Backend manifest + R2 exist.

### Required Fix

Implement `updater.rs` per `desktop-agent/05-auto-update.md`: poll, semver compare, SHA-256 verify, idle-gated silent install, restart.

### Acceptance

- Agent with `updates.enabled = true` upgrades from a lower version when manifest points to a newer artifact.
- Bad SHA-256 aborts install.

---

## DA-05 — Ed25519 Pairing Crypto Unused (medium / gap)

### Problem

Agent generates Ed25519 keys; mobile sends `encryptedSalt` on approve; backend ignores it. No challenge/response.

### Required Fix

1. Backend `POST /auth/approve` accepts and stores/forwards `encryptedSalt` (or decrypt path as designed).
2. Define verification: agent decrypts salt with private key and proves possession during session bind / first WebRTC message.
3. Reject sessions that fail proof when crypto path is enabled.

### Acceptance

- Approve without valid ciphertext fails when feature flag on.
- Agent refuses stream if proof missing/invalid.

---

## DA-06 — Default Release Builds Lack Real Capture (medium / gap)

### Problem

`scap-capture` off by default; CI `cargo build --release` serves synthetic frames.

### Required Fix

1. Enable `scap-capture` (and platform deps) in release CI matrix.
2. Fail packaging if binary was built without capture feature (compile-time flag or runtime self-check in release profile).
3. Wire or explicitly defer hardware encode in release notes/tasks.

### Acceptance

- Release artifacts capture a real display on Linux CI smoke (or documented manual gate).
- Synthetic capture only in debug/dev feature set.

---

## DA-07 — Agent Has No TURN Credentials (medium / gap)

### Problem

Browser fetches TURN; agent `start_peer_stack(..., None)` — STUN only.

### Required Fix

1. At agent startup (or on first peer), obtain TURN credentials:
   - Agent-authenticated REST endpoint, **or**
   - Include time-limited TURN in signaling `NOTIFY_SUBSCRIBER`.
2. Pass TURN into WebRTC ICE config symmetrically with browser.

### Acceptance

- Agent PeerConnection includes TURN URLs when configured.
- Strict-NAT E2E can connect via relay.

---

## DA-08 — Pairing POST /pair Accepts Any LAN Client (low / logic)

### Problem

During pairing window, any host that can reach `:7700` can POST a token.

### Required Fix

1. Require pairing challenge: agent displays one-time code; POST body must include code, **or**
2. Bind pair listener to `127.0.0.1` only and require mobile to use a same-machine bridge / USB / manual paste for airgap, **or**
3. Verify POST includes signature over agent-generated nonce with the pairing public key flow from the QR.

### Acceptance

- Random LAN POST without challenge/nonce is rejected.
