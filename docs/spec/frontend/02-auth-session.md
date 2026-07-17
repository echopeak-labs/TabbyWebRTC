# Frontend — Auth & Ephemeral Session SDD

## Scope

Defines the complete authentication system across both device roles. The webapp detects whether it is running on a **mobile key device** or a **desktop viewer** and renders a fundamentally different auth flow for each. These two paths are entirely independent — they share only the AWS signaling backend.

---

## The Two Auth Paths

| Concern | Desktop Viewer | Mobile Key |
|---|---|---|
| Goal | Display QR, receive approval, stream | Sign in with Clerk, scan QR, approve sessions |
| Identity | No Clerk account needed | Clerk account required |
| Session storage | `sessionStorage` (volatile, wiped on tab close) | Clerk-managed (persistent across app close) |
| Token held | TabbyWebRTC JWT (scoped to one streaming session) | Clerk JWT (permanent identity credential) |
| After auth | Navigate to `/launchpad` | Navigate to `/agents` |
| WebRTC | Yes | No — never |

---

## Desktop Path

### Phase D1: Connect Page (First Tab)

1. App detects `role = 'desktop-viewer'` via `useDeviceType()`.
2. `initAuthSync()` broadcasts `REQUEST_AUTH_TOKEN` on `BroadcastChannel("auth_sync")`.
3. 150 ms timeout with no response → token is `null` → render `ConnectPage`.
4. `ConnectPage` opens WSS connection to `wss://signal.tabbywebrtc.com/prod`.
5. Lambda `$connect` handler fires: generates `pendingSessionId` (UUID v4, 30 s TTL), stores in DynamoDB, sends `SESSION_PENDING` back.
6. `ConnectPage` renders QR code from `pendingSessionId`.
7. QR refreshes every 28 s (browser sends `REFRESH_SESSION` to rotate the ID before TTL expires).
8. WebSocket holds open listening for `AUTH_APPROVED`.
9. When `AUTH_APPROVED { token, agentId }` arrives: write both to `sessionStorage`, update `authStore`, navigate to `/launchpad`.

### Phase D2: Subsequent Desktop Tabs (Token Cloning)

1. New tab boots → `initAuthSync()` broadcasts `REQUEST_AUTH_TOKEN`.
2. An existing authenticated tab responds with `PROVIDE_AUTH_TOKEN { token, agentId }` within 150 ms.
3. New tab writes token to its own `sessionStorage`, skips login, navigates to `/launchpad`.
4. No new QR or WebSocket handshake is needed.

### Phase D3: Session Expiry

- TabbyWebRTC JWT has an 8-hour TTL. On 401 from Lambda: `authStore.clearSession()` → clear `sessionStorage` → redirect to `/`.
- All tabs close → browser destroys all `sessionStorage` instances → next visit starts fresh at `ConnectPage`.

### `ConnectPage` UI

```
+----------------------------------+
|          TabbyWebRTC                |  ← Amber wordmark
|                                  |
|    ┌────────────────────┐        |
|    │  [countdown ring]  │        |
|    │   ██████████████   │        |
|    │   ██  QR CODE  ██  │        |
|    │   ██████████████   │        |
|    └────────────────────┘        |
|                                  |
|  "Scan with your phone to        |
|   connect"                       |
|                                  |
|  Nearby on this network          |  ← optional: mDNS-discovered agents
|  [ Home Desktop · 192.168.1.42 ] |     (same QR auth; enables LAN path)
+----------------------------------+
```

Status text states: `"Scan with your phone"` → `"Waiting for authorization..."` (amber pulse) → `"Authorized. Loading..."`.

After auth, the app probes for a LAN path automatically. The TopBar shows **LAN** or **WAN** — the user does not choose the path manually.

---

## Mobile Key Path

### Phase M1: Sign In (First Visit)

1. App detects `role = 'mobile-key'` via `useDeviceType()`.
2. `MobileSignInPage` renders — shows Clerk's `<SignIn>` component (email/social/passkey).
3. On success, Clerk stores the session token natively (Clerk SDK manages persistence).
4. Clerk's `useUser()` hook returns the authenticated user.
5. Navigate to `/agents`.

This page is shown **only on first visit** or after sign-out. On subsequent app opens, Clerk's persistent session skips this page entirely and boots directly to `/agents`.

### `MobileSignInPage` UI

```
+----------------------------------+
|          TabbyWebRTC                |  ← Amber wordmark
|                                  |
|  Sign in to continue             |
|                                  |
|  [Clerk <SignIn /> component]    |
|  (email, Google, Apple, passkey) |
|                                  |
+----------------------------------+
```

### Phase M2: QR Scan

1. User opens `/scan` — `MobileScanPage` renders.
2. Camera permission is requested via `getUserMedia({ video: { facingMode: 'environment' } })`.
3. QR frames are decoded using `@zxing/browser` (or `jsQR`) in a `requestAnimationFrame` loop.
4. On successful decode: parse JSON payload `{ pendingSessionId, signalingUrl, version }`.
5. Validate `version === 1`. If invalid format, show error and re-enable scanner.
6. Store payload in `mobileStore.pendingScanPayload`.
7. Navigate to `/approve` automatically.

### `MobileScanPage` UI

```
+----------------------------------+
|  ←  Scan Desktop QR             |
|                                  |
|  ┌──────────────────────────┐    |
|  │                          │    |
|  │   [live camera feed]     │    |
|  │                          │    |
|  │   [amber corner guides]  │    |
|  │                          │    |
|  └──────────────────────────┘    |
|                                  |
|  Point your camera at the QR     |
|  on your desktop screen          |
+----------------------------------+
```

### Phase M3: Biometric Confirm + Approve

1. `MobileApprovePage` renders with the scanned `pendingSessionId`.
2. Show which agent the session will connect to (fetched from `mobileStore.pairedAgents`).
3. User confirms identity via Web Authentication API (`navigator.credentials.get({ publicKey: ... })`), or falls back to Clerk's `useAuth().getToken()` re-confirmation.
4. On confirm:
   - Retrieve the agent's `publicKey` from `mobileStore.pairedAgents`.
   - Generate a random 32-byte session salt.
   - Encrypt salt with agent's Ed25519 public key (NaCl box / `tweetnacl`).
   - If the phone detects it is on the same LAN as the selected agent (compare Wi‑Fi SSID / subnet or successful fetch to agent `GET /info`), include `localEndpoint: { url, localToken }` in the approve payload so the viewer can use Path A.
   - Send `POST /auth/approve` with `{ pendingSessionId, clerkJwt, agentId, encryptedSalt, localEndpoint? }`.
5. Lambda processes approval → sends `AUTH_APPROVED` to the waiting desktop tab.
6. Mobile shows confirmation screen: `"Desktop connected"` with agent name + green checkmark.
7. Navigate back to `/agents`.

### `MobileApprovePage` UI

```
+----------------------------------+
|  ←  Authorize Connection        |
|                                  |
|  Connecting to:                  |
|  ┌──────────────────────────┐    |
|  │  🖥  Home Desktop         │    |
|  │  Linux · Last seen now   │    |
|  └──────────────────────────┘    |
|                                  |
|  This will grant access to your  |
|  desktop from the scanned device.|
|                                  |
|  [ Approve with Face ID ]        |  ← primary amber button
|  [ Cancel ]                      |  ← ghost button
+----------------------------------+
```

### Phase M4: Agent Manager

`MobileAgentsPage` is the home screen after sign-in. Shows all paired agents with online/offline status.

```
+----------------------------------+
|  TabbyWebRTC           [Sign out]   |
|                                  |
|  Your Machines                   |
|                                  |
|  ┌──────────────────────────┐    |
|  │ 🖥 Home Desktop    ● Online│   |
|  │ Linux                    │    |
|  └──────────────────────────┘    |
|  ┌──────────────────────────┐    |
|  │ 🖥 Work Laptop   ○ Offline│   |
|  │ Windows                  │    |
|  └──────────────────────────┘    |
|                                  |
|  ┌──────────────────────────┐    |
|  │  + Pair a new machine    │    |
|  └──────────────────────────┘    |
|                                  |
|  ──────────────────────────────  |
|  [ Scan QR to connect ↑ ]        |  ← bottom CTA
+----------------------------------+
```

The "Scan QR to connect" button is the primary bottom CTA — anchored to the bottom of the screen, full-width, Amber background. It navigates to `/scan`.

---

## Shared: One-Time Agent Pairing

Initiated from `MobileAgentsPage` → "+ Pair a new machine". The desktop agent displays a setup QR; the mobile scans it using the same `MobileScanPage` camera component with a different decode target.

| Step | Actor | Action |
|---|---|---|
| 1 | Desktop Agent (first run) | Generates Ed25519 keypair, stores private key in OS keychain, displays setup QR `{ agentId, publicKey, type: "PAIR" }` |
| 2 | Mobile `MobileAgentsPage` | User taps "+ Pair". Navigates to `/scan?mode=pair` |
| 3 | Mobile `MobileScanPage` | Decodes QR, detects `type: "PAIR"`, routes to pairing confirmation |
| 4 | Mobile | `POST /agents/pair { agentId, publicKey, name, platform }` (with Clerk JWT) |
| 5 | Lambda | Stores agent record in DynamoDB, issues agent JWT, returns `{ agentJwt }` |
| 6 | Mobile | Adds `{ agentId, publicKey, name }` to `mobileStore.pairedAgents` (synced to Clerk user metadata) |
| 7 | Desktop Agent | Polls for its JWT from Lambda. Stores in OS keychain. |

---

## BroadcastChannel Message Types (Desktop Only)

```ts
type AuthSyncMessage =
  | { type: 'REQUEST_AUTH_TOKEN' }
  | { type: 'PROVIDE_AUTH_TOKEN'; token: string; agentId: string }
```

## WebSocket Message Types — Desktop Inbound

```ts
type DesktopInboundMessage =
  | { type: 'SESSION_PENDING'; pendingSessionId: string; expiresIn: number }
  | { type: 'AUTH_APPROVED'; token: string; agentId: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'ERROR'; code: string; message: string }
```

---

## Security Constraints

| Rule | Scope |
|---|---|
| TabbyWebRTC streaming JWT MUST NOT be written to `localStorage` or any cookie | Desktop |
| Clerk session token is managed exclusively by Clerk SDK (never read/written manually) | Mobile |
| `pendingSessionId` is single-use — Lambda deletes it on first `AUTH_APPROVE` | Both |
| Mobile NEVER receives a TabbyWebRTC streaming token — it only triggers issuance for the desktop | Both |
| WSS (TLS 1.3+) for all signaling traffic | Both |
| WebRTC DTLS-SRTP enforced for all media and data channels | Desktop |
