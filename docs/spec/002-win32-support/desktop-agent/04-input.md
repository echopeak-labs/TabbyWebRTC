# Desktop Agent — Windows Input SDD

## Scope

Windows-specific input injection fixes and security gates on top of
`001-init/desktop-agent/03-input-injection.md`. Closes W32-09 and input halves
of W32-07 / DA-03 carry-forward.

---

## Inherit From 001

Keep the `InputInjector` trait, data-channel JSON payloads, keyboard FIFO
(depth 16), latest-wins mouse moves, and command enum
(`CtrlAltDel`, `Sleep`, `Restart`, `Shutdown`, `LockScreen`).

Windows implementation continues to use `SendInput` (not deprecated
`mouse_event` / `keybd_event`). Absolute mouse uses
`MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` against the virtual desktop
metrics.

---

## Bugs To Fix (W32-09)

| Bug | Current behavior | Required |
|---|---|---|
| Meta / Win key modifiers | `apply_modifiers` sends `VK_RCONTROL` when `modifiers.meta` | Use `VK_LWIN` / `VK_RWIN` (`0x5B` / `0x5C`). Key codes `MetaLeft`/`MetaRight` already map correctly in `keys.rs` |
| Horizontal scroll | `delta_x` uses `MOUSEEVENTF_WHEEL` | Use `MOUSEEVENTF_HWHEEL` for horizontal delta |
| Shutdown / Restart | `ExitWindowsEx(... \| EWX_FORCE)` | Prefer graceful shutdown without `EWX_FORCE` unless a documented force flag is set; still require `allow_remote_power` |
| Sleep | `rundll32 powrprof SetSuspendState 0,1,0` (hibernate-ish) | Use a documented sleep/suspend path (e.g. `SetSuspendState` with correct args or `PowerCreateRequest` flow) that matches “Sleep” |

---

## Secure Desktop and UIPI (W32-07)

- Unelevated `SendInput` does not reliably reach elevated windows. Failures must
  be logged; agent must not crash.
- `CtrlAltDel` / `SendSAS` via `sas.dll` typically requires special rights. If
  `SendSAS` fails, return an error to the control plane / log; do **not** claim
  success. No elevated helper is in scope for 002.
- Lock screen (`LockWorkStation`) remains allowed when `input.enabled` is true.
- `Shutdown` / `Restart` / `Sleep` remain denied unless
  `input.allow_remote_power = true`.

---

## Clipboard

Keep `arboard` + Ctrl+V paste. Do not escalate privileges for clipboard access.
Clipboard text is untrusted remote content — do not execute it.

---

## Acceptance Criteria

1. Holding Meta in the browser injects Win key, not Ctrl.
2. Horizontal wheel events move horizontal scroll, not vertical.
3. With `allow_remote_power = false`, Shutdown/Restart/Sleep are no-ops with a
   warning log.
4. Failed `SendSAS` does not report success.
5. Existing 001 latency / queueing non-functionals still hold.

---

## Out of Scope

- Signed/elevated SAS helper.
- Injecting into secure desktop.
- Changing host keyboard layouts.
