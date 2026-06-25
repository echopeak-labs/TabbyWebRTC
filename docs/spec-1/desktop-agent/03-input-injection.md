# Desktop Agent — Input Injection SDD

## Scope

Defines how the desktop agent receives input payloads from the WebRTC data channel and injects them into the host OS: keyboard injection, mouse injection (absolute and relative), scroll, clipboard paste, and command execution. Covers all three platforms.

---

## `InputInjector` Trait

```rust
pub trait InputInjector: Send {
    fn key_down(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()>;
    fn key_up(&mut self, code: &str, modifiers: &ModifierState) -> anyhow::Result<()>;
    fn mouse_move_abs(&mut self, x: i32, y: i32) -> anyhow::Result<()>;
    fn mouse_move_rel(&mut self, dx: i32, dy: i32) -> anyhow::Result<()>;
    fn mouse_down(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()>;
    fn mouse_up(&mut self, button: MouseButton, x: i32, y: i32) -> anyhow::Result<()>;
    fn mouse_scroll(&mut self, delta_x: i32, delta_y: i32) -> anyhow::Result<()>;
    fn clipboard_paste(&mut self, text: &str) -> anyhow::Result<()>;
    fn execute_command(&mut self, cmd: &AgentCommand) -> anyhow::Result<()>;
}

pub struct ModifierState {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

pub enum MouseButton { Left, Middle, Right }

pub enum AgentCommand {
    CtrlAltDel,
    Sleep,
    Restart,
    Shutdown,
    LockScreen,
}
```

---

## Input Payload Deserialization

The `InputHandler` task reads raw JSON strings from the WebRTC data channel and dispatches them:

```rust
pub async fn run_input_handler(
    mut data_channel: Arc<RTCDataChannel>,
    injector: Arc<Mutex<Box<dyn InputInjector>>>,
) {
    data_channel.on_message(Box::new(move |msg: DataChannelMessage| {
        let injector = injector.clone();
        Box::pin(async move {
            let payload: InputPayload = match serde_json::from_slice(&msg.data) {
                Ok(p) => p,
                Err(_) => return,
            };
            let mut inj = injector.lock().await;
            let _ = match payload {
                InputPayload::KeyDown { code, modifiers } => inj.key_down(&code, &modifiers),
                InputPayload::KeyUp { code, modifiers } => inj.key_up(&code, &modifiers),
                InputPayload::MouseMoveAbs { x, y } => inj.mouse_move_abs(x, y),
                InputPayload::MouseMoveRel { dx, dy } => inj.mouse_move_rel(dx, dy),
                InputPayload::MouseDown { button, x, y } => inj.mouse_down(button, x, y),
                InputPayload::MouseUp { button, x, y } => inj.mouse_up(button, x, y),
                InputPayload::MouseScroll { delta_x, delta_y } => inj.mouse_scroll(delta_x, delta_y),
                InputPayload::ClipboardPaste { text } => inj.clipboard_paste(&text),
                InputPayload::Command { name } => inj.execute_command(&name),
            };
        })
    }));
}
```

---

## Scancode → Virtual Key Mapping

Browser sends `event.code` strings (e.g., `"KeyA"`, `"ArrowLeft"`, `"F5"`). The agent maps these to platform virtual key codes.

```rust
pub fn code_to_vk_windows(code: &str) -> Option<u16> {
    match code {
        "KeyA" => Some(0x41), "KeyB" => Some(0x42),
        "Enter" => Some(0x0D), "Escape" => Some(0x1B),
        "ArrowLeft" => Some(0x25), "ArrowRight" => Some(0x27),
        "ArrowUp" => Some(0x26), "ArrowDown" => Some(0x28),
        "F1" => Some(0x70), "F2" => Some(0x71),
        "ControlLeft" | "ControlRight" => Some(0x11),
        "AltLeft" | "AltRight" => Some(0x12),
        "ShiftLeft" | "ShiftRight" => Some(0x10),
        "Tab" => Some(0x09), "Space" => Some(0x20),
        _ => None,
    }
}
```

Equivalent mapping tables exist for macOS (`CGKeyCode`) and Linux (`evdev` keycodes).

---

## Platform Implementations

### Linux

Primary: `/dev/uinput` (kernel-level input device emulation).

```rust
pub struct LinuxInjector {
    uinput_kb: UInputDevice,   // virtual keyboard
    uinput_mouse: UInputDevice, // virtual mouse
}
```

Setup:
1. Open `/dev/uinput` with `O_WRONLY | O_NONBLOCK`.
2. Register `UI_SET_EVBIT(EV_KEY)` + all key codes.
3. Register `UI_SET_EVBIT(EV_REL)` + `REL_X`, `REL_Y`, `REL_WHEEL`.
4. Register `UI_SET_EVBIT(EV_ABS)` + `ABS_X`, `ABS_Y` for absolute mouse.
5. `UI_DEV_CREATE` to finalize the virtual device.

Absolute mouse move:
```c
struct input_event ev = {
    .type = EV_ABS, .code = ABS_X, .value = x
};
write(fd, &ev, sizeof(ev));
// repeat for ABS_Y, then EV_SYN
```

Relative mouse move: `EV_REL` + `REL_X` / `REL_Y`.

Keyboard: `EV_KEY` + scancode, value 1 (down) or 0 (up).

Required permissions: agent process must be in the `input` group or run with `CAP_DAC_OVERRIDE`.

### Windows

Uses `SendInput` API (Win32). Do NOT use deprecated `mouse_event` or `keybd_event`.

```rust
use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_MOUSE, INPUT_KEYBOARD, MOUSEINPUT, KEYBDINPUT};

fn mouse_move_abs(x: i32, y: i32) {
    let screen_x = (x as f64 / SCREEN_WIDTH as f64 * 65535.0) as i32;
    let screen_y = (y as f64 / SCREEN_HEIGHT as f64 * 65535.0) as i32;
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: screen_x, dy: screen_y,
                dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                ..Default::default()
            }
        }
    };
    unsafe { SendInput(&[input], size_of::<INPUT>() as i32) };
}
```

`MOUSEEVENTF_VIRTUALDESK` maps coordinates across all monitors in a multi-monitor setup.

### macOS

Uses CoreGraphics `CGEventPost`.

```rust
use core_graphics::event::{CGEvent, CGEventType, CGMouseButton, CGEventSource};
use core_graphics::event_source::CGEventSourceStateID;

fn mouse_move_abs(x: i32, y: i32) {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
    let point = CGPoint::new(x as f64, y as f64);
    let event = CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left).unwrap();
    event.post(CGEventTapLocation::HID);
}
```

---

## Command Execution

### `CtrlAltDel`

- **Windows:** `ExitWindowsEx` is insufficient; use `SendSAS` (Secure Attention Sequence) via `sas.dll`.
- **Linux:** Write key combo to uinput: `Ctrl + Alt + Del`.
- **macOS:** Not natively triggerable; send `Ctrl+Cmd+Q` as lock equivalent.

### `Sleep` / `Restart` / `Shutdown`

- **Windows:** `InitiateSystemShutdownExW` or `ExitWindowsEx(EWX_SHUTDOWN | EWX_FORCE, ...)`.
- **Linux:** `systemctl poweroff`, `systemctl reboot`, `systemctl suspend`.
- **macOS:** `osascript -e 'tell application "System Events" to shut down'`.

These are spawned as background child processes via `tokio::process::Command`.

### `LockScreen`

- **Windows:** `LockWorkStation()`.
- **Linux:** `loginctl lock-session` or `xdg-screensaver lock`.
- **macOS:** `pmset displaysleepnow` or `osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`.

### `ClipboardPaste`

1. Set system clipboard to `text` using platform clipboard API (`arboard` crate).
2. Synthesize `Ctrl+V` key event (or `Cmd+V` on macOS).

---

## Non-Functional Requirements

- Input processing latency from data channel `onmessage` to OS injection: < 2 ms.
- No queuing of mouse move events — if a newer `MOUSE_MOVE_ABS` arrives while processing a previous one, the older one is dropped.
- Keyboard events must be processed in order (FIFO queue, max depth 16).
- Agent must not crash if input injection fails (e.g., insufficient permissions) — log a warning and continue.
