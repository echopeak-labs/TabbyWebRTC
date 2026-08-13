# Backend — Windows Downloads SDD

## Scope

Ensure the Windows MSI is stored in the existing S3-compatible release bucket
(Cloudflare R2) and is downloadable via
`GET /downloads/windows-x86_64`. Closes W32-10. Extends
`001-init/backend/05-update-distribution.md` without adding a second bucket or
new platform key.

---

## Contract

```
CI (cicd/01)
  → put object  {env}/{version}/tabbywebrtc-agent_{version}_x86_64.msi
  → put object  {env}/manifest.json  (artifacts.windows-x86_64 = …)

Client / README / auto-updater
  → GET {RestEndpoint}/downloads/windows-x86_64
  → MSI bytes + Content-Disposition + X-TabbyWebRTC-SHA256
```

Reuse existing routes in
`components/infra/lib/tabbywebrtc-stack.ts`:

- `GET /updates/manifest.json`
- `GET /downloads/{platform}`

No new AWS S3 bucket. R2 remains authoritative. End users never receive a raw
R2 URL unless a short-lived presigned redirect is the chosen delivery mechanism
below.

---

## Platform Key

| Key | Artifact |
|---|---|
| `windows-x86_64` | Per-user MSI from cicd/01 |

Portable `.exe` is out of this endpoint’s scope.

---

## W32-10 — Payload Size Gap

Current `components/infra/lambda/src/handlers/updates.ts` loads the full object
with `getObjectBytes` and returns `isBase64Encoded: true`. API Gateway REST
proxy responses are capped (~10 MB). A real MSI exceeds that limit.

**Required:** change the download path so a multi‑tens‑of‑MB MSI succeeds.

Allowed approaches (pick one; document in code/PR):

1. **302 + presigned GET** to R2 (preferred for cost/simplicity): Lambda reads
   manifest, validates platform, returns `Location` with a short-lived
   presigned URL. Client follows redirect. Keep SHA-256 headers on the 302 or
   require clients to trust the manifest.
2. **Response streaming** / HTTP API payload streaming if the stack is migrated
   and proven to stream large bodies without base64 buffering.
3. Equivalent pattern that never materializes the full MSI as a base64 Lambda
   response body.

Acceptance for any approach:

- `curl -L -o agent.msi "{RestEndpoint}/downloads/windows-x86_64"` produces a
  file whose SHA-256 matches `manifest.artifacts.windows-x86_64.sha256`.
- Missing platform or missing object → `404`.
- Dev and prod stacks keep separate `{env}/` prefixes.

---

## Security

- Downloads remain **public** (INF-07): agents and first-time installers have no
  JWT yet.
- Integrity: HTTPS + manifest SHA-256 (agent verifies before install).
- Presigned URLs (if used) must expire quickly (minutes, not days) and must not
  grant list/write on the bucket.
- Authenticode still deferred.

---

## CDK / Lambda Touchpoints

Allowed write paths for this domain (see `agents.md`):

- `components/infra/lambda/src/handlers/updates.ts`
- `components/infra/lambda/src/lib/r2.ts` (and related helpers)
- Unit tests under `components/infra/lambda/`

Do not rewrite unrelated auth/signaling handlers.

---

## Dependencies

- `cicd/01-windows-artifacts.md` publishes the MSI and manifest entry.
- Existing `001` REST API + `updatesFn` wiring.

Do not run this domain in parallel with cicd/01 if both change the manifest
filename contract.

---

## Acceptance Criteria

1. After a published Windows release, manifest includes `windows-x86_64`.
2. Download endpoint returns the MSI (directly or via redirect) for that key.
3. Unit tests cover platform resolution, missing artifact 404, and the chosen
   large-object strategy (presign mock or streaming mock).
4. No new AWS S3 bucket appears in CDK.
5. Linux/macOS download keys keep working.

---

## Out of Scope

- Private/authenticated downloads.
- Delta updates.
- Frontend download UI redesign.
