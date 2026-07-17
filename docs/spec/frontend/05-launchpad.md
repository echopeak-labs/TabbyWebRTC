# Frontend — Launchpad & Stream UI SDD

## Scope

Defines the post-authentication UI: the Launchpad screen (display + app picker), StreamPage (active remote view), ControlBar, and thumbnail polling behavior.

---

## LaunchpadPage

### Layout

Two-column grid layout (full-height, scrollable).

```
+--------------------------------------------------+
| TopBar: "TabbyWebRTC" | Agent: "Home Desktop" | ...  |
+------------------------+-------------------------+
|                        |                         |
|  Displays (left col)   |  Applications (right)   |
|                        |                         |
|  [ Display #1 ]        |  [ Slack           ]    |
|  [ Display #2 ]        |  [ VS Code         ]    |
|                        |  [ Terminal        ]    |
|                        |  [ Chrome          ]    |
|                        |                         |
+------------------------+-------------------------+
```

- Left column: physical displays as `DisplayCard` components.
- Right column: scrollable list of `AppCard` components (running application windows enumerated by the agent).
- Both columns use a `gap-4` grid.
- On screens < 768 px wide, the two columns stack vertically (displays first, apps below).

---

## `DisplayCard` Component

```tsx
interface DisplayCardProps {
  display: Display
  onClick: (displayId: string) => void
}
```

Visual states:

| State | Appearance |
|---|---|
| Available | Amber border on hover, thumbnail image, display name |
| In Use (other tab) | Grayscale thumbnail, lock icon overlay, "In use" badge |
| Offline | Dashed border, "Unavailable" text |
| Selected/Loading | Amber pulsing ring, spinner overlay |

- Thumbnail: 16:9 aspect ratio card. If `thumbnailUrl` is `null`, show a dark placeholder with a monitor icon.
- Display name: `"Display #1"`, `"Display #2"`, etc. as reported by the agent (index-based, matching OS enumeration order).
- Clicking an available card triggers `router.push(/stream/${display.id})`.

---

## `AppCard` Component

```tsx
interface AppCardProps {
  app: AppWindow
  onClick: (appId: string) => void
}
```

- Rendered as a horizontal list item: thumbnail (64×36 px) on left, app name on right.
- Same in-use locking logic as `DisplayCard`.
- App name sourced from the OS window title (truncated to 40 chars).

---

## Thumbnail Polling — `useThumbnailPoller`

```ts
function useThumbnailPoller(agentBaseUrl: string, token: string): void
```

- On mount: immediately fetches thumbnails for all displays and apps.
- Sets a 5-minute interval (`300_000` ms) to re-fetch all thumbnails.
- Updates `agentStore` with new `thumbnailUrl` values.
- On unmount: clears the interval.
- Thumbnail endpoint per source: `GET <agentBaseUrl>/thumbnail/<sourceId>`.
- If the agent is unreachable, the existing cached thumbnail is preserved (no blank flash).

---

## StreamPage

### Layout

Full-screen dark view. The video element fills the viewport.

```
+--------------------------------------------------+
|   [ControlBar — hidden until hover / hotkey]     |
|                                                  |
|                                                  |
|              <video> (WebRTC stream)             |
|                                                  |
|                                                  |
+--------------------------------------------------+
```

- The `<video>` element uses `width: 100vw; height: 100vh; object-fit: contain`.
- Black letterbox bars appear on mismatched aspect ratios.
- ControlBar auto-hides after 3 s of no cursor movement. Reappears on `mousemove` or `Ctrl+Shift+C`.

### Aspect Ratio & Mouse Calibration

When the host display is 4K (3840×2160) and the browser viewport is 1080p (1920×1080):

1. `object-fit: contain` renders the video at the largest possible size that fits the viewport while preserving aspect ratio.
2. The actual rendered video dimensions are read via `videoEl.getBoundingClientRect()`.
3. Mouse coordinates are computed relative to the rendered bounding box, then scaled to native resolution.
4. This math is encapsulated in `getAbsoluteCoordinates()` (see `04-input-handling.md`).

When the host display is ultrawide (3440×1440) and the browser is 16:9 (1920×1080):

- Letterbox bars appear on top and bottom.
- Mouse clicks outside the video bounding box are silently ignored (no coordinates sent).

---

## ControlBar Component

Floats at the bottom of the viewport. Semi-transparent dark background. Amber accent icons.

```
+--------------------------------------------------+
| [Ctrl+Alt+Del] [Lock] [Sleep] [Restart] [Shutdown] | [Paste] | [Mode: Abs/Rel] | [Bitrate] | [Exit] |
+--------------------------------------------------+
```

### Items

| Element | Type | Action |
|---|---|---|
| Ctrl+Alt+Del | Button | Sends `COMMAND { name: 'CTRL_ALT_DEL' }` |
| Lock Screen | Button | Sends `COMMAND { name: 'LOCK' }` |
| Sleep | Button | Sends `COMMAND { name: 'SLEEP' }` |
| Restart | Button | Sends `COMMAND { name: 'RESTART' }` with confirm dialog |
| Shutdown | Button | Sends `COMMAND { name: 'SHUTDOWN' }` with confirm dialog |
| Paste | Button | Reads clipboard → sends `CLIPBOARD_PASTE` |
| Mode Toggle | Toggle | Switches between `absolute` and `relative` mouse modes |
| Bitrate | Select | Low / Medium / High — calls `applyBitrateCap()` |
| Exit | Button | Calls `disconnect()` → navigates to `/launchpad` |

---

## TopBar Component

Persistent across `LaunchpadPage` and `StreamPage`.

```
TabbyWebRTC   [Agent: "Home Desktop" ▾]   [Connection: LAN / WAN badge]   [Latency: 12 ms]   [Avatar ▾]
```

- Agent selector dropdown: lists all registered agents. Switching agents clears stream state and reloads launchpad.
- Connection badge: "LAN" (green) if ICE selected pair is host/srflx, "WAN" (amber) if relay.
- Latency: computed from WebRTC `getStats()` → `currentRoundTripTime` × 1000, updated every 2 s.
- Avatar dropdown: "Sign Out" → clears session, navigates to `/`.

---

## Non-Functional Requirements

- Launchpad must render within 500 ms of navigation (thumbnails can lazy-load after).
- ControlBar must not block mouse events when hidden (use `pointer-events: none`).
- All confirm dialogs (Restart, Shutdown) must be dismissible with `Escape`.
- StreamPage must support fullscreen entry via the F11 key (triggers `requestFullscreen` + Keyboard Lock).
