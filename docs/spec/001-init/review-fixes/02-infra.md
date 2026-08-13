# Review Fixes — Infra / Backend

## Scope

Remediation for signaling, auth, CORS, secrets, and update-distribution issues in `components/infra` and parity in `components/testServer`.

Related original specs: `backend/02-signaling-server.md`, `backend/03-aws-infra.md`, `backend/04-auth-service.md`, `backend/05-update-distribution.md`.

---

## INF-01 — SDP_OFFER Is Unauthenticated (critical / security)

### Problem

`handleSdpOffer` relays to `targetConnectionId` with no check that the sender is the agent owning the source lock / session.

### Required Fix

1. Load connection for sender; require `clientType === 'agent'`.
2. Require `connection.agentId` matches the agent on the source lock for `message.sourceId` (or explicit tab mapping).
3. Reject offers targeting connections not subscribed to that agent/source.
4. Mirror checks in testServer.

### Acceptance

- Unauthenticated or browser WS cannot inject `SDP_OFFER` to another connection.
- Unit test: foreign connectionId → 403 / handler error, no relay.

---

## INF-02 — AGENT_REGISTER Ignores JWT-Bound agentId (critical / security)

### Problem

Connect stores `agentId` from agent JWT `sub`, but `handleAgentRegister` upserts with `message.agentId` and overwrites the connection record.

### Required Fix

1. Ignore `message.agentId` for identity; use `connection.agentId` from JWT at connect.
2. If message includes `agentId`, require equality with `connection.agentId` or reject.
3. Same for `AGENT_HEARTBEAT`.

### Acceptance

- Agent cannot register under a different agentId than its JWT `sub`.
- Unit test covers mismatch rejection.

---

## INF-03 — Pending Session Expiry Not Enforced (high / security)

### Problem

`expiresAt` is written; `getPendingSession` never checks it. DynamoDB TTL is eventual. Stale IDs remain approvable. testServer enforces expiry; Lambda does not.

### Required Fix

1. In `getPendingSession` / `handleAuthApprove`: if `expiresAt <= now`, delete and return 404.
2. Optionally emit `SESSION_EXPIRED` to the browser connection when refresh finds an expired session (see INF-09).

### Acceptance

- Approve after 30s+ without refresh returns 404.
- Lambda and testServer behavior match.

---

## INF-04 — 365-Day Agent JWT With No Revocation (high / security)

### Problem

Agent JWTs are HS256, 365d, `jti` unused. Stolen keychain token = year-long access.

### Required Fix (minimum)

1. Store `jti` (or token version) on the agent record at pair time.
2. On agent WS connect, verify JWT `jti`/version matches agent record.
3. Add `POST /agents/{id}/revoke` (Clerk-auth): bump version / invalidate jti → existing connections disconnect.

Optional: shorten TTL + refresh via re-pair or rotate endpoint.

### Acceptance

- Revoked agent JWT fails `$connect`.
- Mobile can revoke a paired agent and force re-pair.

---

## INF-05 — Open CORS + No Rate Limits (high / security)

### Problem

REST API uses `Cors.ALL_ORIGINS`. No API Gateway throttle / WAF.

### Required Fix

1. Restrict CORS `allowOrigins` to web app domains (dev + prod).
2. Add API Gateway stage throttling (burst + rate) on REST and consider WebSocket message limits.
3. Document limits in stack outputs / ops notes.

### Acceptance

- Cross-origin browser from arbitrary origin cannot call REST with credentials/headers successfully under browser CORS rules.
- Throttle config present in CDK synth.

---

## INF-06 — UNSUBSCRIBE and ICE Paths Under-Authenticated (medium / security)

### Problem

`UNSUBSCRIBE` only checks lock `tabId` match; no session token. Browser `SDP_ANSWER` / `ICE_CANDIDATE` rely on lock routing without re-validating connection token.

### Required Fix

1. Call `requireValidSessionToken` on `UNSUBSCRIBE` for browser clients.
2. For browser `SDP_ANSWER` / `ICE_CANDIDATE`, require valid session token and that `connectionId` owns the lock.
3. For agent ICE, require `clientType === 'agent'` and agentId match.

### Acceptance

- Foreign browser connection cannot UNSUBSCRIBE or inject ICE for another tab's lock.

---

## INF-07 — Update Downloads Fully Public (medium / security)

### Problem

`GET /updates/manifest.json` and `GET /downloads/{platform}` are `AuthorizationType.NONE`. No code signing.

### Required Fix

- Document as intentional for public installers, **or**
- Gate downloads behind auth / signed URL for private channels.
- Track signing/notarization under cicd blockers (out of band).

### Acceptance

- Decision recorded; if private, unauthenticated download returns 401.

---

## INF-08 — Secrets in Lambda Env (medium / gap)

### Problem

JWT secret, R2, TURN, Clerk config are plaintext Lambda env vars. Spec mentioned Secrets Manager.

### Required Fix

1. Store secrets in AWS Secrets Manager (or SSM SecureString).
2. Lambda reads at cold start / via extension; IAM grants `secretsmanager:GetSecretValue`.
3. Update `rotate-secrets.sh` to rotate SM + redeploy or refresh.

### Acceptance

- `lambda:GetFunctionConfiguration` does not expose raw JWT/R2/TURN secrets.
- Deploy docs updated.

---

## INF-09 — No SESSION_EXPIRED From Production Lambda (low / gap)

### Problem

Frontend handles `SESSION_EXPIRED`; production never sends it when pending TTL elapses.

### Required Fix

On `REFRESH_SESSION` or a lightweight check: if pending session expired, send `SESSION_EXPIRED` and create a new pending session (or require client to reconnect).

### Acceptance

- Browser receives `SESSION_EXPIRED` when pending ID is past `expiresAt` without refresh.
