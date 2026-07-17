# Frontend — Input Handling SDD

## Scope

Defines the complete client-side input pipeline: keyboard capture (scancode-based), mouse capture (absolute and relative modes), data channel transport, Keyboard Lock API, Pointer Lock API, and cursor synchronization strategy.

---

## Transport: WebRTC Data Channel

All input events are transmitted over the `"input_stream"` data channel created during WebRTC setup.

```ts
const inputChannel = peerConnection.createDataChannel('input_stream', {
  ordered: false,
  maxRetransmits: 0,
})
```

This gives UDP-like behavior: dropped packets are never retransmitted. Since coordinates are absolute and sent at 60–125 Hz, dropped intermediate packets are imperceptible.

---

## Input Payload Schema

All payloads are JSON-serialized strings sent via `inputChannel.send(...)`.

```ts
type InputPayload =
  | KeyDownPayload
  | KeyUpPayload
  | MouseMoveAbsolutePayload
  | MouseMoveRelativePayload
  | MouseButtonPayload
  | MouseScrollPayload
  | ClipboardPayload
  | CommandPayload

interface KeyDownPayload {
  type: 'KEY_DOWN'
  code: string
  modifiers: ModifierState
}

interface KeyUpPayload {
  type: 'KEY_UP'
  code: string
  modifiers: ModifierState
}

interface ModifierState {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

interface MouseMoveAbsolutePayload {
  type: 'MOUSE_MOVE_ABS'
  x: number
  y: number
}

interface MouseMoveRelativePayload {
  type: 'MOUSE_MOVE_REL'
  dx: number
  dy: number
}

interface MouseButtonPayload {
  type: 'MOUSE_DOWN' | 'MOUSE_UP'
  button: 0 | 1 | 2
  x: number
  y: number
}

interface MouseScrollPayload {
  type: 'MOUSE_SCROLL'
  deltaX: number
  deltaY: number
}

interface ClipboardPayload {
  type: 'CLIPBOARD_PASTE'
  text: string
}

interface CommandPayload {
  type: 'COMMAND'
  name: 'CTRL_ALT_DEL' | 'SLEEP' | 'RESTART' | 'SHUTDOWN' | 'LOCK'
}
```

---

## Keyboard Handling

### Physical Scancode Priority

- ALWAYS use `event.code`, NEVER `event.key` for key identity.
- `event.code` represents physical key position, independent of OS language/layout.
- `event.key` is only read for printable character fallback when `event.code` is unavailable.

```ts
window.addEventListener('keydown', (event) => {
  event.preventDefault()
  inputChannel.send(JSON.stringify({
    type: 'KEY_DOWN',
    code: event.code,
    modifiers: {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    },
  }))
}, { passive: false })

window.addEventListener('keyup', (event) => {
  event.preventDefault()
  inputChannel.send(JSON.stringify({
    type: 'KEY_UP',
    code: event.code,
    modifiers: {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    },
  }))
}, { passive: false })
```

### Keyboard Lock API

Must be invoked when the user enters `StreamPage`. Requires fullscreen.

```ts
async function activateKeyboardLock() {
  await document.documentElement.requestFullscreen()
  if (navigator.keyboard && 'lock' in navigator.keyboard) {
    await navigator.keyboard.lock([
      'ControlLeft', 'ControlRight',
      'AltLeft', 'AltRight',
      'Tab', 'Escape',
      'KeyW', 'KeyT', 'KeyN', 'KeyR',
      'F1', 'F2', 'F3', 'F4', 'F5',
      'MetaLeft', 'MetaRight',
    ])
  }
}
```

- Keyboard lock is released on `StreamPage` unmount via `navigator.keyboard.unlock()`.
- If fullscreen is exited by the user (e.g., pressing `Esc`), re-prompt with a non-blocking overlay.

---

## Mouse Handling

### Mode A: Absolute (Workspace / Desktop Interaction)

Default mode. Maps click coordinates to `[0.0, 1.0]` normalized space relative to the rendered video element.

```ts
function getAbsoluteCoordinates(
  event: MouseEvent,
  videoEl: HTMLVideoElement,
  nativeWidth: number,
  nativeHeight: number,
): { x: number; y: number } {
  const rect = videoEl.getBoundingClientRect()
  const scaleX = nativeWidth / rect.width
  const scaleY = nativeHeight / rect.height
  return {
    x: Math.round((event.clientX - rect.left) * scaleX),
    y: Math.round((event.clientY - rect.top) * scaleY),
  }
}
```

Coordinates are sent as absolute pixel values in the host's native resolution space. The agent maps directly to `SendInput` / `CGEventPost` / `/dev/uinput` without further scaling.

### Mode B: Relative (Pointer Lock / Gaming / 3D)

Activated by user toggle in control bar or when agent signals the source is a game/3D app.

```ts
videoElement.requestPointerLock()

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === videoElement) {
    document.addEventListener('mousemove', sendRelativeMouse)
  } else {
    document.removeEventListener('mousemove', sendRelativeMouse)
  }
})

function sendRelativeMouse(event: MouseEvent) {
  inputChannel.send(JSON.stringify({
    type: 'MOUSE_MOVE_REL',
    dx: event.movementX,
    dy: event.movementY,
  }))
}
```

### Mouse Events

- `mousemove`: throttled to 1 event per 8 ms (125 Hz cap) using a timestamp gate.
- `mousedown` / `mouseup`: transmitted immediately (no throttle).
- `wheel`: transmitted as `MOUSE_SCROLL` with `deltaX` and `deltaY`.
- Right-click context menu is suppressed: `videoEl.addEventListener('contextmenu', e => e.preventDefault())`.

---

## `useInputChannel` Hook Contract

```ts
interface UseInputChannelOptions {
  inputChannel: RTCDataChannel | null
  videoRef: RefObject<HTMLVideoElement>
  nativeWidth: number
  nativeHeight: number
  mode: 'absolute' | 'relative'
}

function useInputChannel(options: UseInputChannelOptions): {
  activateKeyboardLock: () => Promise<void>
  releaseKeyboardLock: () => void
  setMode: (mode: 'absolute' | 'relative') => void
}
```

- Attaches/detaches DOM event listeners based on `inputChannel` availability.
- Cleans up all listeners on unmount.

---

## Cursor Synchronization Strategy

- The host's OS cursor is hidden from the video encoding pipeline (agent sets `ShowCursor(false)` or equivalent).
- The browser renders a custom CSS cursor over the video element, tracking `mousemove` locally.
- This makes cursor movement feel instantaneous regardless of round-trip latency (20–50 ms).
- Custom cursor is a 16×16 Amber dot with a dark outline matching the Onyx theme.

---

## Control Bar Commands

The `ControlBar` component exposes buttons that send `CommandPayload` messages:

| Button | Command | Hotkey Equivalent |
|---|---|---|
| Process Manager | `CTRL_ALT_DEL` | Ctrl+Alt+Del |
| Sleep | `SLEEP` | — |
| Restart | `RESTART` | — |
| Shutdown | `SHUTDOWN` | — |
| Lock Screen | `LOCK` | Win+L / Ctrl+L |
| Paste Clipboard | `CLIPBOARD_PASTE` | Ctrl+V (remote) |

The `CLIPBOARD_PASTE` command reads `navigator.clipboard.readText()` and sends the result as a `ClipboardPayload`. Requires the page to be in focus and the user to have granted clipboard-read permission.
