# Spec 003-frontend-extended — Agentic Orchestration

| Field  | Value                 |
| ------ | --------------------- |
| ID     | `003`                 |
| Slug   | `frontend-extended`   |
| Status | `ready`               |

This file is the lock table for domain specs in
`docs/spec/003-frontend-extended/`. Each agent working this spec must update
the `status` field of the domain spec it is implementing before starting work
and again when complete.

Source criteria: `criteria.md` (Host/Guest first-run UI + agent downloads).
Product context: `001-init/product/vison.md`. Host/guest rule: one agent host;
guests are browsers only.

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

## Domain: Frontend

| Spec File                    | Owner Agent | Status        | Notes |
| ---------------------------- | ----------- | ------------- | ----- |
| `frontend/01-role-gate.md`   |             | `not-started` | Fullscreen Host/Guest cards on first desktop `/` |
| `frontend/02-host-setup.md`  |             | `not-started` | REST download buttons + install/pair copy |

**Frontend Dependencies:**

- `02` depends on `01` (`productRole === 'host'` page)

No backend, cicd, or desktop-agent domain: downloads reuse
`GET /downloads/{platform}` and `VITE_REST_URL`. Installer packaging is 001/002.

---

## Cross-Domain Dependencies

```
frontend/01 ──► frontend/02
```

001 `ConnectPage` QR flow is unchanged for Guest. 002 MSI download key
`windows-x86_64` is the Windows button target.

---

## Parallel Waves

| Wave | Run in parallel | Notes |
| ---- | --------------- | ----- |
| 1    | `frontend/01`   | Gate + persistence + Guest path |
| 2    | `frontend/02`   | After role store and `/` branching exist |

### Specs that must not run in parallel

| Pair | Reason |
| ---- | ------ |
| `frontend/01` + `frontend/02` | Both own desktop `/` composition (`DesktopRouter`, Connect vs Host) |

### Folder ownership (hard boundaries)

| Spec | Allowed write paths |
| ---- | ------------------- |
| `frontend/01` | `components/frontend/src/pages/desktop/`, `components/frontend/src/components/auth/`, `components/frontend/src/stores/roleStore.ts`, `components/frontend/src/types/`, `components/frontend/src/app/DesktopRouter.tsx` |
| `frontend/02` | `components/frontend/src/pages/desktop/` (Host setup page only), `components/frontend/src/components/host/`, `components/frontend/src/lib/downloads.ts` |

Agents must not edit paths outside their list unless merging in wave order.
Do not change mobile routes, infra Lambda, or the desktop agent in this spec.

---

## Known Blockers & Decisions Pending

| # | Description | Blocking Spec | Decision Needed By |
| - | ----------- | ------------- | ------------------ |
| 1 | W32-10 large MSI download via API Gateway | `frontend/02` UX | Browser `<a href>` + redirect is enough if 002 ships presign |
| 2 | `VITE_REST_URL` must be the deployed RestEndpoint | `frontend/02` | Self-hosters at frontend build/deploy time |

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

Read docs/spec/003-frontend-extended/agents.md first.
Only implement docs/spec/003-frontend-extended/<SPEC_PATH>.
Do not edit files outside the allowed paths for this spec in agents.md.
Do not work on any other spec.

Before coding:
1. Set Owner Agent to <OWNER_AGENT_ID> and Status to in-progress in agents.md.
2. Work only tasks under ## <SPEC_PATH> in docs/spec/003-frontend-extended/tasks.md.

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
