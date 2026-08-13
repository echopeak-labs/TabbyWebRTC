# Spec 004-bootstrap — Agentic Orchestration

| Field  | Value        |
| ------ | ------------ |
| ID     | `004`        |
| Slug   | `bootstrap`  |
| Status | `ready`      |

This file is the lock table for domain specs in `docs/spec/004-bootstrap/`.
Each agent working this spec must update the `status` field of the domain spec
it is implementing before starting work and again when complete.

Source criteria: `criteria.md` (TUI bootstrap for self-host: env, domain,
Clerk, Cloudflare, S3-primary storage, deploy). Product context:
`001-init/product/vison.md`. Host/guest first-run UI remains 003.

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

## Domain: Backend

| Spec File                      | Owner Agent | Status        | Notes |
| ------------------------------ | ----------- | ------------- | ----- |
| `backend/01-forkable-stack.md` |             | `not-started` | Optional ACM, CloudFront default domain, CORS, `.env.example` |
| `backend/02-s3-storage.md`     |             | `not-started` | S3 primary artifact bucket; R2 optional |

**Backend Dependencies:**

- `02` depends on `01` (env schema, stack CORS/domain must land first)

---

## Domain: CI/CD

| Spec File                       | Owner Agent | Status        | Notes |
| ------------------------------- | ----------- | ------------- | ----- |
| `cicd/01-self-host-pipeline.md` |             | `not-started` | Parameterize Actions + deploy/publish scripts; README self-host entry |

**CI/CD Dependencies:**

- Needs `backend/01` env names (`WEB_DOMAIN`, `ROOT_DOMAIN`, ACM optional)
- Needs `backend/02` `ARTIFACT_STORE` / `ARTIFACT_BUCKET` contract for publish

---

## Domain: Bootstrap

| Spec File              | Owner Agent | Status        | Notes |
| ---------------------- | ----------- | ------------- | ----- |
| `bootstrap/01-tui.md`  |             | `not-started` | Ink TUI: env, domain, Clerk, Cloudflare, storage, deploy |

**Bootstrap Dependencies:**

- Needs `backend/01` + `backend/02` so written `.env` matches a deployable stack
- Needs `cicd/01` parameterized deploy/DNS/frontend-sync scripts (or TUI may
  call `cdk deploy` directly if cicd extracted `deploy-frontend.sh`)

---

## Cross-Domain Dependencies

```
backend/01 ──► backend/02 ──► cicd/01 ──► bootstrap/01
```

003 Host/Guest is independent. 001 REST download routes stay; 002 W32-10
presign must work on S3 and R2.

---

## Parallel Waves

| Wave | Run in parallel     | Notes |
| ---- | ------------------- | ----- |
| 1    | `backend/01`        | Forkable domain / CORS / env example |
| 2    | `backend/02`        | After `01`; both may touch `tabbywebrtc-stack.ts` |
| 3    | `cicd/01`           | After storage + domain env are stable |
| 4    | `bootstrap/01`      | After scripts and env schema exist |

### Specs that must not run in parallel

| Pair | Reason |
| ---- | ------ |
| `backend/01` + `backend/02` | Shared `tabbywebrtc-stack.ts`, `.env.example`, `lambda-functions.ts` |
| `cicd/01` + `bootstrap/01` | Shared README self-host story and root `package.json` scripts |

### Folder ownership (hard boundaries)

| Spec | Allowed write paths |
| ---- | ------------------- |
| `backend/01` | `components/infra/lib/domain-params.ts`, `components/infra/lib/constructs/frontend-hosting.ts`, `components/infra/lib/tabbywebrtc-stack.ts`, `components/infra/.env.example`, `components/infra/test/` (domain / hosting / CORS synth tests only) |
| `backend/02` | `components/infra/lambda/src/lib/` (object store; may replace `r2.ts`), `components/infra/lambda/src/handlers/updates.ts`, `components/infra/lib/constructs/lambda-functions.ts`, `components/infra/lib/constructs/` (new artifacts-bucket construct), `components/infra/lib/tabbywebrtc-stack.ts` (wire bucket + outputs only), `components/infra/.env.example` (storage keys only), `components/infra/test/` (updates + store tests) |
| `cicd/01` | `.github/workflows/deploy.yml`, `.github/workflows/desktop-agent.yml`, `.github/workflows/pr-check.yml` (bootstrap typecheck only if needed), `scripts/deploy-dev.sh`, `scripts/deploy-prod.sh`, `scripts/update-cloudflare-dns.sh`, `scripts/publish-agent-release.sh`, `scripts/setup-dev.sh`, `scripts/deploy-frontend.sh` (new, optional extract), `README.md` |
| `bootstrap/01` | `components/bootstrap/`, root `package.json` (`bootstrap` script and workspace resolution only) |

Agents must not edit paths outside their list unless merging in wave order.
Do not change desktop-agent capture, frontend pages (003), or Clerk JWT
verify logic except env names already used.

`cicd/01` writes the README self-host section. `bootstrap/01` must not edit
`README.md`; point the TUI done screen at `yarn bootstrap` as already
documented.

---

## Known Blockers & Decisions Pending

| # | Description | Blocking Spec | Decision Needed By |
| - | ----------- | ------------- | ------------------ |
| 1 | API Gateway CORS may need RestApi constructed after CloudFront domain exists (Mode A) | `backend/01` | Implementer picks a CDK-legal order |
| 2 | ACM issuance is not automated; custom domain needs a pre-existing us-east-1 cert | `bootstrap/01` | Product: TUI prompts ARN only |
| 3 | W32-10 presign must work for S3 and R2 | `backend/02` | Reuse 002 chosen download mechanism |

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

Read docs/spec/004-bootstrap/agents.md first.
Only implement docs/spec/004-bootstrap/<SPEC_PATH>.
Do not edit files outside the allowed paths for this spec in agents.md.
Do not work on any other spec.

Before coding:
1. Set Owner Agent to <OWNER_AGENT_ID> and Status to in-progress in agents.md.
2. Work only tasks under ## <SPEC_PATH> in docs/spec/004-bootstrap/tasks.md.

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
