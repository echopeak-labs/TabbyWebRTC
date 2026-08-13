# Frontend — Host / Guest Role Gate SDD

## Scope

Fullscreen first-run dialog so a desktop user can choose **Host** (this machine
will run the desktop agent) or **Guest** (this browser is a viewer). Closes the
product gap that a cloned/deployed webapp has no in-app path to pick which
device gets the agent.

Related 001 specs: `frontend/01-ui-overview.md` (device roles, routes, theme),
`frontend/02-auth-session.md` (`ConnectPage` QR flow).

Host/guest architecture (workspace rule): one host runs the agent; guests are
browsers only. This dialog is how a human picks which physical machine is the
host. It does **not** change `DeviceRole` (`desktop-viewer` vs `mobile-key`).

---

## When It Appears

Show the gate only when **all** of the following are true:

1. `useDeviceType()` is `desktop-viewer`.
2. No ephemeral session token (`sessionStorage` / `authStore.token` is null).
3. No stored product role (`localStorage` key `tabbywebrtc.productRole` is
   unset).

Skip the gate when:

| Condition | Behavior |
|---|---|
| `mobile-key` | Existing mobile Clerk / scan / approve routes. Never show Host/Guest. |
| Authenticated desktop tab | Existing `DesktopAuthBootstrap` → `/launchpad`. |
| `productRole === 'guest'` | Render current `ConnectPage` (QR + LAN). |
| `productRole === 'host'` | Render Host setup (`02-host-setup.md`). |

First paint of `/` for a new desktop visitor is the dialog — not the QR page.

---

## UI

Fullscreen overlay on `/` (Onyx background `#0A0A0A`). Two equal shadcn `Card`
components in a row (stack below 768 px). Amber accent, wordmark TabbyWebRTC.

```
+--------------------------------------------------+
|                  TabbyWebRTC                     |
|     Which device is this?                        |
|                                                  |
|  +----------------+    +----------------+        |
|  | Host           |    | Guest          |        |
|  | Install the    |    | View a host    |        |
|  | desktop agent  |    | in this tab    |        |
|  | [Choose Host]  |    | [Continue]     |        |
|  +----------------+    +----------------+        |
+--------------------------------------------------+
```

- **Host card:** this machine (or the machine the user intends to set up) will
  have the agent installed. Primary CTA: “Download agent”.
- **Guest card:** this browser is a viewer. Primary CTA: “Continue as guest”.
  Copy must state that nothing is installed on the guest.

Cards are keyboard-focusable. Default focus: Guest (safer; does not imply
download). Enter/Space activates the focused card.

---

## State

```ts
export type ProductRole = 'host' | 'guest'

const PRODUCT_ROLE_KEY = 'tabbywebrtc.productRole'
```

- Persist in `localStorage` so the choice survives tab close (first-run, not
  every visit).
- Do **not** put Host/Guest in `sessionStorage` only — the user would see the
  gate again after closing the tab.
- Provide a way back: Host setup and ConnectPage each have a text link
  “Change role” that clears `productRole` and re-shows the gate.

Zustand: add `productRole` + `setProductRole` / `clearProductRole` to a small
store (`roleStore.ts`) or extend `authStore` without mixing session JWT
semantics. Prefer a dedicated `roleStore.ts`.

---

## Routing

Keep `/` as the desktop entry. Do not add `/host` unless it simplifies
code-splitting. Recommended:

| `productRole` | `/` renders |
|---|---|
| unset | `RoleGate` overlay; underlying page empty/splash |
| `guest` | `ConnectPage` (unchanged QR / LAN UI) |
| `host` | `HostSetupPage` (`02-host-setup.md`) |

`DesktopAuthBootstrap` still runs first: if a session exists, navigate to
`/launchpad` and never show the gate.

---

## Copy Constraints

- Host ≠ “install on this Mac that is only viewing” unless the user chose Host.
- Guest copy: browser-only; agent stays on the host machine.
- Do not mention AWS S3 or R2 to end users. Downloads go through the REST
  downloads API (see `02`).

---

## Acceptance Criteria

1. New desktop visitor sees two cards before any QR.
2. Guest continues to the existing Connect / QR page.
3. Host continues to install/download UI.
4. Choice persists across reload; “Change role” resets it.
5. Mobile and already-authenticated desktop never see the gate.
6. Theme matches Onyx/Amber; two-card layout is full viewport.

---

## Out of Scope

- Changing Clerk / QR auth.
- Installing or running the agent from the browser.
- Mobile host-installer UI.
- New backend routes (use existing `GET /downloads/{platform}`).
