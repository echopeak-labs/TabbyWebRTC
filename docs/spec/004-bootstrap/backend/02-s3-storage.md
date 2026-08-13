# Backend — S3 Primary Artifact Storage SDD

## Scope

Installer bytes and `manifest.json` default to **Amazon S3 in the same AWS
account** as the CDK stack. Cloudflare R2 remains an optional backend.

Extends `001-init/backend/05-update-distribution.md` and
`002-win32-support/backend/01-windows-downloads.md`. REST routes and object
key layout do not change. Depends on `01-forkable-stack.md` (env schema,
stack wiring).

---

## Why

R2 requires a second cloud account and extra secrets (`R2_ACCOUNT_ID`,
endpoint, access keys). Self-host on AWS should work with the deploy role
alone. Object layout stays:

```
{UPDATE_ENV_PREFIX}/manifest.json
{UPDATE_ENV_PREFIX}/{version}/{filename}
```

Clients still only hit:

```
GET {RestEndpoint}/updates/manifest.json
GET {RestEndpoint}/downloads/{platform}
```

Never return a durable raw bucket URL in API JSON. Presigned GET (W32-10) is
allowed and must work for both S3 and R2.

---

## Config

| Env | Values | Default |
|---|---|---|
| `ARTIFACT_STORE` | `s3` \| `r2` | `s3` |

### `s3` (primary)

- CDK creates a private bucket, e.g. `tabbywebrtc-artifacts-${envName}`
  (suffix account if needed for global uniqueness).
- Block public access. Encryption default. `RemovalPolicy.DESTROY` + auto
  delete objects on **dev**; **prod** retain.
- Grant the Lambda execution role `s3:GetObject` (and `s3:ListBucket` if
  needed) on this bucket. Presign needs the same principal the Lambda uses.
- Put `ARTIFACT_STORE=s3` and the bucket name into the app secret / Lambda
  env (`ARTIFACT_BUCKET` or reuse `R2_BUCKET` only if the name is generalized
  — prefer `ARTIFACT_BUCKET` + `ARTIFACT_STORE` and stop requiring R2 keys).
- S3 client: default AWS region (`us-east-1`), **no** custom endpoint, **no**
  static R2 keys. Use the Lambda role.

### `r2` (optional)

- No CDK R2 resource. Require `R2_BUCKET`, `R2_ENDPOINT`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` at deploy time.
- Client: current `createR2Client()` behavior (`region: 'auto'`, custom
  endpoint, static keys).
- Fail synth/deploy if `ARTIFACT_STORE=r2` and those keys are missing.

Invalid `ARTIFACT_STORE` → fail synth with the allowed values.

---

## Lambda object access

Replace R2-only helpers in `components/infra/lambda/src/lib/r2.ts` with a
store-agnostic module (rename is in-scope; keep a thin `r2.ts` re-export only
if tests need it briefly, then delete).

API:

- `getObjectBytes` / `getObjectText` (manifest)
- Presign GET for installer objects (W32-10) — same expiry rules as 002
  (minutes, not days)
- Bucket + key helpers unchanged: `manifestObjectKey()`,
  `artifactObjectKey(version, filename)`, `updateEnvPrefix()`

Branch on `ARTIFACT_STORE` (from env or secret JSON). One updates handler;
no duplicate routes.

W32-10 still applies: do **not** buffer MSI/deb/pkg as base64 Lambda
responses. 302 + presigned GET (or proven streaming) for
`GET /downloads/{platform}` on **both** stores.

---

## Secrets Manager

`tabbywebrtc/${env}/app` JSON:

| Key | `s3` | `r2` |
|---|---|---|
| `ARTIFACT_STORE` | `s3` | `r2` |
| `ARTIFACT_BUCKET` | CDK bucket name | R2 bucket name |
| `R2_ENDPOINT` | omit or empty | required |
| `R2_ACCESS_KEY_ID` | omit or empty | required |
| `R2_SECRET_ACCESS_KEY` | omit or empty | required |

Do not require R2 keys when store is `s3`. Lambda `updatesFn` environment
includes `ARTIFACT_STORE`, `ARTIFACT_BUCKET`, `UPDATE_ENV_PREFIX`, and
`APP_SECRET_ARN` as needed so the client can be built without a second
fetch if that is simpler — but do not put R2 secret keys in plaintext
Lambda env; keep them in Secrets Manager when store is `r2`.

---

## Stack

`02` may edit `lib/tabbywebrtc-stack.ts` only to instantiate the artifacts
bucket construct and pass it into `LambdaFunctions`. Do not revert `01`
domain / CORS behavior.

Add outputs:

| Output | Value |
|---|---|
| `ArtifactStore` | `s3` or `r2` |
| `ArtifactBucketName` | bucket name used at runtime |

---

## Tests

- `ARTIFACT_STORE=s3`: client uses default S3 endpoint; GetObject/presign
  mocked against AWS S3; no `R2_ENDPOINT` required.
- `ARTIFACT_STORE=r2`: client uses custom endpoint + static keys (existing
  updates tests, retargeted).
- Missing object / unknown platform → 404.
- Download path does not return `isBase64Encoded` bodies for installers.
- CDK: `s3` template contains an artifacts bucket and Lambda GetObject on it;
  `r2` template does not create that bucket (or creates none extra).

---

## Out of scope

- Changing platform keys or manifest schema.
- Frontend download URLs (003 still uses REST only).
- CI upload commands (cicd/01).
- TUI storage picker (bootstrap/01) — this spec only implements the backend
  switch the TUI will write into `.env`.
