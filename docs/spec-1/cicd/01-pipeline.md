# CI/CD — Pipeline SDD

## Scope

Defines all GitHub Actions workflows: frontend build + deploy, backend CDK deploy, desktop agent binary builds, and test/lint gates. Covers secrets management, environment promotion, and release strategy.

---

## Repository Structure Assumption

```
/
  frontend/         # React webapp
  infra/            # AWS CDK stack
  desktop-agent/    # Rust binary
  .github/
    workflows/
      frontend.yml
      backend.yml
      desktop-agent.yml
      pr-check.yml
```

---

## Workflow: `pr-check.yml`

Runs on every pull request to `main`. Must pass before merge.

```yaml
name: PR Check
on:
  pull_request:
    branches: [main]

jobs:
  frontend-lint:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build

  backend-lint:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: infra/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npx cdk synth --context env=dev --quiet

  desktop-agent-check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: desktop-agent
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo check
      - run: cargo clippy -- -D warnings
      - run: cargo test
```

---

## Workflow: `frontend.yml`

Deploys frontend to Cloudflare Pages on push to `main`.

```yaml
name: Deploy Frontend
on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run build
        env:
          VITE_WS_URL: ${{ secrets.PROD_WS_URL }}
          VITE_REST_URL: ${{ secrets.PROD_REST_URL }}
          VITE_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=tabbyrdp
          workingDirectory: frontend
```

### Frontend Environment Variables (Vite)

| Variable | Description |
|---|---|
| `VITE_WS_URL` | WebSocket signaling endpoint (`wss://signal.tabbyrdp.com/prod`) |
| `VITE_REST_URL` | REST API base URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk public key |

---

## Workflow: `backend.yml`

Deploys CDK stack to AWS on push to `main`.

```yaml
name: Deploy Backend
on:
  push:
    branches: [main]
    paths:
      - 'infra/**'

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: infra/package-lock.json
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1
      - run: npm ci
      - run: npx cdk deploy TabbyRDPProd --require-approval never --context env=prod
        env:
          CLERK_JWKS_URL: ${{ secrets.CLERK_JWKS_URL }}
          CLERK_ISSUER: ${{ secrets.CLERK_ISSUER }}
          TURN_SECRET: ${{ secrets.TURN_SECRET }}
          TURN_URLS: ${{ secrets.TURN_URLS }}
          TABBYRDP_JWT_SECRET: ${{ secrets.TABBYRDP_JWT_SECRET }}
```

### AWS Authentication

Uses OIDC-based IAM role assumption (no long-lived AWS credentials stored in GitHub).

IAM role trust policy:
```json
{
  "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:sub": "repo:<ORG>/TabbyRDP:ref:refs/heads/main"
    }
  }
}
```

---

## Workflow: `desktop-agent.yml`

Builds release binaries for Linux, macOS, and Windows on push to `main` and on version tags (`v*`).

```yaml
name: Build Desktop Agent
on:
  push:
    branches: [main]
    paths:
      - 'desktop-agent/**'
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact: tabbyrdp-agent-linux-x86_64
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
            artifact: tabbyrdp-agent-linux-aarch64
          - os: macos-latest
            target: x86_64-apple-darwin
            artifact: tabbyrdp-agent-macos-x86_64
          - os: macos-latest
            target: aarch64-apple-darwin
            artifact: tabbyrdp-agent-macos-aarch64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact: tabbyrdp-agent-windows-x86_64.exe

    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: desktop-agent

    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: desktop-agent
      - name: Install cross-compile deps (aarch64 Linux)
        if: matrix.target == 'aarch64-unknown-linux-gnu'
        run: sudo apt-get install -y gcc-aarch64-linux-gnu
      - run: cargo build --release --target ${{ matrix.target }}
      - name: Rename binary
        shell: bash
        run: |
          SRC=target/${{ matrix.target }}/release/tabbyrdp-agent
          [[ "${{ matrix.os }}" == "windows-latest" ]] && SRC="${SRC}.exe"
          cp "$SRC" "${{ matrix.artifact }}"
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: desktop-agent/${{ matrix.artifact }}

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
```

---

## GitHub Secrets Reference

| Secret | Used By | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | frontend.yml | CF Pages deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | frontend.yml | CF account ID |
| `AWS_DEPLOY_ROLE_ARN` | backend.yml | OIDC IAM role for CDK deploy |
| `PROD_WS_URL` | frontend.yml | WSS endpoint URL (CDK output) |
| `PROD_REST_URL` | frontend.yml | REST API URL (CDK output) |
| `CLERK_PUBLISHABLE_KEY` | frontend.yml | Clerk public key |
| `CLERK_JWKS_URL` | backend.yml | Clerk JWKS endpoint |
| `CLERK_ISSUER` | backend.yml | Clerk issuer URL |
| `TURN_SECRET` | backend.yml | HMAC secret for TURN credentials |
| `TURN_URLS` | backend.yml | Comma-separated TURN server URLs |
| `TABBYRDP_JWT_SECRET` | backend.yml | HS256 secret for session JWTs |

---

## Branch Strategy

| Branch | Purpose | Auto-Deploy |
|---|---|---|
| `main` | Production | Yes — all three workflows |
| `dev` | Development | No — PR checks only |
| `feature/*` | Feature work | No — PR checks only |

All merges to `main` require a passing PR check run.
