import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AttachRolePolicyCommand,
  CreateOpenIDConnectProviderCommand,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  CreateRoleCommand,
  GetOpenIDConnectProviderCommand,
  GetRoleCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListPoliciesCommand,
  NoSuchEntityException,
  UpdateAssumeRolePolicyCommand,
} from '@aws-sdk/client-iam';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { execSync } from 'node:child_process';

const ROLE_NAME = 'TabbyWebRTC_GH_actions';
const OIDC_PROVIDER = 'token.actions.githubusercontent.com';
const AWS_REGION = 'us-east-1';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const iamDir = join(scriptDir, 'iam');

const POLICY_MANIFEST: { name: string; file: string }[] = [
  { name: 'TabbyWebRTC-GH-CloudFormation', file: 'cloudformation-policy.json' },
  { name: 'TabbyWebRTC-GH-S3', file: 's3-policy.json' },
  { name: 'TabbyWebRTC-GH-CloudFront', file: 'cloudfront-policy.json' },
  { name: 'TabbyWebRTC-GH-APIGateway', file: 'apigateway-policy.json' },
  { name: 'TabbyWebRTC-GH-DynamoDB', file: 'dynamodb-policy.json' },
  { name: 'TabbyWebRTC-GH-IAM-Lambda', file: 'iam-lambda-policy.json' },
  { name: 'TabbyWebRTC-GH-Logs', file: 'logs-policy.json' },
];

function loadTrustPolicy(accountId: string): string {
  const githubOrg = process.env.GITHUB_ORG;
  const githubRepo = process.env.GITHUB_REPO ?? 'TabbyWebRTC';
  if (!githubOrg) {
    throw new Error('GITHUB_ORG environment variable is required');
  }

  return readFileSync(join(iamDir, 'trust-policy.json'), 'utf8')
    .replaceAll('ACCOUNT_ID', accountId)
    .replaceAll('GITHUB_ORG', githubOrg)
    .replaceAll('GITHUB_REPO', githubRepo);
}

function loadPolicyDocument(filename: string): string {
  return readFileSync(join(iamDir, filename), 'utf8');
}

function fetchOidcThumbprint(): string {
  const output = execSync(
    `openssl s_client -servername ${OIDC_PROVIDER} -showcerts -connect ${OIDC_PROVIDER}:443 </dev/null 2>/dev/null | openssl x509 -fingerprint -sha1 -noout`,
    { encoding: 'utf8' },
  );
  const match = output.match(/=([0-9A-F:]+)/i);
  if (!match) {
    throw new Error('Failed to extract OIDC provider thumbprint');
  }
  return match[1].replaceAll(':', '').toLowerCase();
}

async function ensureOidcProvider(iam: IAMClient, accountId: string): Promise<void> {
  const oidcArn = `arn:aws:iam::${accountId}:oidc-provider/${OIDC_PROVIDER}`;
  try {
    await iam.send(
      new GetOpenIDConnectProviderCommand({ OpenIDConnectProviderArn: oidcArn }),
    );
    console.log(`OIDC provider already exists: ${oidcArn}`);
  } catch (error) {
    if (!(error instanceof NoSuchEntityException)) {
      throw error;
    }
    const thumbprint = fetchOidcThumbprint();
    await iam.send(
      new CreateOpenIDConnectProviderCommand({
        Url: `https://${OIDC_PROVIDER}`,
        ClientIDList: ['sts.amazonaws.com'],
        ThumbprintList: [thumbprint],
      }),
    );
    console.log('OIDC provider created.');
  }
}

async function findPolicyArnByName(iam: IAMClient, policyName: string): Promise<string | null> {
  let marker: string | undefined;
  do {
    const response = await iam.send(
      new ListPoliciesCommand({
        Scope: 'Local',
        Marker: marker,
      }),
    );
    for (const policy of response.Policies ?? []) {
      if (policy.PolicyName === policyName && policy.Arn) {
        return policy.Arn;
      }
    }
    marker = response.IsTruncated ? response.Marker : undefined;
  } while (marker);
  return null;
}

async function upsertManagedPolicy(
  iam: IAMClient,
  policyName: string,
  document: string,
): Promise<string> {
  const existingArn = await findPolicyArnByName(iam, policyName);
  if (!existingArn) {
    const created = await iam.send(
      new CreatePolicyCommand({
        PolicyName: policyName,
        PolicyDocument: document,
        Description: `GitHub Actions deploy policy for TabbyWebRTC (${policyName})`,
      }),
    );
    if (!created.Policy?.Arn) {
      throw new Error(`Failed to create policy ${policyName}`);
    }
    console.log(`Created managed policy: ${policyName}`);
    return created.Policy.Arn;
  }

  await iam.send(
    new CreatePolicyVersionCommand({
      PolicyArn: existingArn,
      PolicyDocument: document,
      SetAsDefault: true,
    }),
  );
  console.log(`Updated managed policy: ${policyName}`);
  return existingArn;
}

async function attachPolicyIfNeeded(
  iam: IAMClient,
  roleName: string,
  policyArn: string,
): Promise<void> {
  const attached = await iam.send(
    new ListAttachedRolePoliciesCommand({ RoleName: roleName }),
  );
  const alreadyAttached = (attached.AttachedPolicies ?? []).some(
    (policy) => policy.PolicyArn === policyArn,
  );
  if (alreadyAttached) {
    return;
  }
  await iam.send(
    new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: policyArn,
    }),
  );
}

async function main(): Promise<void> {
  const sts = new STSClient({ region: AWS_REGION });
  const iam = new IAMClient({ region: AWS_REGION });

  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;
  if (!accountId) {
    throw new Error('Could not resolve AWS account ID');
  }

  console.log(`AWS Account ID: ${accountId}`);

  await ensureOidcProvider(iam, accountId);

  const trustPolicy = loadTrustPolicy(accountId);
  let roleExists = true;

  try {
    await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
  } catch (error) {
    if (error instanceof NoSuchEntityException) {
      roleExists = false;
    } else {
      throw error;
    }
  }

  if (roleExists) {
    await iam.send(
      new UpdateAssumeRolePolicyCommand({
        RoleName: ROLE_NAME,
        PolicyDocument: trustPolicy,
      }),
    );
    console.log(`Updated trust policy on role ${ROLE_NAME}`);
  } else {
    await iam.send(
      new CreateRoleCommand({
        RoleName: ROLE_NAME,
        AssumeRolePolicyDocument: trustPolicy,
        Description: 'GitHub Actions OIDC role for TabbyWebRTC CDK deployment',
        Tags: [
          { Key: 'Project', Value: 'tabbywebrtc' },
          { Key: 'ManagedBy', Value: 'deploy-iam' },
        ],
      }),
    );
    console.log(`Created role ${ROLE_NAME}`);
  }

  for (const entry of POLICY_MANIFEST) {
    const document = loadPolicyDocument(entry.file);
    if (document.length > 6144) {
      throw new Error(`Policy ${entry.file} exceeds 6144 character managed policy limit`);
    }
    const policyArn = await upsertManagedPolicy(iam, entry.name, document);
    await attachPolicyIfNeeded(iam, ROLE_NAME, policyArn);
  }

  const role = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
  const roleArn = role.Role?.Arn;
  if (!roleArn) {
    throw new Error('Failed to resolve role ARN');
  }

  console.log('');
  console.log('Setup complete.');
  console.log(`Role ARN: ${roleArn}`);
  console.log('');
  console.log('Add this as a GitHub secret:');
  console.log(`  AWS_DEPLOY_ROLE_ARN=${roleArn}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
