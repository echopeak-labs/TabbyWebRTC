# Desktop Agent — Overview SDD

## Scope

Defines the Rust desktop agent binary: architecture, threading model, component boundaries, startup sequence, configuration, and cross-platform targets. All other desktop-agent spec files are scoped to sub-components defined here.

---

## Binary Overview

- **Language:** Rust (stable toolchain, MSRV 1.80)
- **Binary name:** `tabbywebrtc-agent`
- **Run mode:** Standalone executable, no installer required. Can be registered as a system service.
- **Platforms:** Linux (priority), Windows, macOS.
- **Startup:** Reads config, connects to AWS WebSocket signaling, begins heartbeat loop. No GUI window.

---

## Cargo Workspace Layout

```
desktop-agent/
  Cargo.toml           # workspace
  Cargo.lock
  agent/               # main binary crate
    Cargo.toml
    src/
      main.rs
      config.rs
      agent.rs          # top-level Agent struct + run loop
  capture/             # display & window capture crate
    Cargo.toml
    src/
      lib.rs
      linux.rs
      windows.rs
      macos.rs
  input/               # input injection crate
    Cargo.toml
    src/
      lib.rs
      linux.rs
      windows.rs
      macos.rs
  webrtc_peer/         # WebRTC peer management crate
    Cargo.toml
    src/
      lib.rs
      peer.rs
      stream_registry.rs
  signaling/           # WebSocket signaling client crate
    Cargo.toml
    src/
      lib.rs
      client.rs
      messages.rs
```

---

## Key Dependencies

| Crate | Purpose |
|---|---|
| `webrtc` (webrtc-rs) | WebRTC stack: ICE, DTLS, SRTP, SDP, data channels |
| `tokio` | Async runtime (multi-thread) |
| `tokio-tungstenite` | WebSocket client |
| `serde` + `serde_json` | Message serialization |
| `enigo` | Cross-platform input injection (mouse + keyboard) |
| `scap` | Cross-platform screen capture (wraps DXGI/SCK/PipeWire) |
| `openh264` | Software H.264 encoder fallback |
| `ffmpeg-next` | Hardware-accelerated H.264 encoding (NVENC, VideoToolbox, VAAPI) |
| `ed25519-dalek` | Ed25519 keypair for agent pairing |
| `jsonwebtoken` | JWT validation for agent token |
| `keyring` | OS keychain storage for agent JWT |
| `tracing` + `tracing-subscriber` | Structured logging |
| `anyhow` | Error propagation |
| `clap` | CLI argument parsing |

---

## Threading Model

```
Main Thread (Tokio multi-thread runtime)
│
├── Task: SignalingClient          — WebSocket connection to AWS; send/recv messages
│     └── spawns per subscription:
│           Task: PeerManager      — one per active WebRTC peer connection
│                 ├── Task: CaptureLoop   — OS framebuffer → H.264 → RTP track
│                 └── Task: InputHandler  — Data channel recv → input injection
│
├── Task: HeartbeatLoop            — sends AGENT_HEARTBEAT every 9 min
├── Task: LocalServer              — HTTP + WebSocket server (port 7700): thumbnails, sources, local signaling, mDNS
└── Task: SourceEnumerator         — polls OS for display/window list changes every 30 s
```

All inter-task communication uses `tokio::sync::mpsc` and `tokio::sync::broadcast` channels. No `Arc<Mutex>` on hot paths.

---

## Configuration

Config file at `~/.config/tabbywebrtc/agent.toml` (Linux/macOS) or `%APPDATA%\TabbyWebRTC\agent.toml` (Windows).

```toml
[agent]
id = "..."                 # UUID, generated on first run
name = "Home Desktop"      # Human-readable name shown in UI

[signaling]
url = "wss://signal.tabbywebrtc.com/prod"

[capture]
encoder = "auto"           # "auto" | "nvenc" | "vaapi" | "videotoolbox" | "software"
max_fps = 60
hide_cursor = true         # Hide OS cursor from capture stream

[http]
thumbnail_port = 7700
bind = "0.0.0.0"           # loopback-only: set "127.0.0.1"; LAN guests need 0.0.0.0 + local_token

[input]
enabled = true             # false blocks all remote keyboard/mouse/clipboard/commands
allow_remote_power = false # SHUTDOWN/RESTART require explicit local allow

[updates]
enabled = true
base_url = "https://api.tabbywebrtc.com/prod"
channel = "dev"
```

Config is loaded at startup. If the config file does not exist, defaults are used and the file is created.

### Trust model

- Signaling authorization is necessary but not sufficient for destructive control: remote `SHUTDOWN` / `RESTART` are denied unless `input.allow_remote_power = true`.
- All remote input can be disabled with `input.enabled = false`.
- When `session_crypto.required = true` (and backend `REQUIRE_ENCRYPTED_SALT=true`), approve must include `encryptedSalt` and the agent must decrypt it with the pairing private key before accepting a subscriber.
- Local HTTP listens on all interfaces by default (`0.0.0.0`) so same-LAN guests can reach the agent; authenticated routes still require the HMAC `local_token` from `/info`. Set `http.bind = "127.0.0.1"` to restrict to loopback.
- Agent JWT possession (keychain) plus live signaling registration is the WAN trust boundary; TURN credentials are fetched with the agent JWT when `signaling.api_url` is configured.

---

## Startup Sequence

1. Parse CLI args (`--config <path>`, `--log-level <level>`).
2. Load config from TOML file.
3. Load agent JWT from OS keychain. If not found → print pairing instructions and exit.
4. Enumerate displays and application windows.
5. Start `LocalServer` on configured bind (default `127.0.0.1:7700`):
   - `GET /info` → agent metadata + short-lived local HMAC token
   - `GET /sources` → display + app list
   - `GET /thumbnail/<sourceId>` → JPEG thumbnail
   - `WS /signal` → local WebSocket signaling (SDP/ICE relay for LAN path)
6. Advertise mDNS service `_tabbywebrtc._tcp.local` on port 7700.
7. Start `SourceEnumerator` task.
9. Connect to AWS WebSocket signaling server with agent JWT in `Authorization` header (WAN path).
10. Send `AGENT_REGISTER` message with display/app list + `localEndpoint` URL.
11. Start `HeartbeatLoop`.
12. Enter main event loop (process signaling messages from both AWS WS and local WS clients in parallel).

---

## Agent Pairing (First Run)

If no agent JWT exists in the OS keychain:

1. Generate Ed25519 keypair. Store private key in OS keychain.
2. POST to `<REST_API>/agents/pair` with Clerk JWT (user must be logged in on the same machine in a browser or mobile).
3. Alternatively, display a setup URL: `https://app.tabbywebrtc.com/pair?agentId=<id>&pubkey=<base64>`.
4. On receipt of agent JWT from server, store in OS keychain.
5. Exit and prompt user to restart the agent.

---

## Out of Scope (Agent Must NOT Do)

- Adjust display resolution or refresh rate.
- Modify system audio settings.
- Open any GUI window (agent is headless).
- Write files outside its config directory.
- Accept WebRTC connections that have not been authorized — either via the AWS signaling server (WAN path) or via a valid local HMAC token on the local WS endpoint (LAN path).
