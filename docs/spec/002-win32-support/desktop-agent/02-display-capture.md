# Desktop Agent — Windows Display Capture SDD

## Scope

Physical display enumeration and framebuffer streaming on Windows 11 desktop.
Closes W32-02 and W32-05. Builds on `001-init/desktop-agent/02-display-capture.md`
`Capturable` trait and capture loop.

---

## Physical Displays Only (W32-02)

Enumerate outputs with CCD / `QueryDisplayConfig` (or equivalent) and keep only
**physical** attached displays.

| Include | Exclude |
|---|---|
| Internal panels | Miracast / wireless displays that are virtual targets |
| Wired HDMI / DP / USB-C monitors | RDP / Hyper-V / virtual display adapters |
| Active desktop targets for the current session | Inactive / disconnected paths |

Each source id: `display-{stableIndex}` with host ordering stable across
enumerator polls when hardware is unchanged. Expose `name`, `width`, `height`
at native resolution.

When no physical display is present: return an empty display list (do not invent
`display-0` synthetic 1920×1080).

---

## Capture Pipeline (W32-05)

Preferred path for full-display capture:

1. Map each physical display to a DXGI output.
2. `IDXGIOutput1::DuplicateOutput` (or DuplicateOutput1) for that output.
3. `AcquireNextFrame` → CPU-mapped BGRA (or NV12 if encoder accepts GPU path).
4. Feed existing `CaptureLoop` + H.264 encoder selection from 001.

Cursor: exclude from the stream when `capture.hide_cursor = true` (default).

**Release / default Windows builds must use real capture.** Synthetic
`SyntheticCapturable` is allowed only behind an explicit test/dev feature flag,
never as the silent production fallback when DXGI fails — fail the stream and
surface an error to the viewer instead.

WGC (`Windows.Graphics.Capture`) may be used as an alternate display path if
DXGI duplication is unavailable for a specific adapter, but physical-filter
rules still apply.

---

## Streaming Contract

When the webapp / signaling layer commands a stream for `sourceId`:

1. Resolve `display-*` via enumerator.
2. Start one `CaptureLoop` at native width/height and configured `max_fps`.
3. Do not change host display mode, refresh rate, or scaling (vision out of
   scope).
4. Reuse 001 `StreamRegistry` multiplexing when a second peer joins the same
   `sourceId`.

---

## Session Boundaries

- Capture only the interactive session of the user running the agent.
- If the session locks: stop or freeze frames per OS rules; do not attempt to
  capture the secure desktop.
- Fast User Switch away: tear down capture; do not capture the other user’s
  desktop.

---

## Acceptance Criteria

1. Two physical monitors → two `display-*` sources with correct native sizes.
2. Adding a virtual display adapter does not add a streamable source.
3. Release binary without `scap-capture` still performs real DXGI capture (or
  documents the required feature and fails CI if missing).
4. Synthetic fallback is absent from release packaging.
5. Stream starts only after an authorized subscribe (001 signaling / local
   token).

---

## Out of Scope

- Per-app / window capture (see `03-app-capture.md`).
- Changing display topology or DPI.
- Headless / Session 0 capture.
