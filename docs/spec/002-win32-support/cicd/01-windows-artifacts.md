# CI/CD — Windows Artifacts SDD

## Scope

Portable `.exe` and per-user MSI for Windows 11 x86_64, published so the MSI
lands in the S3-compatible release bucket and appears in `manifest.json` as
`windows-x86_64`. Closes W32-01 (packaging half), W32-04, W32-08. Extends
`001-init/cicd/03-agent-release-distribution.md` without replacing Linux/macOS
jobs.

---

## Artifacts

| Artifact | Produced by | Distributed via |
|---|---|---|
| `tabbywebrtc-agent-windows-x86_64.exe` | `cargo build --release` on `windows-latest` | GitHub Actions artifact / tag assets only |
| `tabbywebrtc-agent_{version}_x86_64.msi` | WiX via `packaging/build.sh` | R2 + `GET /downloads/windows-x86_64` |

The portable exe is **not** the REST downloads payload. Only the MSI is listed
under `artifacts.windows-x86_64` in `manifest.json`.

Filename must keep the `*_x86_64.msi` suffix so
`scripts/generate-manifest.sh` maps it to `windows-x86_64`.

---

## WiX / MSI Changes (W32-01, W32-04)

Rewrite `components/desktop-agent/packaging/wix/main.wxs`:

1. Remove `ServiceInstall` and `ServiceControl`.
2. Use per-user install scope (`InstallScope="perUser"` or equivalent Directory
   under `LocalAppDataFolder`).
3. Install binary to `%LOCALAPPDATA%\TabbyWebRTC\tabbywebrtc-agent.exe`.
4. Optionally write HKCU Run key for autostart (or a small custom action /
   companion script documented in the desktop-agent overview).
5. MajorUpgrade must not leave a leftover service from older broken builds —
   document a one-time cleanup note if upgrading from a service-based MSI.

No Authenticode signing in this spec (001 blocker #6 remains).

---

## Workflow

Keep [`.github/workflows/desktop-agent.yml`](../../../../.github/workflows/desktop-agent.yml):

1. Matrix entry `windows-x86_64` builds with real capture features required for
   release (no silent synthetic-only Windows release).
2. Package step produces the MSI into `packaged/`.
3. Publish job uploads `*.msi` (and other platform installers) to
   `s3://{bucket}/{env}/{version}/` via R2 endpoint.
4. `generate-manifest.sh` includes `windows-x86_64` when the MSI is present.

Do not create a second Windows-only workflow unless the shared matrix cannot
express a required step.

---

## Host Test Matrix (W32-08)

GitHub `windows-latest` is Windows Server. It can build and package; it cannot
prove physical-display DXGI/WGC behavior.

Document a manual / host checklist (run on a real Windows 11 desktop):

- [ ] OS gate accepts Windows 11 desktop x64
- [ ] OS gate rejects (or is N/A on) Server runners for runtime tests
- [ ] Physical displays enumerated; virtual adapters omitted
- [ ] App list shows current-user windows only
- [ ] Display stream + app stream end-to-end with a Chromium guest
- [ ] MSI installs per-user, no service created
- [ ] Autostart launches agent at logon without UAC
- [ ] `curl` / browser `GET {RestEndpoint}/downloads/windows-x86_64` yields the
      published MSI (depends on `backend/01`)

---

## Acceptance Criteria

1. CI produces both `.exe` and `.msi` for `windows-x86_64`.
2. Published MSI has no service registration.
3. Manifest contains `windows-x86_64` with sha256 and size_bytes.
4. Portable exe is available as a CI artifact but not as the downloads key.
5. Host test matrix is written next to packaging docs or in this folder’s notes.

---

## Out of Scope

- Buying Authenticode certificates.
- AWS native S3 bucket (use existing R2 via S3 API).
- Changing Linux/macOS packaging.
