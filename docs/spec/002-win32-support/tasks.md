# Spec 002-win32-support — Agent Task Lists

Each section below corresponds to a spec file in
`docs/spec/002-win32-support/`. Tasks are ordered for sequential execution
within a spec. Check `agents.md` dependency graph and waves before starting.

Use `[ ]` / `[x]` to track individual task completion. No work is marked done
at spec creation.

---

## desktop-agent/01-overview.md

- [ ] Add Windows 11 desktop + x86_64 + interactive-session gate at agent
      startup; exit with clear error on Server / Win10 / Session 0
- [ ] Confirm config path `%APPDATA%\TabbyWebRTC\agent.toml` and keyring storage
      for agent JWT
- [ ] Implement per-user autostart helper (HKCU Run) install/remove without
      elevation
- [ ] Document Windows trust model in agent logs/README notes: no service, no
      admin, power commands gated by `allow_remote_power`
- [ ] Ensure auto-update path cannot re-register a Windows service
- [ ] Verify capability map inherit list (pairing, thumbnails, source lock)
      needs no 002 frontend/backend changes

---

## desktop-agent/02-display-capture.md

- [ ] Implement physical-display enumeration via `QueryDisplayConfig` / CCD;
      exclude virtual/RDP adapters
- [ ] Map each physical display to stable `display-{n}` source descriptors with
      native width/height
- [ ] Implement DXGI Desktop Duplication capture into existing `Capturable` /
      `CaptureLoop` pipeline
- [ ] Remove silent synthetic 1920×1080 fallback from Windows release path;
      fail stream with error instead
- [ ] Honor `capture.hide_cursor` on DXGI path
- [ ] Refuse capture when session is locked / not interactive
- [ ] Add unit or integration tests for filter logic where possible without a
      desktop (mock topology)

---

## desktop-agent/03-app-capture.md

- [ ] Enumerate current-session top-level capturable windows as `app-*` sources
- [ ] Filter cloaked, tool, and empty-title noise; handle UWP display names
- [ ] Mark or omit elevated/UIPI windows that cannot be captured
- [ ] Implement WGC window capture for `app-*` into `Capturable`
- [ ] Default minimized-window policy: fail stream (no off-screen `SetWindowPos`)
- [ ] Cleanly stop capture when target HWND is destroyed
- [ ] Tests for enumeration filters (HWND fixtures / mocks)

---

## desktop-agent/04-input.md

- [ ] Fix Meta modifier injection to use `VK_LWIN` / `VK_RWIN` instead of
      `VK_RCONTROL`
- [ ] Fix horizontal scroll to use `MOUSEEVENTF_HWHEEL`
- [ ] Soften Shutdown/Restart to avoid unconditional `EWX_FORCE`; keep
      `allow_remote_power` gate
- [ ] Correct Sleep command path to match documented suspend behavior
- [ ] Ensure failed `SendSAS` returns/logs error without success
- [ ] Add unit tests for key/modifier mapping and scroll flags

---

## cicd/01-windows-artifacts.md

- [ ] Rewrite WiX `main.wxs`: per-user install, LocalAppData target, remove
      `ServiceInstall` / `ServiceControl`
- [ ] Wire optional HKCU autostart from MSI or post-install script
- [ ] Confirm `packaging/build.sh` emits
      `tabbywebrtc-agent_{version}_x86_64.msi`
- [ ] Keep portable `.exe` as CI artifact; do not publish exe as
      `downloads/windows-x86_64`
- [ ] Ensure release matrix builds Windows with real capture features (no
      synthetic-only release)
- [ ] Verify publish job uploads MSI to R2 and
      `generate-manifest.sh` emits `windows-x86_64`
- [ ] Write Windows 11 host manual test checklist (W32-08)

---

## backend/01-windows-downloads.md

- [ ] Choose and document delivery strategy for large MSI (presigned 302 vs
      streaming)
- [ ] Implement strategy in `updates.ts` / `r2.ts` so MSI is not base64-buffered
      through API Gateway
- [ ] Keep `GET /downloads/windows-x86_64` resolving via manifest
      `artifacts.windows-x86_64`
- [ ] Preserve Linux/macOS download behavior
- [ ] Add unit tests for platform resolution, 404 paths, and large-object
      strategy
- [ ] Confirm no new AWS S3 bucket is added to CDK
- [ ] E2E: after cicd publish, `curl -L` download SHA-256 matches manifest
