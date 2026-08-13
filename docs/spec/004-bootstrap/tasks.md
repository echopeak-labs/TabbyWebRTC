# Spec 004-bootstrap — Agent Task Lists

Each section below corresponds to a spec file in `docs/spec/004-bootstrap/`.
Tasks are ordered for sequential execution within a spec. Check `agents.md`
waves before starting.

Use `[ ]` / `[x]` to track individual task completion. No work is marked done
at spec creation.

---

## backend/01-forkable-stack.md

- [ ] Remove hardcoded `mikewheeler.dev` from `domain-params.ts`; read
      `WEB_DOMAIN` / optional `ROOT_DOMAIN` + `WEB_DNS_NAME`
- [ ] Mode A: CloudFront default URL — no `domainNames`, no ACM, no throw on
      missing `ACM_CERTIFICATE_ARN`
- [ ] Mode B: custom `WEB_DOMAIN` requires `ACM_CERTIFICATE_ARN` in us-east-1;
      fail synth with a message that names Mode A
- [ ] Set REST (and S3 bucket) CORS allow origin to `https://` + resolved SPA
      host (CloudFront domain in Mode A)
- [ ] Stack output `WebDomain` is the resolved host; add `WebOrigin`
- [ ] Add tracked `components/infra/.env.example` with the canonical key list
      (Clerk/JWT required; domain/ACM/TURN/Cloudflare/R2 optional;
      `ARTIFACT_STORE=s3`)
- [ ] Synth tests: Mode A without ACM succeeds; Mode B without ACM fails;
      Mode B with ACM has aliases; no `mikewheeler.dev` in templates unless
      set via env

---

## backend/02-s3-storage.md

- [ ] Add CDK private artifacts bucket for `ARTIFACT_STORE=s3`; grant Lambda
      GetObject; output `ArtifactStore` + `ArtifactBucketName`
- [ ] Generalized object-store helper (S3 role creds vs R2 custom endpoint);
      `ARTIFACT_STORE` default `s3`
- [ ] Do not require R2 keys when store is `s3`; require them when `r2`
- [ ] Keep `{env}/manifest.json` and `{env}/{version}/{filename}` keys
- [ ] `GET /downloads/{platform}` stays W32-10 compliant (no base64 installer
      body) for both stores
- [ ] Secrets JSON includes `ARTIFACT_STORE` + `ARTIFACT_BUCKET`; R2 secret
      keys only needed for `r2`
- [ ] Tests for s3 client, r2 client, 404s, and CDK bucket presence/absence
- [ ] Append storage keys to `.env.example` only as needed if `01` placeholders
      are incomplete

---

## cicd/01-self-host-pipeline.md

- [ ] `deploy-dev.sh` / `deploy-prod.sh`: no `mikewheeler.dev`; Cloudflare
      upsert only when token, zone, `ROOT_DOMAIN`, `WEB_DNS_NAME` are set
- [ ] `update-cloudflare-dns.sh`: require `ROOT_DOMAIN` (no default)
- [ ] Extract or share frontend S3 sync + CloudFront invalidation from
      `cdk-outputs.json` for CI and TUI
- [ ] `deploy.yml`: domain/ACM/Cloudflare from secrets/vars; skip DNS job when
      Cloudflare inputs missing; pass `ARTIFACT_STORE`
- [ ] `desktop-agent.yml` + `publish-agent-release.sh`: publish to S3 by
      default; keep R2 when `ARTIFACT_STORE=r2`
- [ ] README: self-host = `yarn bootstrap`; keep `yarn setup`/`yarn dev` for
      local; table of required vs optional GitHub secrets; no
      `mikewheeler.dev` as the documented host
- [ ] Grep deploy scripts and `deploy.yml` for `mikewheeler.dev` — zero hits

---

## bootstrap/01-tui.md

- [ ] Add workspace package `components/bootstrap` (Ink + TypeScript) and root
      `yarn bootstrap`
- [ ] Prerequisites screen (Node 22, Yarn, AWS CLI + identity; Rust optional)
- [ ] AWS step: show account/region; optional CDK bootstrap
- [ ] Storage step: default S3; optional R2 keys
- [ ] Domain step: default CloudFront; custom domain requires ACM ARN
- [ ] Clerk step: dashboard URL, paste publishable + issuer, derive JWKS,
      generate `TABBYWEBRTC_JWT_SECRET`
- [ ] Cloudflare step: skip by default; validate token if used
- [ ] TURN step: skip by default
- [ ] Review + write `components/infra/.env` and frontend Clerk/WS/REST env
      (mask secrets); re-run loads existing env
- [ ] Deploy: CDK, fill `VITE_WS_URL`/`VITE_REST_URL` from outputs, build
      frontend, sync + invalidate; optional DNS upsert
- [ ] Done screen: SPA URL, REST URL, add origin in Clerk, then Host vs Guest
- [ ] Do not create Clerk/AWS accounts, issue ACM certs, or print raw bucket
      URLs
