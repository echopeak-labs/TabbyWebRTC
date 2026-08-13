# Desktop Agent — Windows App Capture SDD

## Scope

Enumerate running apps for the logged-in user and stream a chosen app’s
framebuffer. Closes W32-03 and app-facing parts of W32-07. Complements
`02-display-capture.md`.

---

## Enumeration Rules

Source of truth: top-level HWNDs / WGC window items owned by processes in the
**current interactive logon session**.

| Include | Exclude |
|---|---|
| Visible top-level windows with a non-empty title (or known UWP display name) | Tool windows, owned popups, cloaked windows |
| Packaged / UWP apps with a capturable window | Elevated / high-integrity windows the agent cannot open (UIPI) |
| One primary HWND per logical app when possible | Other users’ sessions, services, Session 0 |
| | Agent’s own windows (none expected — agent is headless) |

Source id: `app-{stableKey}` where `stableKey` is HWND hex or a stable
process+window key documented in code. Name field is the window title (or
package display name). Width/height are the current client or window pixel size.

Re-poll on the existing SourceEnumerator interval (~30 s) and on explicit
`REQUEST_SOURCES`.

---

## Capture Pipeline

Use `Windows.Graphics.Capture` /
`GraphicsCaptureItem::TryCreateFromWindowId` (or HWND equivalent) for
`app-*` sources.

1. Create capture item from the selected HWND.
2. Configure stream without cursor when `hide_cursor` is true.
3. Deliver frames into the same `Capturable` → encoder → RTP path as displays.
4. If WGC creation fails (elevated target, closed window): return a clear error;
   do not fall back to full-display capture silently.

---

## Minimized Windows

001 proposed moving minimized windows off-screen with `SetWindowPos` so DWM
keeps composing. For 002:

- **Default:** if the target is minimized, fail the stream start (or emit a
  user-visible “restore window” error). Do **not** relocate arbitrary HWNDs.
- Optional future flag `capture.allow_offscreen_restore` may implement the 001
  hack; off by default because it is invasive.

---

## UIPI and Elevation (W32-07)

- Do not list elevated windows as streamable if capture will fail, **or** list
  them with `capturable: false` / equivalent so the UI can gray them out.
- Never attempt integrity escalation to capture elevated apps.
- Secure desktop targets are never enumerated.

---

## Multi-HWND Apps

Browsers and Electron apps expose many HWNDs. Enumerate only top-level visible
windows the user would recognize (taskbar-level). Do not flatten every child
tab HWND as a separate app unless it is a top-level window.

---

## Streaming Contract

Same as display: stream only when commanded after auth; native resolution of
the window framebuffer; one CaptureLoop per `sourceId` with registry
multiplexing.

---

## Acceptance Criteria

1. Launchpad-style source list shows only current-user, non-cloaked apps.
2. Selecting an `app-*` source produces a WebRTC video track of that window.
3. Elevated Notepad (run as admin) is not silently captured; error or
   non-capturable flag.
4. Minimized apps do not get off-screen geometry changes by default.
5. Closing the app ends the capture loop cleanly.

---

## Out of Scope

- Injecting into elevated windows (see `04-input.md`).
- Capturing the lock screen or UAC desktop.
- Process-tree “all PIDs” listing without a window.
