# TabbyRDP — Agentic Orchestration File

This file is the single source of truth for tracking the implementation status of every spec in `docs/spec-1/`. Each agent working on this project must update the `status` field of the spec it is implementing before starting work and again when complete.

---

## Status Key

| Status | Meaning |
|---|---|
| `not-started` | No implementation work has begun |
| `in-progress` | An agent is actively implementing this spec |
| `blocked` | Implementation is paused pending a dependency or decision |
| `review` | Implementation complete; awaiting human or agent review |
| `done` | Fully implemented and verified |

---

## Domain: Frontend

| Spec File | Owner Agent | Status | Notes |
|---|---|---|---|
| `frontend/01-ui-overview.md` | — | `not-started` | Scaffold React app, Vite, Tailwind, shadcn, routing, Zustand stores |
| `frontend/02-auth-session.md` | — | `not-started` | BroadcastChannel auth, ConnectPage, QR render, Clerk integration |
| `frontend/03-webrtc-client.md` | — | `not-started` | PeerConnection factory, signaling handshake, useWebRTC hook |
| `frontend/04-input-handling.md` | — | `not-started` | Keyboard/mouse capture, data channel, Keyboard Lock API |
| `frontend/05-launchpad.md` | — | `not-started` | LaunchpadPage, DisplayCard, AppCard, StreamPage, ControlBar |

**Frontend Dependencies:**
- `02` depends on `01` (app scaffold must exist)
- `03` depends on `01` (stores and types must exist)
- `04` depends on `03` (data channel from useWebRTC)
- `05` depends on `02`, `03`, `04`

---

## Domain: Backend

| Spec File | Owner Agent | Status | Notes |
|---|---|---|---|
| `backend/01-architecture.md` | — | `not-started` | DynamoDB tables, IAM roles, CDK constructs skeleton |
| `backend/02-signaling-server.md` | — | `not-started` | Lambda router, connection lifecycle, SDP/ICE relay, subscription locks |
| `backend/03-aws-infra.md` | — | `not-started` | Full CDK stack, REST API, env vars, stack outputs |
| `backend/04-auth-service.md` | — | `not-started` | Clerk JWT validation, QR session flow, TabbyRDP JWT issuance, pairing |

**Backend Dependencies:**
- `02` depends on `01` (tables must be defined)
- `03` depends on `01` + `02` (all constructs assembled into stack)
- `04` depends on `01` + `03` (needs tables and API endpoints)

---

## Domain: CI/CD & Scripting

| Spec File | Owner Agent | Status | Notes |
|---|---|---|---|
| `cicd/01-pipeline.md` | — | `not-started` | GH Actions: pr-check, frontend deploy, backend deploy, desktop-agent build |
| `cicd/02-scripts.md` | — | `not-started` | Shell scripts: setup-dev, deploy, bootstrap-aws, provision-turn, release |

**CI/CD Dependencies:**
- `01-pipeline.md` depends on frontend, backend, and desktop-agent builds existing
- `02-scripts.md` depends on `01-pipeline.md` (references workflow secrets)

---

## Domain: Desktop Agent

| Spec File | Owner Agent | Status | Notes |
|---|---|---|---|
| `desktop-agent/01-overview.md` | — | `not-started` | Cargo workspace, config loading, startup sequence, pairing flow |
| `desktop-agent/02-display-capture.md` | — | `not-started` | Capturable trait, platform impls, H.264 encoder, CaptureLoop task |
| `desktop-agent/03-input-injection.md` | — | `not-started` | InputInjector trait, uinput/SendInput/CGEvent impls, command execution |
| `desktop-agent/04-webrtc-server.md` | — | `not-started` | PeerConnection lifecycle, StreamRegistry, SignalingClient, SDP negotiation |

**Desktop Agent Dependencies:**
- `02` depends on `01` (workspace and Capturable trait scaffold)
- `03` depends on `01` (InputInjector trait scaffold)
- `04` depends on `01`, `02`, `03` (integrates all sub-systems)

---

## Cross-Domain Dependencies

```
desktop-agent/01 ──► desktop-agent/02
                 ──► desktop-agent/03
                 ──► desktop-agent/04

backend/01 ──► backend/02
           ──► backend/03
           ──► backend/04

frontend/01 ──► frontend/02
            ──► frontend/03
            ──► frontend/04
            ──► frontend/05

cicd/01 ──► (requires all three domains to have buildable code)
```

**Recommended implementation order:**
1. `backend/01` + `desktop-agent/01` (parallel — no cross-domain deps)
2. `backend/02` + `desktop-agent/02` + `desktop-agent/03` (parallel)
3. `backend/03` + `backend/04` + `desktop-agent/04` + `frontend/01` (parallel)
4. `frontend/02` + `frontend/03`
5. `frontend/04` + `frontend/05`
6. `cicd/01` + `cicd/02`

---

## Agent Assignment Protocol

When an agent begins work on a spec:

1. Update the `Owner Agent` column with the agent's identifier (e.g., `agent-01`).
2. Change `Status` to `in-progress`.
3. Commit the update to `agents.md` before writing any code.

When an agent completes a spec:

1. Change `Status` to `review`.
2. List any blockers or unresolved edge cases in the `Notes` column.
3. Commit the update.

Human reviews change `review` → `done`.

---

## Known Blockers & Decisions Pending

| # | Description | Blocking Spec | Decision Needed By |
|---|---|---|---|
| 1 | Confirm TURN server provider (Hetzner vs OVH vs self-hosted) | `cicd/02`, `backend/01` | Before first prod deploy |
| 2 | Confirm Clerk plan (free tier sufficient for user count) | `backend/04`, `frontend/02` | Before auth implementation |
| 3 | Linux capture: confirm PipeWire portal works headless (no DE) | `desktop-agent/02` | Before Linux capture impl |
| 4 | Windows agent signing cert for `SendInput` with UAC-elevated apps | `desktop-agent/03` | Before Windows input impl |
| 5 | `scap` crate maturity evaluation — may need to use raw OS APIs directly | `desktop-agent/02` | Before capture impl |
