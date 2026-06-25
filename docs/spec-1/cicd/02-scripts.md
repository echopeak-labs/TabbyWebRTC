# CI/CD — Scripts SDD

## Scope

Defines all developer and CI utility scripts: local development setup, environment bootstrapping, CDK synth/deploy helpers, TURN server provisioning, and release tooling.

---

## Script Inventory

All scripts live in `scripts/` at the repository root.

```
scripts/
  setup-dev.sh          # One-time local dev environment setup
  dev-backend.sh        # Start local Lambda simulation (SAM local)
  dev-frontend.sh       # Start Vite dev server with correct env vars
  deploy-dev.sh         # Deploy to dev AWS environment
  deploy-prod.sh        # Deploy to prod AWS environment (requires confirmation)
  bootstrap-aws.sh      # CDK bootstrap + OIDC setup (run once per AWS account)
  provision-turn.sh     # SSH-based CoTURN provisioning on Hetzner VPS
  rotate-secrets.sh     # Rotate TABBYRDP_JWT_SECRET and update GitHub Secrets
  release.sh            # Tag a new version and trigger release workflow
  check-costs.sh        # Query AWS Cost Explorer for current month spend
```

---

## `setup-dev.sh`

One-time setup for a new developer machine.

```bash
#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null || { echo "Node.js 22+ required"; exit 1; }
command -v cargo >/dev/null || { echo "Rust stable toolchain required"; exit 1; }
command -v aws >/dev/null || { echo "AWS CLI v2 required"; exit 1; }

echo "Installing frontend deps..."
npm ci --prefix frontend

echo "Installing infra deps..."
npm ci --prefix infra

echo "Building desktop agent (debug)..."
cargo build --manifest-path desktop-agent/Cargo.toml

echo "Copying env templates..."
cp frontend/.env.example frontend/.env.local
cp infra/.env.example infra/.env

echo "Setup complete. Edit frontend/.env.local and infra/.env before running dev servers."
```

---

## `dev-backend.sh`

Starts a local WebSocket signaling server using AWS SAM CLI for Lambda hot-reload.

```bash
#!/usr/bin/env bash
set -euo pipefail

cd infra
npm run build

sam local start-api \
  --template-file .aws-sam/build/template.yaml \
  --port 3001 \
  --env-vars env.local.json \
  --warm-containers LAZY
```

`env.local.json` format:
```json
{
  "WsHandler": {
    "CONNECTIONS_TABLE": "tabbyrdp-connections-dev",
    "PENDING_SESSIONS_TABLE": "tabbyrdp-pending-sessions-dev",
    "AGENTS_TABLE": "tabbyrdp-agents-dev",
    "SOURCE_LOCKS_TABLE": "tabbyrdp-source-locks-dev",
    "CLERK_JWKS_URL": "https://...",
    "TABBYRDP_JWT_SECRET": "dev-secret-change-in-prod",
    "TURN_SECRET": "dev-turn-secret",
    "TURN_URLS": "turn:localhost:3478",
    "WS_CALLBACK_URL": "http://localhost:3001"
  }
}
```

---

## `dev-frontend.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

cd frontend
VITE_WS_URL="ws://localhost:3001" \
VITE_REST_URL="http://localhost:3001" \
VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY}" \
npx vite --port 5173
```

---

## `bootstrap-aws.sh`

Run once per AWS account/region. Creates CDK bootstrap stack and OIDC identity provider for GitHub Actions.

```bash
#!/usr/bin/env bash
set -euo pipefail

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}
GITHUB_ORG=${GITHUB_ORG:?Must set GITHUB_ORG}
GITHUB_REPO=${GITHUB_REPO:-TabbyRDP}

echo "Bootstrapping CDK in account $AWS_ACCOUNT / $AWS_REGION..."
cd infra && npx cdk bootstrap "aws://$AWS_ACCOUNT/$AWS_REGION"

echo "Creating GitHub OIDC provider..."
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  2>/dev/null || echo "OIDC provider already exists"

echo "Creating deploy IAM role..."
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${AWS_ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/main",
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      }
    }
  }]
}
EOF
)

ROLE_ARN=$(aws iam create-role \
  --role-name TabbyRDPGitHubDeployRole \
  --assume-role-policy-document "$TRUST_POLICY" \
  --query Role.Arn --output text 2>/dev/null || \
  aws iam get-role --role-name TabbyRDPGitHubDeployRole --query Role.Arn --output text)

aws iam attach-role-policy \
  --role-name TabbyRDPGitHubDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

echo "Deploy role ARN: $ROLE_ARN"
echo "Add this to GitHub Secrets as AWS_DEPLOY_ROLE_ARN"
```

---

## `provision-turn.sh`

Provisions CoTURN on a fresh Hetzner CX22 (Ubuntu 24.04). Requires `TARGET_IP` and `TURN_SECRET` env vars.

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET_IP=${TARGET_IP:?Must set TARGET_IP}
TURN_SECRET=${TURN_SECRET:?Must set TURN_SECRET}
TURN_DOMAIN=${TURN_DOMAIN:-turn.tabbyrdp.com}

ssh root@"$TARGET_IP" bash -s << REMOTE
set -euo pipefail
apt-get update -qq
apt-get install -y coturn certbot

cat > /etc/turnserver.conf << CONF
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_DOMAIN}
total-quota=200
max-bps=1000000
log-file=/var/log/coturn/turnserver.log
no-stdout-log
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
CONF

systemctl enable coturn
systemctl restart coturn
echo "CoTURN provisioned successfully"
REMOTE
```

---

## `release.sh`

Tags a new semantic version and pushes to trigger the GitHub release workflow.

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION=${1:?Usage: ./scripts/release.sh <version> e.g. v1.0.0}

git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

echo "Release tag $VERSION pushed. Monitor the 'Build Desktop Agent' workflow for binaries."
```

---

## `check-costs.sh`

Queries AWS Cost Explorer for current month spend across all TabbyRDP resources.

```bash
#!/usr/bin/env bash
set -euo pipefail

START=$(date -d "$(date +%Y-%m-01)" +%Y-%m-%d 2>/dev/null || date -v1d +%Y-%m-%d)
END=$(date +%Y-%m-%d)

aws ce get-cost-and-usage \
  --time-period "Start=$START,End=$END" \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --filter '{"Tags":{"Key":"project","Values":["tabbyrdp"]}}' \
  --query 'ResultsByTime[0].Total.UnblendedCost' \
  --output table
```

All CDK resources should be tagged with `{ project: 'tabbyrdp' }` in the CDK stack:
```ts
Tags.of(this).add('project', 'tabbyrdp')
```
