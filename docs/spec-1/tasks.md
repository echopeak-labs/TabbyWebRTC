# TabbyWebRTC — Agent Task Lists

Each section below corresponds to a spec file in `docs/spec-1/`. Tasks are ordered for sequential execution within a spec. Check the `agents.md` dependency graph before starting any domain.

Use `[ ]` / `[x]` to track individual task completion.

---

## frontend/01-ui-overview.md

- [x] Initialize Vite + React + TypeScript project in `frontend/`
- [x] Install dependencies: `tailwindcss`, `@shadcn/ui`, `framer-motion`, `react-router-dom`, `zustand`, `@clerk/clerk-react`
- [x] Configure TailwindCSS with Onyx & Amber color tokens in `tailwind.config.ts` and `globals.css`
- [x] Initialize shadcn/ui and override all CSS variables to match the Onyx/Amber theme
- [x] Scaffold folder structure as defined in spec: `components/desktop/`, `components/mobile/`, `hooks/`, `stores/`, `lib/`, `types/`, `pages/desktop/`, `pages/mobile/`
- [x] Implement `useDeviceType.ts` hook: check `pointer: coarse` media query + mobile user agent → return `'desktop-viewer' | 'mobile-key'`
- [x] Define `src/types/device.ts` with `DeviceRole` type
- [x] Define all TypeScript types in `src/types/`: `agent.ts`, `stream.ts`, `input.ts`, `auth.ts`
- [x] Implement `authStore.ts` (Zustand, desktop) with `token`, `agentId`, `setToken`, `clearSession`
- [x] Implement `agentStore.ts` (Zustand, desktop) with `displays`, `apps`, `setDisplays`, `setApps`
- [x] Implement `streamStore.ts` (Zustand, desktop) with `activeStreams`, `registerStream`, `releaseStream`
- [x] Implement `mobileStore.ts` (Zustand, mobile) with `clerkUserId`, `pairedAgents`, `pendingScanPayload`
- [x] Scaffold `DesktopRouter.tsx` with `/`, `/launchpad`, `/stream/:sourceId` routes + `<ProtectedRoute>`
- [x] Scaffold `MobileRouter.tsx` with `/`, `/scan`, `/approve`, `/agents` routes + Clerk auth guard
- [x] Implement `App.tsx`: call `useDeviceType()`, lazy-load `<DesktopRouter>` or `<MobileRouter>` accordingly
- [x] Configure Vite with `VITE_WS_URL`, `VITE_REST_URL`, `VITE_CLERK_PUBLISHABLE_KEY` env vars
- [x] Verify Vite produces two separate async chunks (desktop vs mobile) — confirm via `npm run build` output
- [x] Verify desktop bundle chunk < 300 KB gzipped; mobile chunk < 120 KB gzipped

---

## frontend/02-auth-session.md

### Desktop tasks

- [x] Implement `src/lib/auth-sync.ts`: `initAuthSync()` with BroadcastChannel + 150 ms timeout
- [x] Implement permanent background listener in `auth-sync.ts` responding to `REQUEST_AUTH_TOKEN`
- [x] Integrate `initAuthSync()` into `DesktopRouter.tsx` before first route renders
- [x] Implement `signal-client.ts`: WebSocket client connecting to `VITE_WS_URL`
- [x] Handle inbound desktop WSS messages: `SESSION_PENDING`, `AUTH_APPROVED`, `SESSION_EXPIRED`, `ERROR`
- [x] Build `pages/desktop/ConnectPage.tsx`: centered card, Amber wordmark, QR panel
- [x] Integrate `qrcode.react` to render QR from `pendingSessionId`
- [x] Implement 28 s countdown SVG ring with automatic QR refresh (send `REFRESH_SESSION`)
- [x] Implement status text state machine: idle → waiting → authorized → loading
- [x] On `AUTH_APPROVED`: write token + agentId to `sessionStorage`, update `authStore`, navigate to `/launchpad`
- [x] Add "Connect on local network" secondary link with manual IP entry modal

### Mobile tasks

- [x] Initialize Clerk in `MobileRouter.tsx` via `<ClerkProvider publishableKey={...}>`
- [x] Build `pages/mobile/MobileSignInPage.tsx`: render Clerk `<SignIn>` component with Onyx/Amber theme overrides
- [x] Implement Clerk session guard in `MobileRouter.tsx`: if no Clerk session, redirect to `/` (sign-in)
- [x] Build `pages/mobile/MobileAgentsPage.tsx`: list paired agents with online/offline status; bottom "Scan QR" CTA
- [x] Hydrate `mobileStore.pairedAgents` from Clerk user metadata on sign-in (`user.publicMetadata.pairedAgents`)
- [x] Build `pages/mobile/MobileScanPage.tsx`: camera feed via `getUserMedia`, QR decode with `@zxing/browser`
- [x] In `MobileScanPage`: detect `type: "PAIR"` vs normal session QR and route accordingly
- [x] On successful scan: store `QRPayload` in `mobileStore.pendingScanPayload`, navigate to `/approve`
- [x] Build `pages/mobile/MobileApprovePage.tsx`: show target agent card + "Approve with Face ID" primary button
- [x] Implement biometric confirm via `navigator.credentials.get` (WebAuthn) with Clerk JWT fallback
- [x] On confirm: generate 32-byte salt, encrypt with agent public key via `tweetnacl`, `POST /auth/approve`
- [x] On success: show "Desktop connected" confirmation screen, navigate to `/agents`
- [x] Implement "+ Pair a new machine" flow: navigate to `/scan?mode=pair`, handle `type: "PAIR"` QR
- [x] On pairing QR decode: `POST /agents/pair` with Clerk JWT, store result in `mobileStore.pairedAgents` + Clerk user metadata
- [x] All mobile tap targets must be minimum 44×44 px; primary actions anchored to bottom of screen

---

## frontend/03-webrtc-client.md

- [x] Implement `src/lib/webrtc.ts`: `createPeerConnection(config)` factory using `RTC_CONFIG` from spec
- [x] Implement TURN credential fetch: `GET /turn-credentials` with JWT, cache result per session
- [x] Implement outbound signaling message senders in `signal-client.ts`: `SUBSCRIBE`, `SDP_ANSWER`, `ICE_CANDIDATE`, `UNSUBSCRIBE`
- [x] Handle inbound signaling messages: `SDP_OFFER`, `ICE_CANDIDATE`, `SOURCE_IN_USE`, `STREAM_CLOSED`
- [x] Implement `useWebRTC` hook with full PeerConnection lifecycle per spec interface
- [x] Implement `applyBitrateCap(sender, maxKbps)` helper
- [x] Build `VideoPlayer.tsx` component: `<video>` with `autoPlay`, `playsInline`, `srcObject`, `object-fit: contain`
- [x] Implement source in-use locking: update `agentStore.displays[].inUse` on `SOURCE_IN_USE` / `STREAM_CLOSED`
- [x] Implement `useThumbnailPoller` hook: fetch on mount, 5-minute interval, update `agentStore`
- [x] Implement WebSocket auto-reconnect with 2 s retry loop (max 30 s then show "Agent offline")
- [x] Add ICE failure retry logic: up to 3× with exponential backoff, toast on failure

---

## frontend/04-input-handling.md

- [x] Implement `src/lib/input-codec.ts`: serialize all `InputPayload` types to JSON strings
- [x] Implement `useInputChannel` hook per spec interface
- [x] Attach `keydown` / `keyup` event listeners using `event.code` (not `event.key`)
- [x] Implement `activateKeyboardLock()`: `requestFullscreen` then `navigator.keyboard.lock([...])`
- [x] Implement `releaseKeyboardLock()` on StreamPage unmount
- [x] Implement absolute mouse coordinate transform: `getAbsoluteCoordinates(event, videoEl, nativeW, nativeH)`
- [x] Implement mouse move throttle: max 1 event per 8 ms (timestamp gate)
- [x] Implement Pointer Lock API for relative mouse mode: `videoElement.requestPointerLock()`
- [x] Suppress right-click context menu on video element
- [x] Implement `MOUSE_SCROLL` from `wheel` events with `deltaX` and `deltaY`
- [x] Implement custom CSS cursor overlay (Amber dot) over video element; hide default cursor
- [x] Implement clipboard paste: `navigator.clipboard.readText()` → `CLIPBOARD_PASTE` payload
- [x] Build `ControlBar.tsx` component with all command buttons per spec table

---

## frontend/05-launchpad.md

- [x] Build `LaunchpadPage.tsx` with two-column layout (displays left, apps right)
- [x] Build `DisplayCard.tsx` with all visual states: available, in-use, offline, selected
- [x] Build `AppCard.tsx` as horizontal list item with thumbnail + name
- [x] Implement responsive collapse: two columns → single column stacked on < 768 px
- [x] Fetch agent's display + app list from signaling on launchpad mount; populate `agentStore`
- [x] Build `StreamPage.tsx`: full-viewport video, ControlBar auto-hide after 3 s
- [x] Implement ControlBar visibility: auto-hide on no mouse movement, show on `mousemove` or `Ctrl+Shift+C`
- [x] Implement confirm dialogs for Restart and Shutdown commands (dismissible with Escape)
- [x] Build `TopBar.tsx`: agent selector dropdown, connection badge (LAN/WAN), latency display, avatar menu
- [x] Implement latency readout: poll `getStats()` every 2 s for `currentRoundTripTime`
- [x] Implement connection badge: LAN (green) if host/srflx ICE pair, WAN (amber) if relay
- [x] Implement agent switcher: on selection, clear stream state and reload launchpad
- [x] Implement Sign Out: `authStore.clearSession()` + clear sessionStorage + navigate to `/`
- [x] Implement F11 → `requestFullscreen` + Keyboard Lock on StreamPage

---

## backend/01-architecture.md

- [x] Initialize CDK TypeScript project in `infra/` with `cdk init app --language typescript`
- [x] Create `lib/constructs/dynamodb-tables.ts`: define all 4 DynamoDB tables with correct keys, GSIs, TTL, and PAY_PER_REQUEST
- [x] Create `lib/constructs/iam-roles.ts`: Lambda execution role with table grants
- [x] Tag all CDK resources with `{ project: 'tabbywebrtc' }` via `Tags.of(this).add(...)`
- [x] Verify `cdk synth` completes without errors
- [x] Configure `cdk.json` with `env=dev` / `env=prod` context switching

---

## backend/02-signaling-server.md

- [x] Create `lambda/src/connect.ts`: register `connectionId` + client type in DynamoDB
- [x] Create `lambda/src/disconnect.ts`: deregister connection, mark agent offline if applicable, notify subscribers
- [x] Create `lambda/src/router.ts`: parse `type` field and dispatch to sub-handlers
- [x] Create `lambda/src/handlers/agent.ts`: handle `AGENT_REGISTER` and `AGENT_HEARTBEAT`
- [x] Create `lambda/src/handlers/signal.ts`: handle `SUBSCRIBE`, `UNSUBSCRIBE`, `SDP_OFFER`, `SDP_ANSWER`, `ICE_CANDIDATE`
- [x] Implement `sendToConnection()` helper with `GoneException` stale-connection cleanup
- [x] Implement source locking: `SUBSCRIBE` checks `source_locks` table; returns `SOURCE_IN_USE` if claimed
- [x] Implement lock release on `UNSUBSCRIBE`: delete lock, broadcast `STREAM_CLOSED` to all subscribers
- [x] Write unit tests for router dispatch logic
- [x] Write integration test for full signaling round-trip (mock API GW)

---

## backend/03-aws-infra.md

- [x] Create `lib/constructs/websocket-api.ts`: define `WebSocketApi` with `$connect`, `$disconnect`, `$default` routes
- [x] Create `lib/constructs/lambda-functions.ts`: define `wsHandlerFn` (ARM64, Node 22, 128 MB) and `turnFn`
- [x] Wire `WS_CALLBACK_URL` environment variable to `wsHandlerFn` after API creation
- [x] Add `execute-api:ManageConnections` IAM policy to Lambda role
- [x] Define REST API with `GET /turn-credentials` route
- [x] Define `GET /agents`, `POST /agents/pair`, `POST /auth/approve` REST routes
- [x] Add `CfnOutput` for `WsEndpoint` and `RestEndpoint`
- [x] Implement multi-environment context switching (`env=dev` vs `env=prod`) in stack
- [ ] Run `cdk diff` against dev account before first deploy
- [ ] Run `cdk deploy TabbyWebRTCDev` to validate stack deploys cleanly

---

## backend/04-auth-service.md

- [x] Install `jose` and `@clerk/backend` packages in Lambda bundle
- [x] Implement `verifyClerkJwt(token)` using `jose.createRemoteJWKSet` against Clerk JWKS URL
- [x] Implement `verifyTabbyWebRTCToken(token)` using HS256 + `TABBYWEBRTC_JWT_SECRET`
- [x] Create `lambda/src/handlers/auth.ts`: implement `AUTH_APPROVE` flow (verify Clerk JWT, consume pendingSessionId, issue TabbyWebRTC JWT, send `AUTH_APPROVED` to browser)
- [x] Implement QR session creation in `$connect` handler: generate UUID pendingSessionId, store in DynamoDB, send `SESSION_PENDING`
- [x] Implement QR refresh: handle `REFRESH_SESSION` message → rotate pendingSessionId
- [x] Implement `POST /agents/pair` Lambda handler: verify Clerk JWT, store agent record, issue agent JWT (1-year)
- [x] Implement `GET /agents` Lambda handler: query agents table by userId GSI, return list
- [x] Implement `GET /turn-credentials` Lambda handler: generate HMAC-SHA256 TURN credentials with configurable TTL
- [x] Write unit tests for all JWT issuance and validation paths
- [ ] Test full auth flow end-to-end against dev environment

---

## cicd/01-pipeline.md

- [x] Create `.github/workflows/pr-check.yml`: lint + typecheck + build for frontend, backend, and agent; cargo clippy + test
- [x] Create `.github/workflows/frontend.yml`: `npm ci` → `npm run build` with Vite env vars → `wrangler pages deploy`
- [x] Create `.github/workflows/backend.yml`: `npm ci` → `npx cdk deploy TabbyWebRTCProd` with OIDC auth
- [x] Create `.github/workflows/desktop-agent.yml`: matrix build for all 5 platform/arch targets; upload artifacts; create GitHub Release on tag
- [ ] Add all required GitHub Secrets to the repository (see spec secrets reference table)
- [ ] Test PR check workflow on a feature branch
- [ ] Test frontend deploy workflow by merging a frontend change to `main`
- [ ] Test backend deploy workflow by merging an infra change to `main`
- [ ] Test desktop-agent build matrix — verify all 5 binaries are produced as artifacts

---

## cicd/02-scripts.md

- [x] Create `scripts/setup-dev.sh`: verify prerequisites, `npm ci` frontend + infra, `cargo build` agent, copy `.env.example` files
- [x] Create `scripts/dev-backend.sh`: SAM local start with `env.local.json`
- [x] Create `scripts/dev-frontend.sh`: Vite dev server with local backend env vars
- [x] Create `scripts/bootstrap-aws.sh`: CDK bootstrap + OIDC provider creation + deploy IAM role
- [x] Create `scripts/provision-turn.sh`: SSH-based CoTURN install and config on target VPS
- [x] Create `scripts/rotate-secrets.sh`: regenerate `TABBYWEBRTC_JWT_SECRET` and update GitHub Secrets via `gh` CLI
- [x] Create `scripts/release.sh`: tag + push to trigger release workflow
- [x] Create `scripts/check-costs.sh`: AWS Cost Explorer query scoped to `project=tabbywebrtc` tag
- [x] `chmod +x` all scripts
- [x] Document prerequisite tools in `scripts/README` or inline help text (`--help`)
- [x] Test `setup-dev.sh` on a clean machine (or Docker container)

---

## desktop-agent/01-overview.md

- [x] Initialize Cargo workspace in `desktop-agent/` with crates: `agent`, `capture`, `input`, `webrtc_peer`, `signaling`
- [x] Add all key dependencies to `Cargo.toml` files per spec (webrtc, tokio, engio, scap, ffmpeg-next, etc.)
- [x] Implement `config.rs`: TOML deserialization, default values, config file path resolution per platform
- [x] Implement CLI arg parsing in `main.rs` using `clap`: `--config <path>`, `--log-level <level>`
- [x] Implement OS keychain read/write for agent JWT using `keyring` crate
- [x] Implement `SourceEnumerator` task: polls display/window list every 30 s, sends delta updates via channel
- [x] Implement startup sequence per spec (steps 1–10)
- [x] Implement first-run pairing flow: generate Ed25519 keypair, display pairing URL, await JWT
- [x] Implement `ThumbnailServer` HTTP server on port 7700 (axum or tiny_http)
- [x] Verify binary compiles cleanly on Linux with `cargo build`

---

## desktop-agent/02-display-capture.md

- [x] Define `Capturable` trait and `Frame` / `PixelFormat` types in `capture/src/lib.rs`
- [x] Implement Linux capture in `capture/src/linux.rs` using `ashpd` + PipeWire portal
- [x] Implement Windows capture in `capture/src/windows.rs` using DXGI Desktop Duplication API
- [x] Implement Windows per-window capture using `Windows.Graphics.Capture` API
- [x] Implement macOS capture in `capture/src/macos.rs` using ScreenCaptureKit bindings
- [x] Implement hardware encoder selection logic: NVENC → VAAPI → VideoToolbox → software fallback
- [x] Implement `CaptureLoop` async task: `spawn_blocking` for `next_frame()`, encode, write RTP sample
- [x] Implement H.264 NAL unit → RTP packetization (FU-A for large NALUs)
- [x] Implement `capture_thumbnail()`: single frame → scale to 320×180 → encode JPEG quality 60
- [x] Implement window minimization override (per platform): intercept minimize, move off-screen instead
- [x] Implement window position restore on unsubscribe
- [x] Test capture loop on Linux with a real display; verify H.264 output is decodable

---

## desktop-agent/03-input-injection.md

- [x] Define `InputInjector` trait, `ModifierState`, `MouseButton`, `AgentCommand` in `input/src/lib.rs`
- [x] Implement `InputPayload` serde deserialization for all payload types
- [x] Implement `run_input_handler` async task: data channel `on_message` → deserialize → dispatch
- [x] Build scancode → virtual key mapping table for Linux (evdev keycodes)
- [x] Build scancode → virtual key mapping table for Windows (Win32 VK codes)
- [x] Build scancode → virtual key mapping table for macOS (CGKeyCode)
- [x] Implement Linux injector in `input/src/linux.rs` using `/dev/uinput`: keyboard, abs mouse, rel mouse, scroll
- [x] Implement Windows injector in `input/src/windows.rs` using `SendInput` with `MOUSEEVENTF_VIRTUALDESK`
- [x] Implement macOS injector in `input/src/macos.rs` using `CGEventPost`
- [x] Implement `execute_command`: `CtrlAltDel`, `Sleep`, `Restart`, `Shutdown`, `LockScreen` per platform
- [x] Implement `clipboard_paste` using `arboard` crate + synthesized paste key event
- [x] Test keyboard injection on Linux: type text in a text editor via the data channel
- [x] Test mouse injection on Linux: move cursor and click via the data channel

---

## desktop-agent/04-webrtc-server.md

- [x] Define `StreamRegistry` struct with `get_or_create_track`, `add_subscriber`, `remove_subscriber`
- [x] Implement `SignalingClient`: WebSocket connect with agent JWT, `send()`, auto-reconnect with exponential backoff
- [x] Implement all inbound signaling message handlers: `NOTIFY_SUBSCRIBER`, `SDP_ANSWER`, `ICE_CANDIDATE`, `NOTIFY_UNSUBSCRIBE`
- [x] Implement `handle_notify_subscriber`: create PeerConnection, add track from registry, create input data channel, generate SDP offer, send via signaling
- [x] Implement SDP H.264 Baseline profile constraint in `MediaEngine` codec registration
- [ ] Implement ICE server config: STUN + TURN (credentials fetched at startup; STUN + TurnConfig plumbing done, fetch blocked on backend/04)
- [x] Implement ICE connection state monitoring with logging and cleanup on failure
- [x] Implement `PEER_CONNECTIONS` map (DashMap or `Arc<Mutex<HashMap>>`) keyed by `tabId`
- [x] Implement full teardown on `NOTIFY_UNSUBSCRIBE`: close PeerConnection, update StreamRegistry
- [x] Re-send `AGENT_REGISTER` on signaling WebSocket reconnect to restore server-side state
- [ ] Integration test: connect a real browser tab to the agent, stream a display, verify video and input both work

---

## backend/05-update-distribution.md

- [x] Define manifest JSON schema and platform key enum in `infra/lambda/src/lib/manifest.ts`
- [x] Implement R2 S3 client helper with streaming get in `infra/lambda/src/lib/r2.ts`
- [x] Implement manifest handler: read `{env}/manifest.json` from R2, return JSON with cache headers
- [x] Implement download proxy handler: resolve platform from manifest, stream artifact from R2
- [x] Wire `GET /updates/manifest.json` and `GET /downloads/{platform}` routes in `infra/lib/tabbywebrtc-stack.ts`
- [x] Add `updatesFn` Lambda to `infra/lib/constructs/lambda-functions.ts` with R2 env vars
- [x] Pass `UPDATE_ENV_PREFIX` from CDK `envName` prop into updates Lambda
- [x] Add CDK outputs: `UpdateManifestUrl`, `DownloadBaseUrl`
- [x] Unit tests: manifest parsing, platform resolution, 404 for unknown platform
- [x] Document required deploy-time secrets (R2 credentials) in spec
- [x] Verify `cdk synth --context env=dev` and `cdk synth --context env=prod` complete without errors

---

## cicd/03-agent-release-distribution.md

- [x] Create `desktop-agent/packaging/deb/` with nfpm config, systemd unit, and postinstall script
- [x] Create `desktop-agent/packaging/wix/` with WiX source for Windows MSI
- [x] Create `desktop-agent/packaging/macos/build-pkg.sh` for macOS `.pkg` builds
- [x] Create `desktop-agent/packaging/build.sh` dispatcher invoked per matrix target
- [x] Extend `desktop-agent.yml` release workflow: package step after `cargo build --release`
- [x] Add SHA-256 computation step per installer artifact
- [x] Add publish job: generate `manifest.json` from build outputs
- [x] Add R2 upload step with env prefix (`dev` on main, `prod` on `v*` tag)
- [x] Upload manifest to `{env}/manifest.json` and artifacts to `{env}/{version}/`
- [x] Add R2 secrets to GitHub Secrets reference (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID`, `DEV_REST_URL`)
- [x] Create `scripts/publish-agent-release.sh` mirroring CI publish steps
- [x] Create root `README.md` with dev download link table (stub `REPLACE_DEV_REST_URL` placeholders)
- [ ] Verify tag release produces 5 installers + manifest in R2 `prod/` prefix
- [ ] Verify README dev links download correct artifact via API Gateway after deploy

---

## test-server/01-local-server.md

- [x] Scaffold NestJS TypeScript project in `testServer/` with `nest-cli.json`, `tsconfig.json`, `package.json`
- [x] Add dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/websockets`, `@nestjs/config`, `ws`, `jose`, `uuid`
- [x] Create `testServer/.env.example` and document all required env vars
- [x] Implement `StorageModule` with in-memory stores for connections, pending-sessions, agents, source_locks
- [x] Implement pending session TTL (30 s) and `REFRESH_SESSION` rotation
- [x] Implement `AuthModule`: `POST /auth/approve` with Clerk JWT verification and `AUTH_APPROVED` WebSocket push
- [x] Implement `AgentsModule`: `POST /agents/pair`, `GET /agents`, `AGENT_REGISTER`, `AGENT_HEARTBEAT`
- [x] Implement `SignalingModule`: WebSocket gateway on `ws` adapter; route inbound messages per `infra/lambda/src/router.ts`
- [x] Implement SDP/ICE relay, `SUBSCRIBE`/`UNSUBSCRIBE` source locking, `SOURCE_IN_USE`, `STREAM_CLOSED`
- [x] Implement `TurnModule`: `GET /turn-credentials` with HMAC-SHA256 credentials
- [x] Reuse or adapt JWT helpers from `infra/lambda/src/lib/jwt.ts` (no duplicated crypto logic)
- [x] Bind HTTP + WebSocket to `0.0.0.0`; detect and log primary LAN IPv4 on startup
- [x] Enable CORS for all origins in dev
- [x] On browser WebSocket connect: send `SESSION_PENDING { pendingSessionId, expiresIn: 30 }`
- [x] On agent WebSocket disconnect: mark agent offline, notify subscribers with `AGENT_OFFLINE`
- [x] Write unit tests for JWT issuance, pending session expiry, and source lock contention
- [x] Write integration test: browser WS connect → approve → `AUTH_APPROVED` → `SUBSCRIBE` → SDP round-trip
- [x] Create `scripts/dev-local.sh`: detect LAN IP, start testServer + Vite (`--host 0.0.0.0`) + desktop agent with temp config
- [x] Add `dev:local` script to root `package.json`
- [ ] Manual E2E: phone on same Wi‑Fi scans QR, approves session, WebRTC stream connects

---

## desktop-agent/05-auto-update.md

- [ ] Add `[updates]` config section (`enabled`, `base_url`, `channel`) to `config.rs`
- [ ] Bake default `base_url` from `TABBYWEBRTC_UPDATE_BASE_URL` at compile time
- [ ] Implement `platform_key()` runtime detection mapping OS/arch to manifest keys
- [ ] Implement `updater.rs` with `UpdateLoop` and random 2–4 h sleep interval
- [ ] Implement manifest fetch and semver comparison against `CARGO_PKG_VERSION`
- [ ] Implement artifact download to OS temp directory with progress logging
- [ ] Implement SHA-256 verification against manifest `artifacts[platform].sha256`
- [ ] Implement idle-gating: defer update when WebRTC peer connections are active
- [ ] Implement silent install per OS (`dpkg -i`, `msiexec /quiet`, `installer -pkg`)
- [ ] Implement process restart after successful install (systemd/launchctl/service helper)
- [ ] Wire `UpdateLoop` spawn in `agent.rs` after startup (skip during pairing flow)
- [ ] Honor `updates.enabled = false` to disable all update network activity
- [ ] Integration test with mock HTTP server serving fake manifest and artifact
- [ ] Amend `desktop-agent/01-overview.md`: threading model, startup sequence, out-of-scope file write rule
