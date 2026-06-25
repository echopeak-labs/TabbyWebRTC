# Technical Specification & Product Vision: WebRTC-Based Multi-Display RDP

## 1. Product Vision & Architecture Overview

The goal is to build a high-performance, ultra-low-latency remote desktop
solution that leverages standard web browsers as the rendering environment. The
solution enables a single host machine running a lightweight **Desktop Agent**
to stream physical monitors, virtual displays, or isolated application windows
across **$N$ independent browser tabs** (initially optimized for up to 3-4
concurrent streams).

Each browser tab operates as a discrete WebRTC renderer and input capture
surface. Keyboard and mouse inputs are collected inside each tab and routed back
to the host via peer-to-peer WebRTC Data Channels, minimizing round-trip input
lag.

```
+---------------------------------------------------------------------------------------+
|                                     WEB BROWSER                                       |
|  +--------------------+    +--------------------+    +-----------------------------+  |
|  | Tab 1: Monitor 1   |    | Tab 2: Monitor 2   |    | Tab 3: Isolated App (Slack) |  |
|  | HTML5 Video Tag    |    | HTML5 Video Tag    |    | HTML5 Video Tag             |  |
|  | WebRTC Data Chan   |    | WebRTC Data Chan   |    | WebRTC Data Chan            |  |
|  +---------+----------+    +---------+----------+    +--------------+--------------+  |
+------------|-------------------------|------------------------------|-----------------+
             | (WebRTC Video Stream & Input Data Channel P2P)        |
             +-------------------------+------------------------------+
                                       |
+--------------------------------------v------------------------------------------------+
|                                  HOST MACHINE                                         |
|  +---------------------------------------------------------------------------------+  |
|  |                                 DESKTOP AGENT                                   |  |
|  |  +-----------------------+  +-----------------------+  +---------------------+  |  |
|  |  | Monitor 1 DXGI Stream |  | Monitor 2 DXGI Stream |  | Win Graphics Capture|  |  |
|  |  +-----------------------+  +-----------------------+  +---------------------+  |  |
|  |  |     H.264 Encoder     |  |     H.264 Encoder     |  |    H.264 Encoder    |  |  |
|  |  +-----------------------+  +-----------------------+  +---------------------+  |  |
|  |  |                   Input Coordinate Mapping & Injection Engine                 |  |  |
|  |  +-------------------------------------------------------------------------------+  |  |
|  +---------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------+
```

---

## 2. Core Technical Stack

### 2.1 The Desktop Agent (Server)

The agent runs locally on the workstation, exposing native hardware interfaces
to the WebRTC subsystem.

- **Language Layer:** **Rust** (`webrtc-rs`) or **Go** (`Pion`). These compiled
  languages provide fine-grained memory management and the multi-threaded
  concurrency needed to handle simultaneous real-time video encoding pipelines
  without blocking.
- **Display & App Capture Layer:** Uses hardware-accelerated, platform-native
  APIs to pull framebuffers directly from the GPU:
  - _Windows:_ DXGI Desktop Duplication API (for physical monitors);
    `Windows.Graphics.Capture` (for target window framebuffers).
  - _macOS:_ ScreenCaptureKit (handles both `SCDisplay` and `SCWindow` target
    configurations).
  - _Linux:_ PipeWire via XDG Desktop Portal (supports Wayland and X11
    workflows).
- **Input Injection Engine:** Cross-platform native input libraries (`enigo` in
  Rust, `robotgo` in Go) paired with platform-specific Win32 background
  messaging wrappers (`PostMessage`, `SendInput`) to deliver targeted
  interaction events.

### 2.2 The Web Application (Renderer)

A clean, lightweight client interface optimized for low computational overhead.

- **Frontend Core:** TypeScript with modern framework implementation (React/Vue)
  or highly optimized Vanilla DOM components.
- **Video Decoded Layer:** Standard HTML5 `<video>` tags utilizing `autoplay`,
  `playsinline`, and absolute low-latency configurations attached directly to
  inbound `MediaStream` tracks.
- **Input Management:** DOM structural event interception (`mousemove`,
  `mousedown`, `mouseup`, `keydown`, `keyup`) configured to extract normalized
  positional vectors ($0.0$ to $1.0$).
- **Transport Protocols:** WebRTC PeerConnections for H.264 encoded video
  channels combined with **WebRTC Data Channels** operating over SCTP
  (unreliable, unordered mode preferred) to handle mouse and keyboard inputs at
  a P2P UDP transport level.

---

## 3. Dynamic Execution & Capture Routing

To optimize local CPU/GPU utilization, the Desktop Agent relies on a strict
**on-demand stream lifecycle**:

1.  **Signaling Handshake:** When a user opens a browser tab, a lightweight
    WebSocket message lists the available hardware resources (Monitor IDs,
    active application Window handles).
2.  **Stream Allocation:** When a tab selects a target (e.g., _Monitor 2_), the
    tab issues a WebRTC Offer. If no other client is currently viewing _Monitor
    2_, the Desktop Agent initializes the OS-native capture loop, sets up an
    instance of an H.264 hardware encoder, and attaches the resulting track to
    the peer connection.
3.  **Stream Multiplexing:** If a second tab or user attaches to an identical
    source, the agent re-uses the existing encoder output track, eliminating
    redundant encoding cycles.
4.  **Tear-down Optimization:** The moment a tab closes or changes its source
    configuration, the agent updates its subscriber registry. If a source's
    subscriber count reaches zero, the underlying OS hook and encoder pipeline
    are instantly killed.

---

## 4. Resolving Window-Level Capture Edge Cases

Capturing independent applications (like Slack) without relying on virtual
monitors presents unique technical constraints. Below are the architectural
workarounds required:

### 4.1 Window Overlaps & Occlusions

- **Native Behavior:** Modern composition architectures
  (`Windows.Graphics.Capture` and `ScreenCaptureKit`) sample frames straight
  from the application's unique surface buffer _before_ it is rendered to the
  overall display layout by the desktop compositor.
- **Resolution:** Even if another application is dragged completely over the
  target app on the host machine, the browser tab will continue to stream the
  target app cleanly and without visual obstruction.

### 4.2 The App Minimization Freeze

- **The Problem:** When an application is minimized to the taskbar or dock, the
  OS ceases to update its rendering loops to preserve resources. The frame
  stream immediately freezes or goes black.
- **Resolution:** The Desktop Agent must listen to window status events. If the
  user minimizes the target application, the agent cancels the native OS
  minimization execution and instead moves the window geometry to a set of
  off-screen coordinates (e.g., `X: -20000, Y: -20000`). This keeps the window
  actively rendering in the OS environment while rendering it invisible on the
  physical host display.

### 4.3 Background Input & Focus Clashes

- **The Problem:** Standard input engines require a window to have active OS
  focus to process keystrokes. Forcing focus on a hidden or target window causes
  "focus stealing" conflicts if the host user is working on another screen.
- **Resolution:** The Web client captures incoming clicks, translates them to
  absolute window coordinates, and the agent uses native pointer injection hooks
  (`PostMessage` with `WM_LBUTTONDOWN` / `WM_LBUTTONUP` on Windows). For
  keyboard processing, text inputs must be sent as specific background messages
  (`WM_CHAR` or `WM_UNICHAR`). If an application (such as complex Electron apps)
  refuses background inputs, it must be programmatically pulled to the
  foreground on an un-utilized display or secondary screen partition before
  processing inputs.

---

## 5. Bandwidth Matrix (Per-Stream Targets)

All computations assume **1080p resolution at 60 Frames Per Second** using H.264
encoding. Bitrates scales dynamically based on delta frames:

| Activity Profile    | Description                                                        | Estimated Bandwidth (Per Tab) | Total Bandwidth (3 Tabs Active) |
| :------------------ | :----------------------------------------------------------------- | :---------------------------- | :------------------------------ |
| **Low Activity**    | Static code editor, text-based document reading, minimal typing    | **1.0 – 3.0 Mbps**            | **3.0 – 9.0 Mbps**              |
| **Medium Activity** | Standard web browsing, fluid UI panel transitions, window dragging | **4.0 – 8.0 Mbps**            | **12.0 – 24.0 Mbps**            |
| **High Activity**   | Rapidly scrolling interfaces, video playbacks, rich animations     | **10.0 – 15.00 Mbps**         | **30.0 – 45.0+ Mbps**           |

_Implementation Note:_ To prevent local network saturated chokes, the frontend
web application can explicitly apply `encodings` constraints on the
`RTCRtpSender` object, enforcing hard caps on maximum bitrates per stream
allocation.

---

## 6. Serverless Infrastructure Blueprint ($0/Month Strategy)

To achieve zero infrastructure costs while scaling up to 10+ simultaneous users,
the platform separates the high-bandwidth data plane (WebRTC P2P) from the
lightweight control plane (Signaling).

### 6.1 Control Plane & Static Hosting ($0)

- **Web Renderer Hosting:** Host the frontend static assets on **Cloudflare
  Pages** or **Vercel**. Both offer global edge networks with $0 cost, zero data
  egress penalties, and automated SSL orchestration.
- **Signaling Architecture:** Deploy an serverless event architecture on **AWS
  Lambda** routed through an **AWS API Gateway WebSocket API**.
  - _Cost Calculation:_ AWS Free Tier includes 1,000,000 WebSocket connection
    minutes and 1,000,000 inbound messages per month. 10 users streaming 8 hours
    per day for 30 days totals 144,000 connection minutes, well within the
    permanently free limit.

### 6.2 Data Plane & NAT Traversal Traps

- **Local Network Optimization (LAN):** For users operating inside the same
  local area network or corporate subnet, WebRTC automatically resolves to local
  P2P configurations. High-bandwidth stream data flows over physical routers and
  internal switches, incurring exactly $0 in cloud data transit or internet data
  egress costs.
- **Remote WebRTC Relays (WAN):** When remote users connect behind restrictive
  Symmetric NAT routers, direct P2P socket holes cannot be bound, forcing the
  stream to fallback to a **TURN relay server**.
  - _Free Scaling Limit:_ Free external STUN/TURN relays (e.g., Metered.ca open
    relay networks) generally cap monthly data at **50 GB to 100 GB**.
  - _Scale Footprint for 10+ Concurrent Users:_ If 10 remote users stream 2
    concurrent sessions at medium activity profiles (8 Mbps total) for 4 hours
    daily, they generate ~4.3 TB of monthly transit data. If 20% of those
    connections require a TURN relay due to firewall topologies, transit hits
    **~860 GB/month**, exhausting standard free limits.
  - _Mitigation Architecture:_ To scale past the free tier for 10+ remote users
    without incurring high AWS Data Transfer Out fees ($0.09/GB after first
    100GB), deploy a dedicated **CoTURN** instance on an ultra-cheap,
    high-bandwidth unmetered VPS node (e.g., Hetzner, Linode, or OVH for
    ~$5/month), completely avoiding standard AWS EC2 data transport premiums.
