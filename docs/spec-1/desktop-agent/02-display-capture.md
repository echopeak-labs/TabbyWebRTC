# Desktop Agent — Display Capture SDD

## Scope

Defines the framebuffer capture pipeline: per-platform capture APIs, H.264 encoding, thumbnail generation, window minimization override, and the capture loop task lifecycle.

---

## `Capturable` Trait

All capture sources implement a common trait:

```rust
pub trait Capturable: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    fn start(&mut self) -> anyhow::Result<()>;
    fn stop(&mut self);
    fn next_frame(&mut self) -> anyhow::Result<Frame>;
    fn capture_thumbnail(&mut self) -> anyhow::Result<Vec<u8>>;
}

pub struct Frame {
    pub data: Vec<u8>,        // Raw BGRA or NV12 pixel data
    pub format: PixelFormat,  // BGRA | NV12
    pub width: u32,
    pub height: u32,
    pub timestamp_us: u64,
}

pub enum PixelFormat { BGRA, NV12 }
```

---

## Platform Implementations

### Linux (PipeWire via XDG Desktop Portal)

- Crate: `ashpd` (XDG Desktop Portal bindings) + `pipewire` (PipeWire client).
- Flow:
  1. Request screen cast via `ScreenCastProxy::create_session()`.
  2. Select source type (Monitor or Window).
  3. Start stream → receive PipeWire `spa_video_info_raw` frames.
- Frame format: typically `NV12` or `BGRA` depending on compositor.
- Wayland and X11 are both supported via the portal abstraction.
- Cursor exclusion: Portal `CursorMode::Hidden` flag.

### Windows (DXGI Desktop Duplication)

- Crate: `windows` crate with `Win32_Graphics_Dxgi` feature.
- Flow:
  1. Enumerate adapters and outputs via `IDXGIFactory`.
  2. Call `IDXGIOutput1::DuplicateOutput` to open a duplication session.
  3. `AcquireNextFrame` → CPU-mapped BGRA surface.
- For per-window capture: `Windows.Graphics.Capture` API via `GraphicsCaptureItem::TryCreateFromWindowId`.
- Cursor exclusion: `IDXGIOutputDuplication` excludes cursor by default if `IncludeCursor` is not set.

### macOS (ScreenCaptureKit)

- Crate: `screencapturekit` (Rust bindings) or `objc2-screencapturekit`.
- Flow:
  1. `SCShareableContent::current()` to enumerate displays and windows.
  2. `SCStreamConfiguration` with `showsCursor: false`.
  3. `SCStream` with `SCStreamOutput` delegate receiving `CMSampleBuffer` frames.
- Frame format: `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange` (NV12).

---

## H.264 Encoding Pipeline

Each active `CaptureLoop` task maintains its own encoder instance.

### Hardware Encoder Selection (`encoder = "auto"`)

Priority order:
1. **NVENC** (NVIDIA) — via `ffmpeg-next` with `h264_nvenc` codec.
2. **VAAPI** (Linux Intel/AMD) — via `ffmpeg-next` with `h264_vaapi` codec.
3. **VideoToolbox** (macOS) — via `ffmpeg-next` with `h264_videotoolbox` codec.
4. **Software** (`openh264`) — fallback on any platform.

Encoder is selected once at `CaptureLoop` startup. If initialization fails, falls back to the next option.

### Encoder Parameters

```rust
EncoderParams {
    width: source.width(),
    height: source.height(),
    fps: config.capture.max_fps,       // 60
    bitrate_kbps: 8_000,               // Initial; adjusted by RTCRtpSender feedback
    keyframe_interval: 60,             // IDR every 60 frames (1 s at 60 fps)
    profile: H264Profile::Baseline,    // Maximum browser compatibility
    level: H264Level::Level4_1,
    rate_control: RateControl::CBR,
}
```

### RTP Packetization

Encoded NAL units are packetized into RTP using `webrtc-rs`'s built-in RTP packetizer.

- Payload type: 96 (dynamic, negotiated via SDP).
- Max RTP packet size: 1200 bytes (avoids IP fragmentation).
- NALU fragmentation: FU-A (RFC 6184 §5.8) for large NALUs.

---

## CaptureLoop Task

```rust
pub async fn run_capture_loop(
    mut source: Box<dyn Capturable>,
    track: Arc<TrackLocalStaticSample>,
    shutdown: CancellationToken,
) {
    source.start().unwrap();
    let mut encoder = Encoder::new(&source, &config).unwrap();
    let frame_duration = Duration::from_micros(1_000_000 / config.capture.max_fps as u64);

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            frame = tokio::task::spawn_blocking(|| source.next_frame()) => {
                let frame = frame.unwrap().unwrap();
                let encoded = encoder.encode(&frame).unwrap();
                for nal in encoded {
                    track.write_sample(&Sample {
                        data: nal.into(),
                        duration: frame_duration,
                        ..Default::default()
                    }).await.unwrap();
                }
            }
        }
    }

    source.stop();
}
```

`spawn_blocking` is used because `next_frame()` may block on the OS capture API.

---

## Stream Multiplexing

When a second browser tab subscribes to the same `sourceId`:

1. `StreamRegistry` checks if a `CaptureLoop` is already running for `sourceId`.
2. If yes: a new `TrackLocalStaticSample` is not created. Instead, the existing track is cloned and added to the new `RTCPeerConnection`.
3. The OS capture loop runs once. Both peers receive the same encoded RTP stream.
4. When subscriber count drops to 0: `CancellationToken::cancel()` stops the capture loop.

---

## Window Minimization Override

When a captured application window is minimized:

1. Agent subscribes to OS window state events.
2. On `WM_SIZE` (Windows) / `NSWindowWillMiniaturizeNotification` (macOS) / `_NET_WM_STATE` change (Linux): intercept the minimize action before it executes.
3. Instead of minimizing, move the window geometry off-screen: `SetWindowPos(hwnd, 0, -32000, -32000, ...)` (Windows) / equivalent on other platforms.
4. Window continues rendering. Frame stream is uninterrupted.
5. When the remote session ends and the tab unsubscribes, restore the window to its original geometry.

---

## Thumbnail Generation

The `ThumbnailServer` task handles `GET /thumbnail/<sourceId>` requests.

1. Call `source.capture_thumbnail()` which grabs a single frame.
2. Scale to 320×180 px using nearest-neighbor (fast).
3. Encode as JPEG at quality 60.
4. Return as `image/jpeg` response.
5. Cache for 5 minutes; invalidated on subscription change.
