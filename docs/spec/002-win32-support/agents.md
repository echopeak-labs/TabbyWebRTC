# Spec 002-win32-support — Agentic Orchestration

| Field  | Value           |
| ------ | --------------- |
| ID     | `002`           |
| Slug   | `win32-support` |
| Status | `ready`         |

This file is the lock table for domain specs in `docs/spec/002-win32-support/`.
Each agent working this spec must update the `status` field of the domain spec
it is implementing before starting work and again when complete.

Source criteria: `criteria.md` (Windows 11 host capture + packaging). Product
context: `001-init/product/vison.md`. Locked decision: interactive user-session
agent only — no Windows service / Session 0.

---

## Status Key

| Status        | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| `not-started` | No implementation work has begun                          |
| `in-progress` | An agent is actively implementing this spec               |
| `blocked`     | Implementation is paused pending a dependency or decision |
| `review`      | Implementation complete; awaiting human or agent review   |
| `done`        | Fully implemented and verified                            |

---

## Findings Index (W32-*)

| ID     | Sev      | Kind     | Title                                              | Closing spec                      |
| ------ | -------- | -------- | -------------------------------------------------- | --------------------------------- |
| W32-01 | critical | security | MSI registers Session 0 Windows service            | `desktop-agent/01`, `cicd/01`     |
| W32-02 | high     | gap      | No physical-display filter                         | `desktop-agent/02`                |
| W32-03 | high     | gap      | Per-app capture / enumeration unspecified          | `desktop-agent/03`                |
| W32-04 | high     | security | Per-machine installer + silent update surface      | `desktop-agent/01`, `cicd/01`     |
| W32-05 | high     | gap      | Real Windows capture not default (synthetic path)  | `desktop-agent/02`                |
| W32-06 | medium   | gap      | Criteria omits vision input/auth/thumbnail inherit | `desktop-agent/01`                |
| W32-07 | medium   | security | UIPI / secure desktop; no SAS from user process    | `desktop-agent/03`, `04`          |
| W32-08 | medium   | gap      | CI cannot validate Windows 11 desktop capture      | `cicd/01`                         |
| W32-09 | low      | logic    | SendInput bugs (Win key, h-wheel, power paths)     | `desktop-agent/04`                |
| W32-10 | high     | gap      | Downloads buffer entire object as base64           | `backend/01`                      |

Carry-forward from 001 review (do not re-open design; respect existing fixes):
DA-02 local HTTP auth, DA-03 remote power gate, INF-07 public downloads.

---

## Domain: Desktop Agent

| Spec File                          | Owner Agent | Status        | Notes |
| ---------------------------------- | ----------- | ------------- | ----- |
| `desktop-agent/01-overview.md`     |             | `not-started` | Win11 x64 gate, user-session identity, autostart, trust |
| `desktop-agent/02-display-capture.md` |          | `not-started` | Physical displays + DXGI; no synthetic release fallback |
| `desktop-agent/03-app-capture.md`  |             | `not-started` | User-session apps + WGC; minimized/UIPI rules |
| `desktop-agent/04-input.md`        |             | `not-started` | SendInput fixes + power/SAS gates |

**Desktop Agent Dependencies:**

- `02` depends on `01`
- `03` depends on `01` (and shares capture crate with `02` — do not parallel)
- `04` depends on `01`

---

## Domain: CI/CD

| Spec File                       | Owner Agent | Status        | Notes |
| ------------------------------- | ----------- | ------------- | ----- |
| `cicd/01-windows-artifacts.md`  |             | `not-started` | Per-user MSI, drop service, publish MSI to R2 |

**CI/CD Dependencies:**

- Packaging rules depend on `desktop-agent/01` process identity
- Publish contract shared with `backend/01` (filename / platform key)

---

## Domain: Backend

| Spec File                          | Owner Agent | Status        | Notes |
| ---------------------------------- | ----------- | ------------- | ----- |
| `backend/01-windows-downloads.md`  |             | `not-started` | Serve MSI via GET /downloads/windows-x86_64; fix W32-10 |

**Backend Dependencies:**

- Needs `cicd/01` to publish MSI + manifest entry for E2E
- Reuses 001 `updatesFn` / R2 layout

---

## Cross-Domain Dependencies

```
desktop-agent/01 ──► desktop-agent/02
                 ──► desktop-agent/03
                 ──► desktop-agent/04
desktop-agent/01 ──► cicd/01
cicd/01 ──► backend/01   (E2E publish; contract must agree)
```

---

## Parallel Waves

| Wave | Run in parallel                                      | Notes |
| ---- | ---------------------------------------------------- | ----- |
| 1    | `desktop-agent/01`                                   | Identity + gate first |
| 2    | `desktop-agent/02` then `desktop-agent/03`           | Sequential — both edit `capture/` |
| 2b   | `desktop-agent/04` (after wave 1)                    | Can run beside 02 if no shared files with 02/03 |
| 3    | `cicd/01`                                            | After overview packaging rules |
| 4    | `backend/01`                                         | After cicd publish contract is stable |

### Specs that must not run in parallel

| Pair | Reason |
| ---- | ------ |
| `desktop-agent/02` + `desktop-agent/03` | Both edit `components/desktop-agent/capture/` |
| `cicd/01` + `backend/01` | Shared manifest / filename contract — serialize if either changes naming |

### Folder ownership (hard boundaries)

| Spec | Allowed write paths |
| ---- | ------------------- |
| `desktop-agent/01` | `components/desktop-agent/agent/` (gate, config, autostart), `components/desktop-agent/Cargo.toml` only if feature flags require it |
| `desktop-agent/02` | `components/desktop-agent/capture/` (display / DXGI paths) |
| `desktop-agent/03` | `components/desktop-agent/capture/` (app / WGC paths, minimize policy) |
| `desktop-agent/04` | `components/desktop-agent/input/` |
| `cicd/01` | `components/desktop-agent/packaging/`, `.github/workflows/desktop-agent.yml`, `scripts/generate-manifest.sh` (only if Windows mapping changes) |
| `backend/01` | `components/infra/lambda/src/handlers/updates.ts`, `components/infra/lambda/src/lib/r2.ts`, related tests under `components/infra/lambda/` |

Agents must not edit paths outside their list unless merging integration work
in wave order.

---

## Known Blockers & Decisions Pending

| # | Description | Blocking Spec | Decision Needed By |
| - | ----------- | ------------- | ------------------ |
| 1 | Authenticode signing for MSI (SmartScreen) | `cicd/01` | Before prod user-facing Windows release |
| 2 | Presigned redirect vs streaming for large MSI | `backend/01` | Before implementing W32-10 fix |
| 3 | Optional off-screen restore for minimized apps | `desktop-agent/03` | Default is fail stream — keep unless product asks |

---

## Agent Assignment Protocol

When an agent begins work on a spec:

1. Update the `Owner Agent` column with the agent's identifier.
2. Change `Status` to `in-progress`.
3. Commit the update to `agents.md` before writing any code.

When an agent completes a spec:

1. Change `Status` to `review`.
2. List any blockers in the `Notes` column.
3. Commit the update.

Human reviews change `review` → `done`.

---

## Cursor prompt template

```text
You are <OWNER_AGENT_ID>.

Read docs/spec/002-win32-support/agents.md first.
Only implement docs/spec/002-win32-support/<SPEC_PATH>.
Do not edit files outside the allowed paths for this spec in agents.md.
Do not work on any other spec.

Before coding:
1. Set Owner Agent to <OWNER_AGENT_ID> and Status to in-progress in agents.md.
2. Work only tasks under ## <SPEC_PATH> in docs/spec/002-win32-support/tasks.md.

Branch: agent/<domain>-<spec>

When done:
1. Mark completed tasks [x] in tasks.md.
2. Set Status to review in agents.md.
3. List any blockers in the Notes column.
```

### Status lifecycle

```
not-started → in-progress (one owner only) → review → done
                    ↓
                 blocked (document dependency in Notes)
```
