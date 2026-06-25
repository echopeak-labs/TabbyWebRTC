To make mouse and keyboard interactions feel entirely native, you must eliminate
two distinct friction points: transport lag and browser event hijacking. If a
user clicks or types, the input must arrive at the host machine instantly
without waiting for missing network packets. Furthermore, standard system
shortcuts like Alt+Tab or Ctrl+W must pass straight to the remote host instead
of triggering actions on the user's local browser window.

Achieving a near-zero-latency, native-feeling input system requires specific
client-side APIs, strict WebRTC configurations, and low-level host injection
mechanics.

---

### 1. The Transport Layer: Eliminating Input Stutter

By default, WebRTC Data Channels mimic TCP, which guarantees that packets arrive
in the exact order they were sent. If a single mouse movement packet is dropped
over a Wi-Fi connection, the browser stalls all subsequent mouse packets until
the missing one is retransmitted. This causes a highly noticeable rubber-banding
or stuttering effect.

To prevent this, you must configure your input data channel to operate in
**unreliable, unordered mode**, essentially acting as a raw UDP socket.

```javascript
// Client-side initialization of the input channel
const inputChannel = peerConnection.createDataChannel("input_stream", {
  ordered: false, // Do not wait for late packets
  maxRetransmits: 0, // Drop lost packets instantly
});
```

Because mouse coordinates are absolute and sent 60 to 125 times per second,
dropping an intermediate coordinate is completely imperceptible to the user. The
host agent simply processes the newest packet it receives and ignores the rest,
keeping the cursor completely fluid.

---

### 2. Perfect Keyboard Handling: Overriding the Browser

Handling keyboard events inside a standard web browser introduces two
significant obstacles: regional keyboard layouts and protected OS hotkeys.

#### Step A: Rely on Physical Scancodes, Not Characters

If a user with a French AZERTY keyboard presses the top-left letter key, the
browser might interpret it as the character "A". If your host machine is
configured for a US QWERTY layout, injecting an "A" will register the wrong key
on the remote side.

To fix this, your frontend must ignore `event.key` and instead capture
`event.code`. The `event.code` property represents the physical location of the
key on the keyboard, completely independent of the operating system's language
settings.

- Pressing the top-left letter key always emits `code: "KeyQ"` on QWERTY and
  `code: "KeyQ"` on AZERTY.
- Your host agent maps these uniform hardware codes directly to the host OS
  virtual key codes.

#### Step B: Use the Keyboard Lock API

If a user is typing inside your remote tab and hits `Ctrl+W` to close a tab
inside a remote browser, or `Ctrl+T` to open a new one, the local library
browser will intercept the command and close your actual RDP session window.

To prevent the local browser from stealing these critical shortcuts, you must
invoke the modern **Keyboard Lock API**. This allows a web application running
in fullscreen mode to capture systemic key combinations.

```javascript
async function enterNativeKeyboardMode() {
  try {
    // Request full screen to unlock advanced input permissions
    await document.documentElement.requestFullscreen();

    // Lock all keys, including system-level shortcuts like Escape, Alt+Tab, and Ctrl+W
    if (
      navigator.keyboard &&
      "\u006c\u006f\u0063\u006b" in navigator.keyboard
    ) {
      await navigator.keyboard.lock([
        "ControlLeft",
        "ControlRight",
        "AltLeft",
        "AltRight",
        "Tab",
        "KeyW",
        "KeyT",
      ]);
      console.log("Keyboard shortcuts locked successfully.");
    }
  } catch (err) {
    console.error("Failed to acquire keyboard lock:", err);
  }
}
```

On your main DOM element, make sure to attach an active event interceptor to
block standard actions for unlocked keys:

```javascript
window.addEventListener(
  "keydown",
  (event) => {
    // Prevent the browser from executing default commands
    event.preventDefault();

    // Package and transmit the scancode down the WebRTC data channel
    const payload = {
      type: "KEY_DOWN",
      code: event.code,
      modifiers: {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      },
    };
    inputChannel.send(JSON.stringify(payload));
  },
  { passive: false },
);
```

---

### 3. Mouse Inputs: Absolute vs. Relative Tracking

Depending on what the user is doing inside the browser tab, you need two
entirely different mouse mapping strategies.

#### Strategy A: Workspace Mode (Absolute Coordinates)

For typical desktop interactions, application navigation, and text selection,
you use the coordinate normalization math discussed previously. The client maps
the click position relative to the rendered video boundaries, translates it to a
floating-point number between `0.0` and `1.0`, and transmits it. The host
multiplies it by the monitor's target pixel dimensions.

#### Strategy B: Immersive/Gaming Mode (Relative Movements)

If the user boots a first-person 3D application or a game inside a tab, absolute
mapping fails completely. The cursor will instantly slam into the edge of the
library browser window and stop moving, locking the camera view.

To achieve a true native tracking feel for 3D environments, you must activate
the **Pointer Lock API**. This hides the local cursor entirely and provides raw,
infinite mouse delta movements ($dX, dY$).

```javascript
videoElement.addEventListener("click", () => {
  // Locks the cursor inside the element and tracks raw delta movements
  videoElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === videoElement) {
    console.log("Relative pointer tracking active.");
    document.addEventListener("mousemove", sendRelativeMouse, false);
  } else {
    document.removeEventListener("mousemove", sendRelativeMouse, false);
  }
});

function sendRelativeMouse(event) {
  const payload = {
    type: "MOUSE_MOVE_RELATIVE",
    dx: event.movementX,
    dy: event.movementY,
  };
  inputChannel.send(JSON.stringify(payload));
}
```

When the host agent receives a relative mouse payload, it bypasses coordinate
positioning and instead tells the OS mouse sub-engine to move the cursor
relative to its current spot by $dX$ and $Y$ pixels.

---

### 4. Low-Level Host Input Injection

Once your serverless WebRTC routing pipeline delivers these raw input JSON
packets to the local Desktop Agent, the agent must inject them into the host OS.
This operation must happen at a kernel or low-level driver interface layer to
bypass OS security boundaries.

- **Windows Implementation (Rust / C++):** Use the native Win32 `SendInput` API.
  Do not use older APIs like `mouse_event` or `keybd_event` as they are
  deprecated and introduce minor coordinate round-off errors. `SendInput`
  serializes keyboard, mouse click, and relative coordinate structures directly
  into the system's primary input thread queue.
- **macOS Implementation (Swift / C):** Utilize CoreGraphics input events via
  `CGEventSourceCreate` and `CGEventPost`. This system safely inserts events at
  the WindowServer architecture layer.
- **Linux Implementation (Go / Rust):** If running on a modern Wayland
  compositor, traditional X11 automation tools fail due to security isolation.
  You must open and write to the native Linux kernel subsystem via
  `/dev/uinput`. This requires your agent to have proper device read/write
  privileges, but it makes the OS treat your agent as a literal hardware USB
  keyboard or mouse plugged into the machine.

### 5. Seamless Cursor Synchronization

To completely hide network latency, you can hide the true host operating system
cursor from your video encoding pipeline entirely (most capture APIs like DXGI
allow you to toggle `SetShowCursor(false)`).

Instead, let the local web browser render its own hardware-accelerated cursor on
the client side. By doing this, mouse tracking feels instant to the user because
the visual cursor moves immediately with their hand, completely independent of
the 20 to 50 milliseconds of round-trip network time it takes for the video
frame to return from the host desktop.
