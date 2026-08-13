# CI/CD — Self-host Pipeline SDD

## Scope

Parameterize deploy scripts and GitHub Actions so a **fork** can deploy
without `mikewheeler.dev`, and so agent publish respects `ARTIFACT_STORE`
(`s3` default, `r2` optional).

Depends on `backend/01` (domain env) and `backend/02` (storage). Does not
implement the TUI. Does not change CDK constructs except via the env those
scripts already pass through.

---

## Problem

| Hardcoding | Location |
|---|---|
| `ROOT_DOMAIN: mikewheeler.dev` | `.github/workflows/deploy.yml` |
| DNS names `tabbywebrtc` / `dev-tabbywebrtc` | `deploy.yml` resolve-env |
| Echo text `*.mikewheeler.dev` | `scripts/deploy-dev.sh`, `deploy-prod.sh` |
| Default `ROOT_DOMAIN=mikewheeler.dev` | `scripts/update-cloudflare-dns.sh` |
| Publish only to R2 | `.github/workflows/desktop-agent.yml`, `scripts/publish-agent-release.sh` |
| Missing `infra/.env.example` | `setup-dev.sh` already copies it (`01` adds the file) |

---

## Deploy scripts

`scripts/deploy-dev.sh` and `scripts/deploy-prod.sh`:

- Keep sourcing `components/infra/.env`.
- Export `WEB_DOMAIN`, `ACM_CERTIFICATE_ARN`, `ARTIFACT_STORE`, Clerk, TURN,
  R2 (only if r2) into the CDK process.
- After deploy, Cloudflare upsert **only** when `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ZONE_ID`, `ROOT_DOMAIN`, and `WEB_DNS_NAME` are all set.
- Pass `ROOT_DOMAIN` and `TABBYWEBRTC_DNS_NAME=$WEB_DNS_NAME` into
  `update-cloudflare-dns.sh`. No fallback domain.
- If Cloudflare vars are missing, print how to set them; **do not** mention
  `mikewheeler.dev`.
- Frontend sync: if these scripts do not already upload the SPA, leave that
  to the TUI and `deploy.yml`. Optional: a `scripts/deploy-frontend.sh` that
  reads `cdk-outputs.json` and syncs/invalidates — TUI and CI both call it.
  Prefer extracting that shared script here so the TUI does not duplicate
  AWS CLI.

`scripts/update-cloudflare-dns.sh`:

- Require `ROOT_DOMAIN` (no default).
- Keep CNAME upsert to `TABBYWEBRTC_CF_DOMAIN`.

`scripts/bootstrap-aws.sh`:

- Keep CDK bootstrap. GitHub OIDC remains optional (`GITHUB_ORG` +
  `yarn deploy:iam`). Do not require a GitHub org for a local TUI deploy.

`scripts/setup-dev.sh`:

- Copy `components/infra/.env.example` when present (already). If the example
  is missing, fail with a path. Do not invent a second template.

---

## Agent publish

`scripts/publish-agent-release.sh` and `desktop-agent.yml` **publish** job:

### `ARTIFACT_STORE=s3` (default)

- `aws s3 cp` to `s3://${ARTIFACT_BUCKET}/${UPDATE_ENV_PREFIX}/…` using
  GitHub OIDC AWS role (same as `deploy.yml`) or the caller’s AWS CLI.
- No `AWS_ENDPOINT_URL` override, no R2 keys.
- `ARTIFACT_BUCKET` from secret/env or from stack output
  `ArtifactBucketName` (CI: GitHub secret or `cdk-outputs` artifact).

### `ARTIFACT_STORE=r2`

- Current R2 endpoint + keys behavior.

Branch on `ARTIFACT_STORE` secret/env (default `s3`). Fail if `r2` and R2
secrets are missing. Fail if `s3` and bucket name is missing.

Object keys unchanged (`{env}/manifest.json`, `{env}/{version}/{file}`).

---

## GitHub Actions `deploy.yml`

- `ROOT_DOMAIN`, `WEB_DOMAIN` / DNS label, `ACM_CERTIFICATE_ARN` from
  **secrets or variables**, not literals.
- If `WEB_DOMAIN` is empty: Mode A — CDK deploy without ACM; skip the `dns`
  job (or make `dns` `if:` all Cloudflare inputs present).
- Frontend job: build with `VITE_WS_URL` / `VITE_REST_URL` from stack
  outputs and `VITE_CLERK_PUBLISHABLE_KEY` from secrets; S3 sync +
  invalidation unchanged.
- Pass `ARTIFACT_STORE` and artifact secrets into CDK deploy env.
- Do not fail the workflow when Cloudflare secrets are absent.

Document required vs optional secrets in root `README.md` **Getting started
/ Self-host** (this spec may edit README for CI secrets + “prefer
`yarn bootstrap`”). Do not write a new guide under `docs/`.

Required Actions secrets for a fork (Mode A, S3, no custom domain):

- `AWS_DEPLOY_ROLE_ARN`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_ISSUER`
- `CLERK_JWKS_URL`
- `TABBYWEBRTC_JWT_SECRET`

Optional: `ACM_CERTIFICATE_ARN`, `WEB_DOMAIN`, Cloudflare token/zone,
`TURN_*`, R2_*, `ARTIFACT_STORE` (default s3), `ARTIFACT_BUCKET` if not
taken from stack outputs.

---

## README

Replace the current “edit `.env` then `yarn cdk:deploy:dev`” as the
self-host story with:

1. Fork / clone
2. `yarn bootstrap` (TUI) — primary
3. Optional: GitHub Actions after OIDC + secrets

Keep `yarn setup` / `yarn dev` for **local** development. Link
`docs/clerk-setup.md` as the Clerk dashboard reference the TUI also
summarizes; do not duplicate the whole Clerk doc.

Download URL table: keep `REPLACE_DEV_REST_URL` language or say “RestEndpoint
from bootstrap done screen / CDK output.”

---

## Acceptance

1. Grep of deploy scripts and `deploy.yml` has no `mikewheeler.dev`.
2. Mode A fork: Actions can deploy infra + frontend with Clerk + AWS role
   only.
3. Agent publish to S3 works with OIDC; R2 path still works when selected.
4. Cloudflare DNS job/script is skippable.

---

## Out of scope

- TUI screens.
- CDK domain constructs (`01`) and Lambda S3 client (`02`).
- Changing `pr-check.yml` beyond what a new workspace package needs to typecheck
  (if bootstrap is in workspaces, add a bootstrap typecheck step or include it
  in `yarn typecheck` — allowed).
