# Desktop Agent — Windows Overview SDD

## Scope

Defines the Windows 11 host process identity, OS gate, install/autostart model,
and trust boundaries for the desktop agent. Closes W32-01, W32-04 (process
identity half), W32-06 (inherit vs 002), and parts of W32-07.

Related 001 specs: `001-init/desktop-agent/01-overview.md`,
`001-init/desktop-agent/05-auto-update.md`.

---

## Capability Map (Windows host)

| Requirement | Source | Status for 002 |
|---|---|---|
| Windows 11 desktop edition only | criteria | in-criteria |
| Enumerate N physical displays | criteria | in-criteria → `02-display-capture` |
| Stream display when webapp commands | criteria + vision | in-criteria → `02` |
| Enumerate logged-in user apps | criteria | in-criteria → `03-app-capture` |
| Stream per-app framebuffer | criteria + vision | in-criteria → `03` |
| Portable `.exe` + MSI CI artifacts | criteria | in-criteria → `cicd/01` |
| MSI downloadable via REST | plan / infra | in-criteria → `backend/01` |
| Pairing / Clerk mobile key auth | vision | already-in-001 (inherit) |
| Thumbnails every 5 min | vision | already-in-001 (inherit) |
| Near-native mouse/keyboard | vision | implied → `04-input` |
| Source lock one stream per tab | vision | already-in-001 (inherit) |
| Auto-update client | vision | already-in-001 (inherit; must not reinstall a service) |
| Display resolution changes by agent | vision out-of-scope | out-of-scope-for-002 |

---

## Platform Gate

- Supported: **Windows 11 desktop edition**, **x86_64 only**.
- Unsupported: Windows 10, Windows Server, Windows 11 ARM, Session 0 / service
  hosts.
- On startup the agent must verify:
  1. OS build is Windows 11 (major version / build threshold via
     `RtlGetVersion` or equivalent).
  2. Product type is desktop workstation (`GetProductInfo` / `VER_NT_WORKSTATION`),
     not server.
  3. Process is running in an interactive user session (not Session 0).
- If any check fails: log a clear error and exit non-zero. Do not fall back to
  synthetic capture.

---

## Process Identity (W32-01)

**Locked decision:** the Windows agent runs only in the **interactive logged-in
user session**.

| Must | Must not |
|---|---|
| Medium integrity, current user | Run as SYSTEM / LocalService |
| Autostart via per-user Run key or Startup folder | Register a Windows service |
| Install under `%LOCALAPPDATA%\TabbyWebRTC\` (per-user) | `InstallScope="perMachine"` + `ServiceInstall` |
| Capture and inject only for the current logon session | Capture other users / Fast User Switching / RDP shadow |

The current WiX in `components/desktop-agent/packaging/wix/main.wxs` that
registers `tabbywebrtc-agent` as a service is **incorrect** and must be replaced
by the cicd domain (`cicd/01-windows-artifacts.md`).

---

## Config Paths (Windows)

| Item | Path |
|---|---|
| Config | `%APPDATA%\TabbyWebRTC\agent.toml` |
| JWT / keypair | Windows Credential Manager via `keyring` |
| Install dir (MSI) | `%LOCALAPPDATA%\TabbyWebRTC\` |
| Portable exe | user-chosen directory; no service registration |

Inherit `[input]`, `[http]`, `[capture]`, `[updates]` keys from 001 overview.
Defaults that matter on Windows:

- `input.allow_remote_power = false`
- `input.enabled = true` (user may set false)
- `http.bind` defaults per 001 DA-02 remediation; LAN bind requires
  `local_token` on protected routes

---

## Autostart

After MSI install (or first portable run with `--install-autostart`):

1. Write a per-user autostart entry that launches
   `%LOCALAPPDATA%\TabbyWebRTC\tabbywebrtc-agent.exe` at logon.
2. Prefer `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
3. Uninstall / `--remove-autostart` removes that entry.
4. Autostart must not request elevation.

---

## Trust Model (Windows additions)

Inherit 001 trust model, then add:

- No admin elevation at install or runtime for normal capture/input.
- Secure desktop (lock screen, UAC, Ctrl+Alt+Del) is **not** capturable or
  injectable from this process (W32-07). Control-bar “Process manager” must not
  claim real SAS success when `SendSAS` fails.
- Remote power commands remain gated by `input.allow_remote_power`.
- Auto-update must replace the per-user payload only; it must never install or
  re-enable a Windows service.

---

## Inherit From 001 (W32-06)

002 does **not** re-spec these; implementers use 001 behavior:

- Pairing + agent JWT + signaling register
- Local HTTP `/info`, `/sources`, `/thumbnail`, `/signal` + HMAC `local_token`
- WebRTC peer + stream registry + source locking
- Thumbnail cadence (auth + every 5 minutes)
- Update poll / SHA-256 verify against `GET /downloads/{platform}`

002 **does** own Windows-specific capture, app enum, input fixes, packaging,
and download serving for the MSI.

---

## Acceptance Criteria

1. Agent refuses to start on Windows Server / Windows 10 with a clear log line.
2. Agent refuses to start in Session 0.
3. No Windows service named `tabbywebrtc-agent` is created by the supported
   install path.
4. Config and credentials live under the interactive user’s profile / keychain.
5. Autostart is per-user and unelevated.

---

## Out of Scope

- Authenticode signing (001 blocker #6).
- Elevated helper for real Secure Attention Sequence.
- Windows 11 ARM.
- Frontend/backend auth redesign.
