# Bootstrap — Self-host TUI SDD

## Scope

A terminal UI that walks a developer who cloned this repo through env vars,
domain, Clerk, Cloudflare, artifact storage (S3 vs R2), and CDK + frontend
deploy onto **their** AWS account.

Entry: `yarn bootstrap` from the repo root.

New workspace package: `components/bootstrap/` (Yarn workspaces already
include `components/*`).

Depends on `backend/01` env schema and deployable Mode A/B stack, and
`backend/02` `ARTIFACT_STORE`. Deploy mechanics it shells out to are
normalized in `cicd/01` (parameterized `deploy-dev.sh` / DNS script). This
spec owns the TUI and the root `yarn bootstrap` script only.

---

## Why a TUI

Clerk and AWS accounts cannot be created for the user. Everything else
(secrets, `.env`, domain mode, storage, deploy, DNS) can be prompted,
generated, or skipped. A TUI is the productized step-by-step path; README
points at it instead of a dozen flags.

---

## Stack

- TypeScript, Node 22, Ink (`ink` + `@inkjs/ui` or equivalent Ink widgets)
- Run via `tsx` (already a root dep) or a package `bin`
- No comments in source (repo rule)
- Theme: dark background, amber accents where Ink allows; keep it readable
  on a default terminal

Non-interactive `--yes` / JSON config is **out of scope** for this spec
(re-run the TUI). CI continues to use GitHub secrets after a human first run.

---

## Command

```bash
yarn bootstrap
```

Root `package.json`: `"bootstrap": "yarn workspace bootstrap start"` (or
`tsx components/bootstrap/src/index.ts`). `--help` prints a short list of
steps and that Clerk + AWS accounts are created in the browser, not here.

Optional: `yarn bootstrap --env dev|prod` (default `dev`). Prod must confirm
with an explicit yes (same bar as `deploy-prod.sh`).

---

## Flow

Linear wizard. Back to previous step. Re-runnable: load existing
`components/infra/.env` and `components/frontend/.env` / `.env.local` and
show current values; do not overwrite secrets unless the user confirms.

Skip completed checks (AWS identity already valid, `.env` already has Clerk).

### 1. Prerequisites

Fail closed with install hints:

| Check | Required for |
|---|---|
| Node 22+ | TUI, CDK, frontend |
| Yarn 1.x | workspaces |
| AWS CLI v2 | deploy, identity |
| `aws sts get-caller-identity` succeeds | deploy |
| Rust / cargo | **optional** (agent package); warn, do not block cloud deploy |

### 2. AWS

Show account id + region (`us-east-1` stays the CDK region). If identity
fails, print `aws configure` / SSO help and stop that step until retry.

Offer CDK bootstrap if `cdk bootstrap` has not been run for this
account/region (`scripts/bootstrap-aws.sh` or `yarn cdk bootstrap` in
`components/infra`). Confirm before running.

GitHub OIDC (`yarn deploy:iam`) is **optional**, last-class: “set up GitHub
Actions later?” Default no.

### 3. Artifact storage

Default: **S3 (same AWS account)** — recommended for self-host.

Other: **Cloudflare R2** — prompt bucket, endpoint, access key, secret,
account id; validate non-empty.

Write `ARTIFACT_STORE=s3` or `r2` plus matching keys. S3 bucket name is
created by CDK; do not ask for a bucket name in S3 mode.

### 4. Domain

Default: **CloudFront URL** (Mode A). No ACM, no DNS.

Other: **Custom domain** — prompt `WEB_DOMAIN` (FQDN), `ACM_CERTIFICATE_ARN`
(us-east-1). Refuse to continue custom mode without an ARN. Explain cert
must exist before deploy; this TUI does not request ACM certs.

Optional `ROOT_DOMAIN` / `WEB_DNS_NAME` when Cloudflare DNS will be used.

### 5. Clerk

Cannot create the Clerk application.

- Print `https://dashboard.clerk.com` and the values needed (publishable key,
  Frontend API / issuer). JWKS = `{issuer}/.well-known/jwks.json`.
- Paste `pk_test_` or `pk_live_`. Reject empty / obviously wrong prefixes.
- Paste issuer URL; derive JWKS; show the triple for confirm.
- Generate `TABBYWEBRTC_JWT_SECRET` (cryptographically random) unless one
  already exists and user keeps it.
- Write `CLERK_*` into `components/infra/.env`.
- Write `VITE_CLERK_PUBLISHABLE_KEY` into `components/frontend/.env` (and
  `.env.local` if that is what Vite loads in this repo).

After a successful deploy (step 8), remind: add `WebOrigin` in Clerk
Dashboard domains / allowed origins. `pk_live_` will not work on localhost
(existing `docs/clerk-setup.md` rules). Do not paste secret Clerk keys into
logs.

### 6. Cloudflare (optional)

Default: **skip**.

If custom domain and user wants this TUI to upsert DNS:

- Prompt `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `ROOT_DOMAIN`,
  `WEB_DNS_NAME`.
- Validate token with a Cloudflare `GET /zones/:id` (or equivalent) before
  saving.
- Do not upsert until stack outputs exist (after deploy).

If Mode A (CloudFront only), skip this step unless the user still wants a
CNAME later (unusual); default skip.

### 7. TURN (optional)

Default: **skip** (LAN / host-candidate WebRTC). Empty `TURN_SECRET` /
`TURN_URLS` is valid per `01`.

If enabled: prompt secret + comma-separated URLs. Do not SSH to Hetzner
(`provision-turn.sh` stays a separate advanced script).

### 8. Review + write env

Show a table of keys (mask secrets). Confirm write to:

- `components/infra/.env`
- `components/frontend/.env` (Clerk publishable + placeholders for WS/REST
  until deploy fills them)

Then:

1. `cdk deploy` for the chosen env (`dev` default) using existing workspace
   scripts once `cicd/01` reads `WEB_DOMAIN` / `ROOT_DOMAIN` from `.env`
   instead of `mikewheeler.dev`. Until those scripts are parameterized, the
   TUI may invoke `yarn workspace infra cdk deploy …` with env exported from
   the written `.env`.
2. Read `cdk-outputs.json` (`WebDomain`, `WebOrigin`, `WsEndpoint`,
   `RestEndpoint`, `FrontendBucketName`, `FrontendDistributionId`).
3. Set `VITE_WS_URL` / `VITE_REST_URL` / `VITE_CLERK_PUBLISHABLE_KEY`,
   `yarn build:frontend`, `aws s3 sync` + CloudFront invalidation (same as
   `deploy.yml` frontend job).
4. If Cloudflare was configured, run `scripts/update-cloudflare-dns.sh` with
   `ROOT_DOMAIN` from env (not hardcoded).
5. Done screen: SPA URL, REST URL, “add this origin in Clerk”, next product
   step: open the webapp and choose Host vs Guest (003). Do not download
   installers until REST is up; Host page uses `/downloads/{platform}`.

Deploy failures stay on a screen with the command output tail and Retry /
Abort. Do not leave half-written frontend env pointing at old URLs without
saying so.

---

## Persistence

- Source of truth: the two `.env` files.
- Optional gitignored `components/bootstrap/.state.json` for last completed
  step index only — no secrets.
- Never print full JWT / R2 / Cloudflare tokens; mask in the review table.

---

## What the TUI must not do

- Create AWS or Clerk accounts.
- Issue ACM certificates.
- Install the desktop agent or change Host/Guest UI.
- Link to raw S3/R2 object URLs.
- Run as a web wizard; this is terminal-only.
- Call Clerk Management API to create applications.

---

## Acceptance

1. On a machine with Node, Yarn, AWS creds, and a Clerk app, a developer can
   complete Mode A + S3 and get a CloudFront URL that serves the SPA talking
   to that account’s API Gateway.
2. Custom domain path requires ACM ARN and does not invent `mikewheeler.dev`.
3. R2 path writes R2 keys and `ARTIFACT_STORE=r2`; S3 path does not require
   R2 keys.
4. Cloudflare step can be skipped; custom domain still deploys (DNS is
   operator’s problem until they run the step).
5. Re-running the TUI loads existing env and can redeploy.

---

## Out of scope

- GitHub template button / documenting every Actions secret in the TUI
  (cicd/01 README).
- Local `yarn dev` test-server setup (keep `yarn setup` / `yarn dev`).
- Windows-only TUI issues beyond “Ink runs in Windows Terminal.”
