# Frontend — WebRTC Client SDD

## Scope

Defines the WebRTC client lifecycle: PeerConnection setup, signaling handshake, video track attachment, data channel initialization, stream multiplexing constraints, and teardown.

---

## PeerConnection Configuration

```ts
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:turn.tabbywebrtc.com:3478',
      username: '<dynamic-credential>',
      credential: '<dynamic-credential>',
    },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}
```

TURN credentials are short-lived (TTL 86400 s). Fetched from Lambda at session start:

```
GET /turn-credentials
Authorization: Bearer <token>
```

---

## Signaling Handshake Sequence

```
Browser Tab                     AWS Lambda (WebSocket)          Desktop Agent
     |                                   |                            |
     |------ SUBSCRIBE { sourceId } ---->|                            |
     |                                   |------ NOTIFY_SUBSCRIBER -->|
     |                                   |                            |
     |                                   |<----- SDP_OFFER -----------|
     |<------ SDP_OFFER -----------------|                            |
     |                                   |                            |
     |----- SDP_ANSWER ----------------->|                            |
     |                                   |------ SDP_ANSWER -------->|
     |                                   |                            |
     |<===== ICE_CANDIDATE (trickle) ====|===========================>|
     |====== ICE_CANDIDATE (trickle) ===>|==========================>|
     |                                   |                            |
     |<=========== P2P WebRTC Connection Established ================>|
```

### WebSocket Message Types (outbound from browser)

```ts
type OutboundSignalMessage =
  | { type: 'SUBSCRIBE'; sourceId: string; tabId: string }
  | { type: 'SDP_ANSWER'; sourceId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; sourceId: string; candidate: RTCIceCandidateInit }
  | { type: 'UNSUBSCRIBE'; sourceId: string; tabId: string }
```

### WebSocket Message Types (inbound to browser)

```ts
type InboundSignalMessage =
  | { type: 'SDP_OFFER'; sourceId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; sourceId: string; candidate: RTCIceCandidateInit }
  | { type: 'STREAM_READY'; sourceId: string }
  | { type: 'SOURCE_IN_USE'; sourceId: string; tabId: string }
  | { type: 'STREAM_CLOSED'; sourceId: string }
```

---

## `useWebRTC` Hook Contract

```ts
interface UseWebRTCOptions {
  sourceId: string
  token: string
  agentId: string
  onStream: (stream: MediaStream) => void
  onClose: () => void
  onError: (err: Error) => void
}

interface UseWebRTCReturn {
  peerConnection: RTCPeerConnection | null
  inputChannel: RTCDataChannel | null
  connectionState: RTCPeerConnectionState
  disconnect: () => void
}

function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn
```

### Internal Lifecycle

1. On mount: open `RTCPeerConnection`, create unreliable-unordered data channel `"input_stream"`.
2. Send `SUBSCRIBE` via WebSocket.
3. On `SDP_OFFER`: `setRemoteDescription` → `createAnswer` → `setLocalDescription` → send `SDP_ANSWER`.
4. On `ICE_CANDIDATE`: `addIceCandidate`.
5. `onicecandidate` handler sends local candidates via `ICE_CANDIDATE` messages.
6. `ontrack` handler fires → `onStream(event.streams[0])`.
7. On unmount / `disconnect()`: send `UNSUBSCRIBE` → `peerConnection.close()`.

---

## Video Rendering

### `VideoPlayer` Component

```tsx
interface VideoPlayerProps {
  stream: MediaStream
  sourceId: string
  nativeWidth: number
  nativeHeight: number
}
```

- Renders an `<video>` element with `autoPlay`, `playsInline`, `muted={false}`.
- `srcObject` is set to the `MediaStream` on mount via `useEffect`.
- The video element fills its parent container using `object-fit: contain` with CSS.
- Native width/height are stored as `data-*` attributes for the mouse calibration math.

### Bitrate Cap

Applied per stream to prevent LAN saturation. Configurable via the control bar.

```ts
async function applyBitrateCap(sender: RTCRtpSender, maxKbps: number) {
  const params = sender.getParameters()
  if (!params.encodings.length) params.encodings = [{}]
  params.encodings[0].maxBitrate = maxKbps * 1000
  await sender.setParameters(params)
}
```

Default caps: Low = 3000 kbps, Medium = 8000 kbps, High = 15000 kbps.

---

## Source Exclusivity (In-Use Locking)

- When a tab sends `SUBSCRIBE { sourceId }`, Lambda checks if `sourceId` is already claimed by a different `tabId`.
- If claimed: Lambda returns `SOURCE_IN_USE { sourceId, tabId }`. The browser marks the source as `inUse: true` in `agentStore` and shows a disabled state.
- If the owning tab disconnects, Lambda broadcasts `STREAM_CLOSED { sourceId }` and clears the lock. All tabs update `inUse: false`.

---

## Thumbnail Polling

Thumbnails are delivered as JPEG images over the WebRTC data channel (separate from `input_stream`) or fetched via HTTP from the agent's local HTTP server.

### Option A: HTTP Polling (preferred for simplicity)

```
GET http://<agent-local-ip>:7700/thumbnail/<sourceId>
Authorization: Bearer <token>
```

- Response: `image/jpeg`, max 320×180 px.
- Polled once on `LaunchpadPage` mount, then every 5 minutes.
- `useThumbnailPoller` hook manages the interval and updates `agentStore`.

### Option B: Data Channel (future optimization)

- Agent pushes JPEG bytes over a reliable ordered data channel `"thumbnail_stream"`.
- Triggered on demand or on timer from the agent side.

---

## Error Handling

| Condition | Browser Action |
|---|---|
| ICE connection fails | Retry up to 3× with exponential backoff; show toast "Connection unstable" |
| `SOURCE_IN_USE` received | Disable card in launchpad; show tooltip "In use in another tab" |
| WebSocket disconnects | Auto-reconnect every 2 s for 30 s; after 30 s show "Agent offline" |
| `peerConnection` state = `"failed"` | Call `disconnect()`, show error overlay on `StreamPage` |
