# Backend — Auth Service SDD

## Scope

Defines the complete authentication service: Clerk integration, QR session creation, mobile authorization endpoint, JWT issuance, agent pairing, and token validation middleware.

---

## Identity Provider: Clerk

- All user identity is managed by Clerk (free tier: 10,000 MAU).
- The mobile PWA integrates Clerk's mobile SDK for biometric-backed sign-in.
- Clerk issues a signed JWT after successful authentication.
- Backend validates Clerk JWTs using Clerk's JWKS endpoint (public key verification, no Clerk API calls at runtime).

### JWT Validation Middleware

Applied to all Lambda handlers that require authentication.

```ts
import * as jose from 'jose'

const JWKS = jose.createRemoteJWKSet(new URL(process.env.CLERK_JWKS_URL!))

export async function verifyClerkJwt(token: string): Promise<{ userId: string }> {
  const { payload } = await jose.jwtVerify(token, JWKS, {
    issuer: process.env.CLERK_ISSUER,
  })
  return { userId: payload.sub as string }
}
```

---

## QR Session Flow

### 1. Browser Opens WebSocket

Browser connects to API Gateway. Lambda `$connect` handler runs:

1. Creates a `pendingSessionId` (UUID v4).
2. Stores record in `pending-sessions`:
   ```ts
   {
     pendingSessionId: string
     connectionId: string          // API GW connection
     expiresAt: epochSeconds + 30  // 30 s TTL
     status: 'PENDING'
   }
   ```
3. Sends `SESSION_PENDING { pendingSessionId, expiresIn: 30 }` back to the browser.
4. Browser renders QR code from `pendingSessionId`.

### 2. QR Refresh

If the browser's countdown reaches 0 (after 28 s), the browser sends:

```ts
{ type: 'REFRESH_SESSION' }
```

Lambda:

1. Deletes the old `pendingSessionId` record.
2. Generates a new `pendingSessionId`.
3. Sends `SESSION_PENDING` with the new ID.

### 3. Mobile Scans QR

Mobile app decodes the QR → extracts `pendingSessionId`. Mobile sends an HTTPS POST to the signaling Lambda (via REST API Gateway or direct Lambda URL):

```
POST /auth/approve
Content-Type: application/json
Authorization: Bearer <clerkJwt>

{
  "pendingSessionId": "...",
  "agentId": "..."
}
```

Lambda `auth-handler`:

1. Verifies `clerkJwt` → extracts `userId`.
2. Looks up `pendingSessionId` in DynamoDB. Returns 404 if not found or expired.
3. Validates that `agentId` belongs to `userId` (checks `agents` table).
4. Deletes `pendingSessionId` record (single-use invalidation).
5. Issues a TabbyWebRTC session JWT (see below).
6. Sends `AUTH_APPROVED { token, agentId }` to the browser's `connectionId` via API GW Management API.

---

## TabbyWebRTC Session JWT

Issued by the `auth-handler` Lambda after successful mobile authorization. Signed with a symmetric HS256 secret stored in AWS Secrets Manager.

```ts
interface TabbyWebRTCTokenPayload {
  sub: string           // userId (from Clerk)
  agentId: string
  iat: number
  exp: number           // iat + 28800 (8 hours)
  iss: 'tabbywebrtc'
}
```

Signing:

```ts
import * as jose from 'jose'

const secret = new TextEncoder().encode(process.env.TABBYWEBRTC_JWT_SECRET!)

const token = await new jose.SignJWT({ agentId })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(userId)
  .setIssuer('tabbywebrtc')
  .setIssuedAt()
  .setExpirationTime('8h')
  .sign(secret)
```

### Token Validation

Applied by all Lambda handlers that receive REST or WebSocket messages requiring auth:

```ts
export async function verifyTabbyWebRTCToken(token: string): Promise<TabbyWebRTCTokenPayload> {
  const secret = new TextEncoder().encode(process.env.TABBYWEBRTC_JWT_SECRET!)
  const { payload } = await jose.jwtVerify(token, secret, {
    issuer: 'tabbywebrtc',
  })
  return payload as TabbyWebRTCTokenPayload
}
```

---

## Agent JWT

Desktop Agent receives its own JWT at the end of the one-time pairing flow. Agent JWT payload:

```ts
interface AgentTokenPayload {
  sub: string           // agentId
  userId: string
  iat: number
  exp: number           // iat + 86400 * 365 (1 year, refreshed on heartbeat)
  iss: 'tabbywebrtc-agent'
}
```

Agent stores this JWT locally (secure OS keychain). It sends this JWT in the `Authorization` header when opening the WebSocket connection.

---

## One-Time Agent Pairing Endpoint

```
POST /agents/pair
Content-Type: application/json
Authorization: Bearer <clerkJwt>

{
  "agentId": "...",
  "publicKey": "<base64-encoded Ed25519 public key>",
  "platform": "linux",
  "name": "Home Desktop"
}
```

Lambda:

1. Verifies Clerk JWT.
2. Stores agent record in `agents` table.
3. Issues an Agent JWT (1-year TTL, refreshed on heartbeat).
4. Returns `{ agentJwt: string }`.

---

## Agent List Endpoint

```
GET /agents
Authorization: Bearer <tabbyRDPToken>
```

Lambda:

1. Validates TabbyWebRTC token → extracts `userId`.
2. Queries `agents` table by `userId` GSI.
3. Returns online/offline status, name, platform for each agent.

```ts
interface AgentListResponse {
  agents: {
    id: string
    name: string
    platform: 'windows' | 'macos' | 'linux'
    online: boolean
    lastSeen: string
  }[]
}
```

---

## Security Edge Cases

| Scenario | Mitigation |
|---|---|
| Attacker captures QR code image | `pendingSessionId` is single-use and expires in 30 s; phone biometric is required |
| Replay attack with old JWT | JWT has short expiry (8h); `jti` nonce added for future revocation support |
| MitM on signaling server | Session salt encrypted with agent's Ed25519 public key; agent verifies before enabling input channel |
| Agent JWT theft | Agent JWT is stored in OS keychain; rotation triggered by re-pairing |
