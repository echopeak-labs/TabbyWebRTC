import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const SECRET_KEYS = [
  'TABBYWEBRTC_JWT_SECRET',
  'TURN_SECRET',
  'TURN_URLS',
  'CLERK_JWKS_URL',
  'CLERK_ISSUER',
  'R2_BUCKET',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

let loaded = false;
let loadPromise: Promise<void> | null = null;

export async function ensureSecretsLoaded(): Promise<void> {
  if (loaded) {
    return;
  }
  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    const arn = process.env.APP_SECRET_ARN;
    if (!arn) {
      loaded = true;
      return;
    }

    const client = new SecretsManagerClient({});
    const result = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    if (result.SecretString) {
      const parsed = JSON.parse(result.SecretString) as Record<string, string>;
      for (const key of SECRET_KEYS) {
        if (typeof parsed[key] === 'string' && parsed[key].length > 0) {
          process.env[key] = parsed[key];
        }
      }
    }
    loaded = true;
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  await ensureSecretsLoaded();
  return process.env[key];
}

export function resetSecretsCache(): void {
  loaded = false;
  loadPromise = null;
}
