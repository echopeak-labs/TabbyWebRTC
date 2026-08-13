# Backend — Forkable CDK Stack SDD

## Scope

Make `TabbyWebRTCDev` / `TabbyWebRTCProd` deployable in **any** AWS account.
Remove hardcoded maintainer domain, required ACM, and CORS locked to
`mikewheeler.dev`. This spec owns CDK domain / frontend hosting / REST CORS
and the canonical `components/infra/.env.example`.

Does **not** implement S3-vs-R2 object IO (see `02-s3-storage.md`). Does **not**
build the TUI. Does **not** retarget GitHub Actions.

---

## Problem

Today a clone cannot `yarn cdk:deploy:dev`:

| Hardcoding | File |
|---|---|
| `ROOT_DOMAIN = 'mikewheeler.dev'` | `components/infra/lib/domain-params.ts` |
| ACM cert required | `constructs/frontend-hosting.ts` throws without `ACM_CERTIFICATE_ARN` |
| CloudFront `domainNames` + that cert | same |
| REST CORS `https://${webDomain(env)}` | `lib/tabbywebrtc-stack.ts` |

A forker has no cert, no hostname, and CORS that will not match their
CloudFront URL.

---

## Domain modes

`WEB_DOMAIN` and `ACM_CERTIFICATE_ARN` come from env (loaded by deploy scripts
from `components/infra/.env`) or CDK context. Do not read a hardcoded domain.

### Mode A — CloudFront default (default for self-host)

When `WEB_DOMAIN` is unset/empty:

- Do **not** set CloudFront `domainNames` or `certificate`.
- Viewer URL is `distribution.distributionDomainName` (`*.cloudfront.net`).
- `webDomainName` / stack output `WebDomain` is that CloudFront domain
  (no `https://` prefix).
- CORS allow origin is `https://${webDomainName}`.
- `ACM_CERTIFICATE_ARN` must not be required.

This is the path a clone uses to get a running SPA with only an AWS account.

### Mode B — custom domain

When `WEB_DOMAIN` is set (e.g. `tabbywebrtc.example.com`):

- `ACM_CERTIFICATE_ARN` is required (cert in **us-east-1**, covering that
  name). Missing ARN → fail synth/deploy with a message that names Mode A.
- CloudFront `domainNames: [WEB_DOMAIN]`, attach that cert.
- CORS allow origin is `https://${WEB_DOMAIN}`.
- Stack output `WebDomain` is `WEB_DOMAIN`.
- DNS CNAME is **not** created by CDK. Cloudflare (or other DNS) is TUI / cicd.

`ROOT_DOMAIN` and `WEB_DNS_NAME` (record label) are optional helpers for DNS
scripts and `.env.example`. CDK must not concatenate `tabbywebrtc.` +
`mikewheeler.dev`. If both `WEB_DOMAIN` and `ROOT_DOMAIN`+`WEB_DNS_NAME` are
set, `WEB_DOMAIN` wins.

Keep `envName` `dev` | `prod` for stack id and table names.

---

## `domain-params.ts`

Replace the constant `mikewheeler.dev` with functions that read env:

| Export | Behavior |
|---|---|
| `webDomain(envName)` | Mode B: `WEB_DOMAIN`. Mode A: empty string meaning “use CloudFront domain after the distribution exists.” |
| `hasCustomDomain()` | `WEB_DOMAIN` is non-empty |
| `corsOrigin(webDomainName)` | `https://${webDomainName}` with no trailing slash |

Frontend hosting must pass the **resolved** hostname (custom or
`distributionDomainName`) into CORS. Because CloudFront domain is only known
after the distribution is created, REST CORS cannot use `webDomain()` at
construct init in Mode A.

**Required wiring:** create `FrontendHosting` first, then set REST
`defaultCorsPreflightOptions.allowOrigins` from
`https://${frontend.webDomainName}`. If API Gateway CORS cannot be set after
`RestApi` construction in the current CDK version, use a Gateway response /
`addGatewayResponse` / `CfnRestApi` override, or construct RestApi after
FrontendHosting. Pick one; CORS origin must equal the live SPA origin.

---

## Frontend hosting

Keep: private S3 bucket, OAI/OAC, SPA 403/404 → `index.html`, security headers
/ CSP (Clerk hosts stay in CSP).

Change:

- Bucket name may keep `tabbywebrtc-web-${envName}` (account-scoped; unique
  enough). If that name collides across forks in the same account, suffix
  account id — only if tests show a clash.
- Mode A: no `domainNames`, no cert, no throw on missing ACM.
- Mode B: current custom-domain behavior with env ARN.
- S3 CORS `allowedOrigins` uses `https://${this.webDomainName}` after it is
  known (CloudFront domain in Mode A).

`webDomainName` is always the hostname clients will type (CloudFront or
custom), never `mikewheeler.dev` unless the forker set that in env.

---

## Canonical env file

Add `components/infra/.env.example` (repo-tracked). `setup-dev.sh` already
copies it to `components/infra/.env`. Include every key the stack and TUI
need, with comments which are required vs optional.

Required for a Mode A deploy:

```
CLERK_PUBLISHABLE_KEY=
CLERK_ISSUER=
CLERK_JWKS_URL=
TABBYWEBRTC_JWT_SECRET=
```

Optional:

```
WEB_DOMAIN=
WEB_DNS_NAME=
ROOT_DOMAIN=
ACM_CERTIFICATE_ARN=
TURN_SECRET=
TURN_URLS=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
ARTIFACT_STORE=s3
R2_BUCKET=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ACCOUNT_ID=
```

`ARTIFACT_STORE` default `s3`. Values implemented in `02`. This file is the
schema source for the TUI; do not invent a second schema.

Do not commit real `.env`. Placeholders only.

Frontend keys stay in `components/frontend/.env.example`
(`VITE_CLERK_PUBLISHABLE_KEY`, `VITE_WS_URL`, `VITE_REST_URL`). CDK does not
write those; the TUI / cicd does after stack outputs exist.

---

## Secrets Manager

Keep stuffing Clerk / JWT / TURN into `tabbywebrtc/${env}/app`. Empty TURN
is allowed (LAN-only). Do not require `TURN_SECRET` / `TURN_URLS` for synth.
Placeholders may remain for unused keys so the secret JSON shape stays stable.
`02` adds artifact-store fields.

---

## Outputs

Keep existing outputs. `WebDomain` must be the resolved SPA host. Add if
missing:

| Output | Value |
|---|---|
| `WebOrigin` | `https://${webDomainName}` (CORS / Clerk origin) |

`WsEndpoint` and `RestEndpoint` stay API Gateway URLs. Frontend build uses
those as `VITE_WS_URL` / `VITE_REST_URL`.

---

## Tests

- Synth **without** `ACM_CERTIFICATE_ARN` and **without** `WEB_DOMAIN`
  succeeds; template has CloudFront distribution with no aliases.
- Synth with `WEB_DOMAIN` and no ACM fails with a clear error.
- Synth with `WEB_DOMAIN` + ACM includes aliases + cert.
- CORS allow origin in the template equals `https://` + resolved host for
  Mode B. Mode A: origin uses the CloudFront domain token / output, not
  `mikewheeler.dev`.
- `domain-params` unit tests: empty vs set `WEB_DOMAIN`.

---

## Out of scope

- Cloudflare DNS upsert (cicd + TUI).
- Creating ACM certificates.
- Changing Lambda download IO (`02`).
- GitHub OIDC / workflows.
- Frontend source (003 Host/Guest).
