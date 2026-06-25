# Backend — Signaling Server SDD

## Scope

Defines the WebSocket signaling layer: connection lifecycle, message routing, SDP/ICE relay, source subscription management, and agent registration.

---

## Connection Lifecycle

### `$connect` Handler

Triggered when any client (browser tab or desktop agent) opens a WebSocket.

```ts
async function onConnect(connectionId: string, queryParams: Record<string, string>) {
  const clientType = queryParams.clientType as 'browser' | 'agent'
  const agentId = queryParams.agentId ?? null
  const userId = queryParams.userId ?? null

  await dynamodb.put({
    TableName: 'connections',
    Item: {
      connectionId,
      clientType,
      agentId,
      userId,
      connectedAt: Date.now(),
      TTL: Math.floor(Date.now() / 1000) + 7200,
    },
  })
}
```

Connection URL format:
- Browser: `wss://signal.tabbyrdp.com?clientType=browser&userId=<userId>`
- Agent: `wss://signal.tabbyrdp.com?clientType=agent&agentId=<agentId>&userId=<userId>`

### `$disconnect` Handler

```ts
async function onDisconnect(connectionId: string) {
  const record = await dynamodb.get({ TableName: 'connections', Key: { connectionId } })
  if (record.Item?.clientType === 'agent') {
    await markAgentOffline(record.Item.agentId)
    await notifyAgentSubscribers(record.Item.agentId, { type: 'AGENT_OFFLINE' })
  }
  await dynamodb.delete({ TableName: 'connections', Key: { connectionId } })
}
```

---

## Agent Registration

Desktop Agent sends `AGENT_REGISTER` immediately after WebSocket connect.

```ts
interface AgentRegisterMessage {
  type: 'AGENT_REGISTER'
  agentId: string
  publicKey: string
  platform: 'windows' | 'macos' | 'linux'
  displays: SourceDescriptor[]
  apps: SourceDescriptor[]
}

interface SourceDescriptor {
  id: string
  name: string
  width: number
  height: number
}
```

Handler stores agent state in `agents` table and sets `online: true`.

### Agent Heartbeat

Agent sends `AGENT_HEARTBEAT` every 9 minutes.

```ts
interface AgentHeartbeatMessage {
  type: 'AGENT_HEARTBEAT'
  agentId: string
}
```

Handler updates `lastSeen` in `agents` table. If heartbeat is missed for > 12 minutes, a DynamoDB TTL cleanup marks the agent offline.

---

## Auth Approval Flow

Mobile app sends `AUTH_APPROVE` after the user scans the QR code and completes biometrics.

```ts
interface AuthApproveMessage {
  type: 'AUTH_APPROVE'
  pendingSessionId: string
  clerkJwt: string
  agentId: string
}
```

Handler:

1. Verify `clerkJwt` against Clerk JWKS (`/.well-known/jwks.json`).
2. Look up `pendingSessionId` in `pending-sessions` table. Fail if not found or expired.
3. Delete `pendingSessionId` record (single-use).
4. Look up `connectionId` linked to `pendingSessionId` (stored when browser connected).
5. Issue a short-lived signed JWT (24h TTL) for the browser session.
6. Send `AUTH_APPROVED` to the browser's `connectionId` via API Gateway Management API.

```ts
interface AuthApprovedMessage {
  type: 'AUTH_APPROVED'
  token: string
  agentId: string
}
```

---

## Subscription & Source Locking

### `SUBSCRIBE` Message

Browser tab sends when user selects a display or app.

```ts
interface SubscribeMessage {
  type: 'SUBSCRIBE'
  sourceId: string
  tabId: string
}
```

Handler:

1. Validate JWT from connection record.
2. Check `source_locks` record in DynamoDB for `sourceId`.
3. If locked by a different `tabId` → send `SOURCE_IN_USE { sourceId, tabId }` back to requesting browser.
4. If available → create `source_locks` record `{ sourceId, tabId, connectionId }`.
5. Forward `NOTIFY_SUBSCRIBER { sourceId, tabId, browserConnectionId }` to the agent's `connectionId`.

### `UNSUBSCRIBE` Message

Browser sends on tab close or source switch.

1. Delete `source_locks` record for `sourceId`.
2. Forward `NOTIFY_UNSUBSCRIBE { sourceId }` to agent.
3. Send `STREAM_CLOSED { sourceId }` to all browsers watching the same `agentId` (so they can update `inUse` state).

---

## SDP / ICE Relay

All signaling messages are relayed without inspection. Lambda acts purely as a message bus.

### SDP Offer (Agent → Browser)

Agent sends after receiving `NOTIFY_SUBSCRIBER`:

```ts
interface SdpOfferMessage {
  type: 'SDP_OFFER'
  sourceId: string
  sdp: RTCSessionDescriptionInit
  targetConnectionId: string
}
```

Handler looks up the browser's `connectionId` from `source_locks` and forwards via API GW Management API.

### SDP Answer (Browser → Agent)

```ts
interface SdpAnswerMessage {
  type: 'SDP_ANSWER'
  sourceId: string
  sdp: RTCSessionDescriptionInit
}
```

Handler looks up the agent's `connectionId` from `connections` (by `agentId`) and forwards.

### ICE Candidates (Bidirectional)

Both browser and agent send ICE candidates during trickle ICE. Handler looks up the opposite peer's `connectionId` and relays.

```ts
interface IceCandidateMessage {
  type: 'ICE_CANDIDATE'
  sourceId: string
  candidate: RTCIceCandidateInit
}
```

---

## Helper: `sendToConnection`

All outbound message delivery uses this helper:

```ts
async function sendToConnection(connectionId: string, payload: object) {
  const client = new ApiGatewayManagementApiClient({
    endpoint: process.env.WS_CALLBACK_URL,
  })
  await client.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: Buffer.from(JSON.stringify(payload)),
  }))
}
```

If `sendToConnection` throws a `GoneException` (connection no longer active), the stale record is deleted from DynamoDB.

---

## TURN Credential Endpoint

Separate REST Lambda (not WebSocket):

```
GET /turn-credentials
Authorization: Bearer <token>
```

Generates HMAC-SHA256 time-limited TURN credentials (TURN REST API standard):

```ts
interface TurnCredentialsResponse {
  urls: string[]
  username: string
  credential: string
  ttl: number
}
```

Credentials are valid for 86400 s. Cached by the browser per session.
