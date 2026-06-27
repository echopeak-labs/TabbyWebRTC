#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/bootstrap-aws.sh

Bootstrap CDK and create GitHub OIDC deploy role (once per AWS account).

Prerequisites:
  AWS CLI v2 with credentials for target account
  GITHUB_ORG environment variable (GITHUB_REPO defaults to TabbyRDP)

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}
GITHUB_ORG=${GITHUB_ORG:?Must set GITHUB_ORG}
GITHUB_REPO=${GITHUB_REPO:-TabbyRDP}

echo "Bootstrapping CDK in account $AWS_ACCOUNT / $AWS_REGION..."
cd "$ROOT/infra" && npx cdk bootstrap "aws://$AWS_ACCOUNT/$AWS_REGION"

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
