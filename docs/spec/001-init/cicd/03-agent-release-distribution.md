# CI/CD — Agent Release Distribution SDD

## Scope

Defines native installer packaging, R2 upload, manifest generation, and root README download links for the TabbyWebRTC desktop agent. Builds on the existing `desktop-agent.yml` release matrix and the manifest schema defined in `backend/05-update-distribution.md`.

---

## Repository Additions

```
/
  README.md                          # Root download links (dev section first)
  desktop-agent/
    packaging/
      deb/                           # nfpm or cargo-deb config per arch
      wix/                           # WiX source for Windows MSI
      macos/                         # pkgbuild/productbuild scripts
  scripts/
    publish-agent-release.sh         # Manual publish mirroring CI
  .github/workflows/
    desktop-agent.yml                # Extended with package + R2 upload steps
```

---

## Installer Packaging

Each CI matrix target produces one native installer artifact.

| Platform key | OS runner | Target triple | Artifact | Build tooling |
|---|---|---|---|---|
| `linux-x86_64` | ubuntu-latest | x86_64-unknown-linux-gnu | `.deb` | `nfpm` |
| `linux-aarch64` | ubuntu-latest | aarch64-unknown-linux-gnu | `.deb` | `nfpm` |
| `macos-x86_64` | macos-latest | x86_64-apple-darwin | `.pkg` | `pkgbuild` + `productbuild` |
| `macos-aarch64` | macos-latest | aarch64-apple-darwin | `.pkg` | `pkgbuild` + `productbuild` |
| `windows-x86_64` | windows-latest | x86_64-pc-windows-msvc | `.msi` | WiX via `cargo-wix` |

### Linux `.deb`

Use `nfpm` with a shared config template in `desktop-agent/packaging/deb/nfpm.yaml`:

```yaml
name: tabbywebrtc-agent
arch: amd64   # or arm64 per matrix job
platform: linux
version: "${VERSION}"
section: net
priority: optional
maintainer: TabbyWebRTC
description: TabbyWebRTC desktop streaming agent
contents:
  - src: tabbywebrtc-agent
    dst: /usr/bin/tabbywebrtc-agent
  - src: tabbywebrtc-agent.service
    dst: /lib/systemd/system/tabbywebrtc-agent.service
scripts:
  postinstall: packaging/deb/postinstall.sh
```

Output filename: `tabbywebrtc-agent_{version}_{arch}.deb`.

### Windows `.msi`

Use `cargo-wix` with WiX source in `desktop-agent/packaging/wix/main.wxs`. Installs binary to `Program Files\TabbyWebRTC\tabbywebrtc-agent.exe` and registers a Windows service.

Output filename: `tabbywebrtc-agent_{version}_x86_64.msi`.

### macOS `.pkg`

Build script `desktop-agent/packaging/macos/build-pkg.sh`:

1. Stage binary to `payload/usr/local/bin/tabbywebrtc-agent`.
2. `pkgbuild --root payload --identifier com.tabbywebrtc.agent --version {version} tabbywebrtc-agent-{version}-{arch}.pkg`.
3. Optionally wrap with `productbuild` for distribution pkg.

Output filename: `tabbywebrtc-agent_{version}_{arch}.pkg` where `arch` is `x86_64` or `aarch64`.

---

## R2 Bucket Layout

```
tabbywebrtc-releases/
  dev/
    manifest.json
    1.2.3/
      tabbywebrtc-agent_1.2.3_amd64.deb
      tabbywebrtc-agent_1.2.3_arm64.deb
      tabbywebrtc-agent_1.2.3_x86_64.pkg
      tabbywebrtc-agent_1.2.3_aarch64.pkg
      tabbywebrtc-agent_1.2.3_x86_64.msi
  prod/
    manifest.json
    ...
```

Upload key pattern: `{env}/{version}/{filename}`.
Manifest key: `{env}/manifest.json`.

---

## Manifest Generation

After all matrix jobs complete, a `publish` job aggregates artifact metadata and writes `manifest.json`:

```json
{
  "schema_version": 1,
  "version": "1.2.3",
  "published_at": "2026-06-28T12:00:00Z",
  "artifacts": {
    "linux-x86_64": {
      "filename": "tabbywebrtc-agent_1.2.3_amd64.deb",
      "sha256": "<computed>",
      "size_bytes": 12345678
    }
  }
}
```

SHA-256 is computed over the final installer bytes before upload:

```bash
sha256sum "$artifact" | awk '{print $1}'
```

---

## Workflow Changes

Extend `.github/workflows/desktop-agent.yml` (or add `agent-release.yml` triggered on `v*` tags):

### Build job (per matrix target)

Existing steps through `cargo build --release --target` remain unchanged. Add after rename step:

```yaml
- name: Package installer
  run: ./packaging/build.sh ${{ matrix.platform_key }} ${{ matrix.version }}
- name: Compute SHA-256
  run: sha256sum packaged/* > packaged/checksum.txt
- uses: actions/upload-artifact@v4
  with:
    name: installer-${{ matrix.platform_key }}
    path: desktop-agent/packaged/
```

### Publish job (after build matrix)

Runs only on `v*` tags for `prod`, or on push to `main` for `dev` (optional nightly dev channel):

```yaml
publish:
  needs: build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/download-artifact@v4
      with:
        path: artifacts
        merge-multiple: true
    - name: Generate manifest.json
      run: ./scripts/generate-manifest.sh "$VERSION" artifacts/ > manifest.json
    - name: Upload to R2
      env:
        AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
        AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        AWS_ENDPOINT_URL: https://${{ secrets.R2_ACCOUNT_ID }}.r2.cloudflarestorage.com
      run: |
        aws s3 cp manifest.json "s3://${{ secrets.R2_BUCKET }}/${{ env.UPDATE_ENV_PREFIX }}/manifest.json"
        for f in artifacts/**/*; do
          aws s3 cp "$f" "s3://${{ secrets.R2_BUCKET }}/${{ env.UPDATE_ENV_PREFIX }}/${{ env.VERSION }}/$(basename "$f")"
        done
```

Use `aws s3` CLI with `--endpoint-url` pointed at R2. No AWS S3 bucket is created in CDK.

---

## GitHub Secrets

| Secret | Used By | Description |
|---|---|---|
| `R2_ACCESS_KEY_ID` | publish job, backend deploy | R2 S3-compatible access key |
| `R2_SECRET_ACCESS_KEY` | publish job, backend deploy | R2 S3-compatible secret key |
| `R2_BUCKET` | publish job, backend deploy | Bucket name (e.g. `tabbywebrtc-releases`) |
| `R2_ACCOUNT_ID` | publish job, backend deploy | Cloudflare account ID for endpoint URL |
| `DEV_REST_URL` | README stub | Dev REST API base URL (trailing slash optional) |
| `PROD_REST_URL` | README prod section (future) | Prod REST API base URL |

Add these to the secrets table in `cicd/01-pipeline.md` when that spec is next updated.

---

## Root README.md

Create `README.md` at the project root with a dev download section using API Gateway proxy URLs (not direct R2 links):

```markdown
# TabbyWebRTC

Remote desktop streaming with a browser-based viewer and mobile auth key.

## Desktop Agent — Dev Downloads

Latest installers are served via the dev API Gateway. Links always resolve to the current release.

| Platform | Latest installer |
|---|---|
| Linux x86_64 | https://REPLACE_DEV_REST_URL/downloads/linux-x86_64 |
| Linux arm64 | https://REPLACE_DEV_REST_URL/downloads/linux-aarch64 |
| macOS Intel | https://REPLACE_DEV_REST_URL/downloads/macos-x86_64 |
| macOS Apple Silicon | https://REPLACE_DEV_REST_URL/downloads/macos-aarch64 |
| Windows x86_64 | https://REPLACE_DEV_REST_URL/downloads/windows-x86_64 |

Manifest: https://REPLACE_DEV_REST_URL/updates/manifest.json

Replace `REPLACE_DEV_REST_URL` with the `RestEndpoint` CDK output from `TabbyWebRTCDev` after first deploy.
```

Prod section is out of scope until `TabbyWebRTCProd` is deployed. Add a commented placeholder block only.

---

## `scripts/publish-agent-release.sh`

Manual publish script for local or emergency releases. Mirrors the CI publish job:

```
Usage: ./scripts/publish-agent-release.sh <version> <env>

  version  Semver tag (e.g. 1.2.3)
  env      dev | prod

Requires: aws CLI, R2 credentials in environment (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
          R2_BUCKET, R2_ACCOUNT_ID).

Steps:
  1. Verify packaged installers exist in desktop-agent/packaged/
  2. Compute SHA-256 per artifact
  3. Generate manifest.json
  4. Upload artifacts to s3://{bucket}/{env}/{version}/
  5. Upload manifest to s3://{bucket}/{env}/manifest.json
```

---

## Release Triggers

| Trigger | R2 prefix | GitHub Release | Notes |
|---|---|---|---|
| Push tag `v*` | `prod/` | yes (existing release job) | Production release |
| Push to `main` (desktop-agent paths) | `dev/` | no | Optional dev channel publish |

---

## Dependencies

- `cicd/01-pipeline.md` — existing build matrix and release workflow.
- `backend/05-update-distribution.md` — manifest schema and download endpoint contract.

---

## Acceptance Criteria

1. Tag `v0.2.0` produces 5 native installers uploaded to R2 `prod/{version}/` with a valid `prod/manifest.json`.
2. SHA-256 values in manifest match the uploaded file bytes.
3. Root `README.md` dev links download the correct artifact via `{DEV_REST_URL}/downloads/{platform}`.
4. `scripts/publish-agent-release.sh 0.2.0 dev` succeeds with pre-built artifacts in `desktop-agent/packaged/`.
5. Unknown platform returns 404 via API Gateway (verified after backend/05 deploy).

---

## Out of Scope

- Windows Authenticode signing and macOS notarization (document as blockers; required before prod user-facing release).
- Prod README section until prod stack is live.
- Auto-update client logic (owned by `desktop-agent/05`).
- GitHub Releases as primary distribution (R2 + API Gateway is canonical; GitHub Release may retain raw binaries as secondary).
