# Backend — Update Distribution SDD

## Scope

Defines the desktop agent update API: REST endpoints on the existing API Gateway that serve a version manifest and stream native installer artifacts from Cloudflare R2. Each CDK stack (`TabbyRDPDev`, `TabbyRDPProd`) exposes the same route shape but reads a different R2 prefix.

---

## Architecture

```
[Desktop Agent / Browser / README link]
        |
        v
[API Gateway REST]  tabbyrdp-rest-{env}
        |
        +-- GET /updates/manifest.json  --> [Lambda: updates-handler]
        +-- GET /downloads/{platform}   --> [Lambda: updates-handler]
        |
        v
[Cloudflare R2]  s3://{bucket}/{env}/manifest.json
                 s3://{bucket}/{env}/{version}/{filename}
```

R2 is the authoritative store for installer bytes and the manifest. Lambda reads R2 via the S3-compatible API (`@aws-sdk/client-s3` with a custom endpoint). End users never receive direct R2 URLs.

---

## Environment Mapping

| CDK stack | `UPDATE_ENV_PREFIX` | R2 prefix |
|---|---|---|
| `TabbyRDPDev` | `dev` | `dev/` |
| `TabbyRDPProd` | `prod` | `prod/` |

Each stack has its own REST API (`tabbyrdp-rest-dev`, `tabbyrdp-rest-prod`). This satisfies the dev/prod stage requirement without sharing a single API across environments.

---

## REST Endpoints

### `GET /updates/manifest.json`

Returns the latest release manifest for the deployed environment.

**Handler behavior:**

1. Read `{UPDATE_ENV_PREFIX}/manifest.json` from R2.
2. Return JSON body unchanged.
3. Set headers: `Content-Type: application/json`, `Cache-Control: max-age=300`.
4. Return `404` if manifest object does not exist.

**Example response:**

```json
{
  "schema_version": 1,
  "version": "1.2.3",
  "published_at": "2026-06-28T12:00:00Z",
  "artifacts": {
    "linux-x86_64": {
      "filename": "tabbyrdp-agent_1.2.3_amd64.deb",
      "sha256": "a1b2c3d4e5f6...",
      "size_bytes": 12345678
    },
    "linux-aarch64": {
      "filename": "tabbyrdp-agent_1.2.3_arm64.deb",
      "sha256": "...",
      "size_bytes": 11800000
    },
    "macos-x86_64": {
      "filename": "tabbyrdp-agent_1.2.3_x86_64.pkg",
      "sha256": "...",
      "size_bytes": 14000000
    },
    "macos-aarch64": {
      "filename": "tabbyrdp-agent_1.2.3_aarch64.pkg",
      "sha256": "...",
      "size_bytes": 13500000
    },
    "windows-x86_64": {
      "filename": "tabbyrdp-agent_1.2.3_x86_64.msi",
      "sha256": "...",
      "size_bytes": 15000000
    }
  }
}
```

### `GET /downloads/{platform}`

Streams the latest installer for the requested platform. Used by the auto-updater, human README links, and manual browser downloads.

**Path parameter `platform`** — one of:

| Key | Target |
|---|---|
| `linux-x86_64` | Linux amd64 `.deb` |
| `linux-aarch64` | Linux arm64 `.deb` |
| `macos-x86_64` | macOS Intel `.pkg` |
| `macos-aarch64` | macOS Apple Silicon `.pkg` |
| `windows-x86_64` | Windows amd64 `.msi` |

**Handler behavior:**

1. Fetch and parse `{UPDATE_ENV_PREFIX}/manifest.json` from R2.
2. Look up `artifacts[platform]`. Return `404` if platform key is missing or unknown.
3. Stream object `{UPDATE_ENV_PREFIX}/{version}/{filename}` from R2.
4. Set response headers:
   - `Content-Type` per artifact extension (see table below)
   - `Content-Disposition: attachment; filename="{filename}"`
   - `Content-Length: {size_bytes}` when known
   - `X-TabbyRDP-Version: {version}`
   - `X-TabbyRDP-SHA256: {sha256}`

| Extension | Content-Type |
|---|---|
| `.deb` | `application/vnd.debian.binary-package` |
| `.pkg` | `application/octet-stream` |
| `.msi` | `application/octet-stream` |

**No authentication required.** Manifest and downloads are public read endpoints.

---

## Manifest Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer | yes | Always `1` for this spec |
| `version` | string | yes | Semver of the release (e.g. `1.2.3`) |
| `published_at` | string | yes | ISO 8601 UTC timestamp |
| `artifacts` | object | yes | Map of platform key → artifact record |
| `artifacts[].filename` | string | yes | Basename of the installer file |
| `artifacts[].sha256` | string | yes | Lowercase hex SHA-256 of the file |
| `artifacts[].size_bytes` | integer | yes | Exact byte length of the file |

The manifest is written by the release CI pipeline (`cicd/03`). This backend spec only reads it.

---

## R2 Bucket Layout

```
tabbyrdp-releases/
  dev/
    manifest.json
    1.2.3/
      tabbyrdp-agent_1.2.3_amd64.deb
      tabbyrdp-agent_1.2.3_arm64.deb
      ...
  prod/
    manifest.json
    1.2.3/
      ...
```

Object key for an artifact: `{env}/{version}/{filename}`.

---

## Lambda Implementation

**File:** `infra/lambda/src/handlers/updates.ts`

Single handler entry point routed by API Gateway path:

```ts
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath
  if (path === '/updates/manifest.json') return getManifest()
  const match = path.match(/^\/downloads\/([a-z0-9_-]+)$/)
  if (match) return downloadArtifact(match[1])
  return { statusCode: 404, body: 'Not found' }
}
```

**Helper file:** `infra/lambda/src/lib/r2.ts`

```ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function getObject(key: string): Promise<ReadableStream | null> { ... }
```

Use streaming response (`isBase64Encoded: true` with chunked body, or API Gateway HTTP API v2 binary streaming) to avoid loading large installers into Lambda memory.

---

## CDK Wiring

Extend `infra/lib/tabbyrdp-stack.ts`:

```ts
const updatesResource = restApi.root.addResource('updates')
const manifestResource = updatesResource.addResource('manifest.json')
manifestResource.addMethod('GET', new LambdaIntegration(lambdas.updatesFn), {
  authorizationType: AuthorizationType.NONE,
})

const downloadsResource = restApi.root.addResource('downloads')
const platformResource = downloadsResource.addResource('{platform}')
platformResource.addMethod('GET', new LambdaIntegration(lambdas.updatesFn), {
  authorizationType: AuthorizationType.NONE,
})
```

Extend `infra/lib/constructs/lambda-functions.ts`:

```ts
this.updatesFn = new NodejsFunction(this, 'UpdatesHandler', {
  entry: 'lambda/src/handlers/updates.ts',
  handler: 'handler',
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 256,
  timeout: Duration.seconds(30),
  role: props.lambdaRole,
  environment: {
    R2_BUCKET: envOrPlaceholder('R2_BUCKET', 'tabbyrdp-releases'),
    R2_ENDPOINT: envOrPlaceholder('R2_ENDPOINT', 'https://placeholder.r2.cloudflarestorage.com'),
    R2_ACCESS_KEY_ID: envOrPlaceholder('R2_ACCESS_KEY_ID', 'placeholder'),
    R2_SECRET_ACCESS_KEY: envOrPlaceholder('R2_SECRET_ACCESS_KEY', 'placeholder'),
    UPDATE_ENV_PREFIX: props.envName,
  },
  bundling,
})
```

**CDK outputs:**

```ts
new CfnOutput(this, 'UpdateManifestUrl', {
  value: `${restApi.url}updates/manifest.json`,
})
new CfnOutput(this, 'DownloadBaseUrl', {
  value: `${restApi.url}downloads/`,
})
```

---

## Environment Variables

| Variable | Source | Description |
|---|---|---|
| `R2_BUCKET` | GitHub Secret / deploy env | R2 bucket name |
| `R2_ENDPOINT` | Derived from `R2_ACCOUNT_ID` | `https://{account_id}.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | GitHub Secret | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | GitHub Secret | R2 API token secret |
| `UPDATE_ENV_PREFIX` | CDK `envName` prop | `dev` or `prod` |

No AWS-native S3 bucket or IAM S3 policy is required. R2 credentials are injected at deploy time.

---

## Dependencies

- `backend/03-aws-infra.md` — REST API scaffold must exist.

---

## Acceptance Criteria

1. `curl {RestEndpoint}/updates/manifest.json` returns valid JSON manifest for the deployed env.
2. `curl -L -o out.deb {RestEndpoint}/downloads/linux-x86_64` streams the `.deb` named in the manifest.
3. `curl {RestEndpoint}/downloads/unknown-platform` returns `404`.
4. `TabbyRDPDev` and `TabbyRDPProd` stacks read from `dev/` and `prod/` R2 prefixes respectively.
5. `cdk synth --context env=dev` and `cdk synth --context env=prod` complete without errors.
6. Unit tests cover manifest parsing, platform key validation, and missing-artifact 404 paths.

---

## Out of Scope

- Writing or publishing manifests (owned by `cicd/03`).
- Client-side update logic (owned by `desktop-agent/05`).
- Code signing or notarization of installers.
- Delta/incremental updates or rollback endpoints.
