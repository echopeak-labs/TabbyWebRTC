#!/usr/bin/env bash
set -euo pipefail

show_help() {
  cat <<EOF
Usage: ./scripts/bootstrap-aws.sh

Bootstrap CDK in us-east-1 (once per AWS account).

After bootstrap, create the GitHub Actions deploy role:
  GITHUB_ORG=your-org npm run deploy:iam

Prerequisites:
  AWS CLI v2 with credentials for target account

EOF
}

if [[ "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}

echo "Bootstrapping CDK in account $AWS_ACCOUNT / $AWS_REGION..."
cd "$ROOT/infra" && npx cdk bootstrap "aws://$AWS_ACCOUNT/$AWS_REGION"

echo ""
echo "CDK bootstrap complete."
echo "Next: GITHUB_ORG=your-org npm run deploy:iam"
echo "Then set GitHub secret AWS_DEPLOY_ROLE_ARN to the printed role ARN."
