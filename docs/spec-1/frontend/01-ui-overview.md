# Frontend — UI Overview SDD

## Scope

Defines the complete frontend architecture for TabbyRDP: tech stack, folder layout, theming, routing, and global state contracts. All other frontend spec files build on this foundation.

---

## Tech Stack

| Layer | Choice | Version Constraint |
|---|---|---|
| Language | TypeScript | `>=5.4` |
| Framework | React | `>=18.3` |
| Styling | TailwindCSS + shadcn/ui | Tailwind `>=3.4` |
| Animation | framer-motion (replaces react-motion) | `>=11` |
| Routing | react-router-dom | `>=6.24` |
| State | Zustand | `>=4.5` |
| WebRTC | Native browser APIs (no wrapper lib) | — |
| Build | Vite | `>=5.3` |
| Linting | ESLint + Prettier | — |

---

## Theme: Onyx & Amber

### Color Tokens

```ts
const theme = {
  background:  '#0A0A0A',
  surface:     '#141414',
  surfaceHigh: '#1E1E1E',
  border:      '#2A2A2A',
  accent:      '#F59E0B',
  accentHover: '#D97706',
  accentMuted: '#78350F',
  textPrimary: '#F5F5F5',
  textMuted:   '#737373',
  danger:      '#EF4444',
  success:     '#22C55E',
}
```

All shadcn component CSS variables must be overridden to match this palette via `globals.css`.

---

## Device Roles

The webapp serves two fundamentally different user roles. The device type is detected on boot and determines the entire rendered experience. These roles never overlap.

| Role | Device | Purpose |
|---|---|---|
| **Key Device** | Mobile phone | Holds Clerk identity, scans QR codes, approves sessions via biometric. Never streams video. |
| **Viewer** | Desktop / laptop browser | Displays QR, receives approved token, streams remote desktop via WebRTC. |

Detection is performed by `useDeviceType()` which checks both `navigator.userAgent` and `window.matchMedia('(pointer: coarse)')`. The result gates the entire route tree — mobile users never see the streaming UI, desktop users never see the Clerk sign-in UI.

```ts
export type DeviceRole = 'desktop-viewer' | 'mobile-key'

export function useDeviceType(): DeviceRole {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return coarsePointer || mobileUA ? 'mobile-key' : 'desktop-viewer'
}
```

---

## Folder Structure

```
src/
  app/
    router.tsx              # Dual route tree — desktop vs mobile
    App.tsx                 # Calls useDeviceType(), renders correct router
  components/
    ui/                     # shadcn primitives (Button, Card, Badge, etc.)
    layout/                 # Shell, Sidebar, TopBar
    stream/                 # VideoPlayer, StreamOverlay, ControlBar  [desktop only]
    launchpad/              # DisplayCard, AppCard, LaunchpadGrid      [desktop only]
    auth/
      desktop/              # ConnectPage, QRPanel
      mobile/               # ClerkSignIn, QRScanner, ApprovePanel, AgentManager
  hooks/
    useDeviceType.ts        # Detects desktop-viewer vs mobile-key
    useWebRTC.ts            # [desktop only]
    useInputChannel.ts      # [desktop only]
    useAuthSession.ts
    useThumbnailPoller.ts   # [desktop only]
    useDisplayList.ts       # [desktop only]
    useMobileAuth.ts        # [mobile only] Clerk sign-in + QR scan + approve flow
  stores/
    authStore.ts            # Zustand — session token, auth state
    agentStore.ts           # Zustand — connected agent, display/app list [desktop]
    streamStore.ts          # Zustand — active streams per tab           [desktop]
    mobileStore.ts          # Zustand — Clerk user, paired agents        [mobile]
  lib/
    auth-sync.ts            # BroadcastChannel ephemeral session logic   [desktop]
    webrtc.ts               # PeerConnection factory + helpers           [desktop]
    input-codec.ts          # Input payload serialization                [desktop]
    signal-client.ts        # WebSocket signaling client
    clerk-client.ts         # Clerk browser SDK init                     [mobile]
  types/
    agent.ts
    stream.ts
    input.ts
    auth.ts
    device.ts               # DeviceRole type
  pages/
    desktop/
      ConnectPage.tsx        # QR display + waiting state
      LaunchpadPage.tsx      # Display/app picker
      StreamPage.tsx         # Active WebRTC stream
    mobile/
      MobileSignInPage.tsx   # Clerk sign-in (first visit)
      MobileScanPage.tsx     # Camera QR scanner
      MobileApprovePage.tsx  # Biometric confirm + agent selector
      MobileAgentsPage.tsx   # Manage paired agents
  main.tsx
```

---

## Route Structure

`App.tsx` calls `useDeviceType()` at boot and renders one of two completely separate route trees. There is no shared routing between roles.

### Desktop Viewer Routes

| Path | Component | Auth Required | Description |
|---|---|---|---|
| `/` | `ConnectPage` | No | QR display + wait for mobile approval |
| `/launchpad` | `LaunchpadPage` | Yes | Display/app picker |
| `/stream/:sourceId` | `StreamPage` | Yes | Active WebRTC stream view |

Route guard: if no token in `sessionStorage`, redirect to `/`. Applied as a `<ProtectedRoute>` wrapper.

### Mobile Key Routes

| Path | Component | Clerk Auth Required | Description |
|---|---|---|---|
| `/` | `MobileSignInPage` | No | Clerk sign-in (persistent — survives app close) |
| `/scan` | `MobileScanPage` | Yes | Camera QR scanner for desktop session QR codes |
| `/approve` | `MobileApprovePage` | Yes | Biometric confirm + agent selector before approving |
| `/agents` | `MobileAgentsPage` | Yes | View and manage all paired desktop agents |

Clerk session on mobile is **persistent** (`localStorage` backed by Clerk SDK). Mobile is the trusted device — it is always signed in. If Clerk session is missing, redirect to `/` (sign-in page).

---

## Global State Contracts

### Desktop Viewer Stores

#### `authStore`

```ts
interface AuthState {
  token: string | null
  agentId: string | null
  setToken: (token: string) => void
  clearSession: () => void
}
```

#### `agentStore`

```ts
interface AgentState {
  displays: Display[]
  apps: AppWindow[]
  setDisplays: (d: Display[]) => void
  setApps: (a: AppWindow[]) => void
}

interface Display {
  id: string
  name: string
  width: number
  height: number
  thumbnailUrl: string | null
  inUse: boolean
}

interface AppWindow {
  id: string
  name: string
  pid: number
  thumbnailUrl: string | null
  inUse: boolean
}
```

#### `streamStore`

```ts
interface StreamState {
  activeStreams: Record<string, ActiveStream>
  registerStream: (sourceId: string, pc: RTCPeerConnection) => void
  releaseStream: (sourceId: string) => void
}

interface ActiveStream {
  sourceId: string
  peerConnection: RTCPeerConnection
  inputChannel: RTCDataChannel
  mediaStream: MediaStream
}
```

### Mobile Key Stores

#### `mobileStore`

```ts
interface MobileState {
  clerkUserId: string | null
  pairedAgents: PairedAgent[]
  pendingScanPayload: QRPayload | null
  setPendingScanPayload: (p: QRPayload) => void
  clearPendingScan: () => void
}

interface PairedAgent {
  agentId: string
  name: string
  platform: 'windows' | 'macos' | 'linux'
  publicKey: string
  lastSeen: string
}
```

`pairedAgents` is hydrated from Clerk's user metadata on sign-in (stored server-side by Clerk, never in `localStorage` directly).

---

## Bundle Splitting by Role

Because the two device experiences share no UI components, they must be split at the build level to avoid shipping WebRTC and streaming code to mobile, or camera/Clerk SDK code to desktop.

```ts
// App.tsx
const DesktopRouter = lazy(() => import('./app/DesktopRouter'))
const MobileRouter  = lazy(() => import('./app/MobileRouter'))

export function App() {
  const role = useDeviceType()
  return (
    <Suspense fallback={<SplashScreen />}>
      {role === 'desktop-viewer' ? <DesktopRouter /> : <MobileRouter />}
    </Suspense>
  )
}
```

This ensures Vite produces two separate async chunks. Neither chunk is loaded by the other role.

---

## Non-Functional Requirements

- First Contentful Paint < 1.2 s on a 10 Mbps connection.
- Desktop bundle chunk < 300 KB gzipped. Mobile bundle chunk < 120 KB gzipped.
- No external font requests — use system font stack.
- All interactive elements must have visible focus indicators (WCAG 2.1 AA).
- The desktop app must function in fullscreen mode to support Keyboard Lock API.
- The mobile UI must be fully usable with one thumb (bottom-anchored primary actions, min tap target 44×44 px).
