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
| `backend/01-architecture.md` | `agent-backend-01` | `review` | CDK scaffold in `infra/`; 4 DynamoDB tables + Lambda IAM role; `cdk synth` verified for dev/prod |
| `backend/02-signaling-server.md` | `agent-singal-server` | `review` | WebSocket connect/disconnect/router in `infra/lambda/src/`; agent register/heartbeat, SUBSCRIBE/UNSUBSCRIBE locks, SDP/ICE relay; `sendToConnection` with GoneException cleanup; 22 Jest tests pass; SUBSCRIBE now validates TabbyRDP JWT via backend/04 |
| `backend/03-aws-infra.md` | `agent-aws-infra` | `review` | WebSocket + REST APIs wired in CDK; 4 Lambda stubs for bundling; `cdk synth` OK for dev/prod; `cdk diff`/`deploy` blocked until AWS credentials configured |
| `backend/04-auth-service.md` | `agent-auth-service` | `review` | Clerk JWKS + TabbyRDP/agent JWT via `jose`; QR `SESSION_PENDING`/`REFRESH_SESSION`; `POST /auth/approve`, `POST /agents/pair`, `GET /agents`, `GET /turn-credentials`; agents table TTL added; 22 Jest tests pass; E2E dev deploy blocked until AWS credentials configured; agent WebSocket auth uses `?token=` query param (API GW v2 has no connect headers) |

**Backend Dependencies:**
- `02` depends on `01` (tables must be defined)
- `03` depends on `01` + `02` (all constructs assembled into stack)
- `04` depends on `01` + `03` (needs tables and API endpoints)

---

## Domain: CI/CD & Scripting

| Spec File | Owner Agent | Status | Notes |
|---|---|---|---|
| `cicd/01-pipeline.md` | `agent-cicd-pipeline` | `review` | Four workflows in `.github/workflows/`; `cdk synth` + `cargo check`/`test` verified locally; PR check blocked until `frontend/` exists, `infra` adds lint/typecheck scripts, desktop-agent clippy warnings fixed; GitHub secrets + workflow E2E tests require human setup |
| `cicd/02-scripts.md` | `agent-cicd-scripting` | `review` | 10 scripts in `scripts/` + README + env.local.json.example; deploy-dev/prod added per spec inventory; full setup-dev blocked until frontend/01 scaffolds `frontend/` and `.env.example` |

**CI/CD Dependencies:**
- `01-pipeline.md` depends on frontend, backend, and desktop-agent builds existing
- `02-scripts.md` depends on `01-pipeline.md` (references workflow secrets)

---

## Domain: Desktop Agent

| Spec File | Owner Agent | Status | Notes |
|---|---|---|---|
| `desktop-agent/01-overview.md` | `agent-desktop-01` | `review` | Workspace scaffolds capture/input/webrtc_peer/signaling stubs; pairing uses local POST /pair until REST API exists; capture enumeration is placeholder until 02 |
| `desktop-agent/02-display-capture.md` | `agent-desktop-02` | `review` | Capturable trait, scap-backed platform capture (PipeWire/WGC/SCK), openh264 encoder + FU-A RTP packetizer, CaptureLoop; enable `scap-capture` feature + PipeWire for real display capture; hardware encode behind `hardware-encode`; Linux minimize hook stubbed |
| `desktop-agent/03-input-injection.md` | `agent-desktop-04` | `review` | InputInjector + uinput/SendInput/CGEvent impls, run_input_handler with keyboard FIFO (16) and latest-wins mouse moves; Linux tests pass when /dev/uinput accessible (input group); Windows SendSAS requires sas.dll + elevation; macOS CtrlAltDel maps to Ctrl+Cmd+Q |
| `desktop-agent/04-webrtc-server.md` | `agent-desktop-05` | `review` | Verified 2026-06-25: webrtc-rs v0.17.1; StreamRegistry + PeerCoordinator + SignalingClient match spec; `cargo build -p webrtc_peer` OK; STUN wired, TURN struct ready but agent passes `None` (blocked on backend/04 `GET /turn-credentials`); browser E2E integration test still pending |

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

---

## Multi-Agent Playbook (Cursor)

`agents.md` is the lock table. `tasks.md` is the checklist inside each spec. Cursor does not coordinate agents automatically — you do, by claiming ownership, partitioning folders, and merging by wave.

### Core rule

**One spec → one agent → one branch → one folder scope**

If two agents touch the same spec, the same shared file, or the same branch, they will conflict.

### Parallel waves

Only start specs in the same wave when all dependencies from prior waves are `done` or `review`.

| Wave | Run in parallel | Each agent owns |
|---|---|---|
| 1 | `backend/01` + `desktop-agent/01` | `infra/lib/constructs/` vs `desktop-agent/agent/` |
| 2 | `backend/02` + `desktop-agent/02` + `desktop-agent/03` | `infra/lambda/` vs `desktop-agent/capture/` vs `desktop-agent/input/` |
| 3 | `backend/03` + `backend/04` + `desktop-agent/04` + `frontend/01` | `infra/` vs `desktop-agent/webrtc_peer/` vs `frontend/` scaffold |
| 4 | `frontend/02` then `frontend/03` | Sequential — both edit `signal-client.ts` |
| 5 | `frontend/04` then `frontend/05` | `04` depends on `useWebRTC` from `03` |
| 6 | `cicd/01` + `cicd/02` | `.github/workflows/` vs `scripts/` |

Within a wave, do not start a spec whose dependencies are still `not-started` or `in-progress`.

### Specs that must not run in parallel

| Pair | Reason |
|---|---|
| `frontend/02` + `frontend/03` | Both edit `frontend/src/lib/signal-client.ts` |
| `frontend/03` + `frontend/04` | `04` needs data channel from `03` |
| `backend/02` + `backend/03` | `03` assembles CDK constructs from `02` |
| `desktop-agent/04` + any other agent spec | `04` integrates capture, input, and signaling |

### Folder ownership (hard boundaries)

| Spec | Allowed write paths |
|---|---|
| `frontend/01` | `frontend/src/app/`, `frontend/src/stores/`, `frontend/src/types/`, `frontend/package.json`, `frontend/vite.config.ts` |
| `frontend/02` | `frontend/src/pages/desktop/`, `frontend/src/pages/mobile/`, `frontend/src/lib/auth-sync.ts`, `frontend/src/lib/signal-client.ts`, `frontend/src/lib/clerk-client.ts` |
| `frontend/03` | `frontend/src/lib/webrtc.ts`, `frontend/src/hooks/useWebRTC.ts`, `frontend/src/components/stream/` |
| `frontend/04` | `frontend/src/hooks/useInputChannel.ts`, `frontend/src/lib/input-codec.ts`, `frontend/src/components/stream/ControlBar.tsx` |
| `frontend/05` | `frontend/src/pages/desktop/LaunchpadPage.tsx`, `frontend/src/pages/desktop/StreamPage.tsx`, `frontend/src/components/launchpad/`, `frontend/src/components/layout/` |
| `backend/01` | `infra/lib/constructs/dynamodb-tables.ts`, `infra/lib/constructs/iam-roles.ts` |
| `backend/02` | `infra/lambda/src/` (except handlers wired only in `03`) |
| `backend/03` | `infra/lib/tabbyrdp-stack.ts`, `infra/lib/constructs/websocket-api.ts`, `infra/lib/constructs/lambda-functions.ts` |
| `backend/04` | `infra/lambda/src/handlers/auth.ts`, `infra/lambda/src/handlers/turn.ts`, `infra/lambda/src/handlers/agent.ts` |
| `desktop-agent/01` | `desktop-agent/agent/`, `desktop-agent/Cargo.toml` |
| `desktop-agent/02` | `desktop-agent/capture/` |
| `desktop-agent/03` | `desktop-agent/input/` |
| `desktop-agent/04` | `desktop-agent/webrtc_peer/`, `desktop-agent/signaling/` |
| `cicd/01` | `.github/workflows/` |
| `cicd/02` | `scripts/` |

Agents must not edit paths outside their spec's allowed list unless explicitly merging integration work in wave order.

### Daily workflow

1. Open `agents.md` and find specs in the current wave with `not-started`.
2. Assign a unique `Owner Agent` ID and set `Status` to `in-progress` before any code is written.
3. Create one git branch per agent: `agent/<domain>-<spec>` (e.g. `agent/backend-01-architecture`).
4. Open one Cursor chat per spec. Paste the prompt template below.
5. Agent works only tasks under its `## <spec>` section in `tasks.md`.
6. On completion: check off tasks in `tasks.md`, set `Status` to `review`, note blockers in `Notes`.
7. Merge branches in wave order (1 → 2 → 3 → …). Human marks `review` → `done`.

### Cursor prompt template

Copy into every agent chat:

```text
You are <OWNER_AGENT_ID>.

Read docs/spec-1/agents.md first.
Only implement docs/spec-1/<SPEC_PATH>.
Do not edit files outside the allowed paths for this spec in agents.md.
Do not work on any other spec.

Before coding:
1. Set Owner Agent to <OWNER_AGENT_ID> and Status to in-progress in agents.md.
2. Work only tasks under ## <SPEC_PATH> in docs/spec-1/tasks.md.

Branch: agent/<branch-name>

When done:
1. Mark completed tasks [x] in tasks.md.
2. Set Status to review in agents.md.
3. List any blockers in the Notes column.
```

Example:

```text
You are agent-backend-01.

Read docs/spec-1/agents.md first.
Only implement docs/spec-1/backend/01-architecture.md.
Do not edit frontend/, desktop-agent/, or other backend specs.
Do not work on any other spec.

Before coding:
1. Set Owner Agent to agent-backend-01 and Status to in-progress in agents.md.
2. Work only tasks under ## backend/01-architecture.md in docs/spec-1/tasks.md.

Branch: agent/backend-01-architecture

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

- `in-progress` = locked. No second agent may claim the same spec.
- `review` = implementation complete. Do not rewrite unless fixing review feedback.
- `blocked` = check Notes and dependency graph before reassigning.

### First safe parallel run

Start with wave 1 only:

- **agent-backend-01** → `backend/01` on branch `agent/backend-01-architecture`
- **agent-desktop-01** → `desktop-agent/01` on branch `agent/desktop-01-overview`

Zero shared files. Merge both before starting wave 2.

### What this file does not do

- Does not prevent edits if the prompt omits boundaries.
- Does not auto-merge git branches.
- Does not detect file conflicts.

You must enforce: claim in `agents.md` + branch per agent + folder boundaries in prompt + merge by wave.
