import {
  GetObjectCommand,
  NoSuchKey,
  S3Client,
  type S3ServiceException,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

let cachedClient: S3Client | undefined;

export function createR2Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedClient;
}

export function resetR2ClientForTests(): void {
  cachedClient = undefined;
}

export function updateEnvPrefix(): string {
  return process.env.UPDATE_ENV_PREFIX ?? 'dev';
}

export function r2Bucket(): string {
  return process.env.R2_BUCKET ?? '';
}

async function streamToBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isNoSuchKey(error: unknown): boolean {
  if (error instanceof NoSuchKey) {
    return true;
  }
  const serviceError = error as S3ServiceException;
  return serviceError.name === 'NoSuchKey' || serviceError.$metadata?.httpStatusCode === 404;
}

export async function getObjectBytes(key: string): Promise<Buffer | null> {
  const client = createR2Client();
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
      }),
    );
    if (!response.Body) {
      return null;
    }
    return streamToBuffer(response.Body as Readable);
  } catch (error) {
    if (isNoSuchKey(error)) {
      return null;
    }
    throw error;
  }
}

export async function getObjectText(key: string): Promise<string | null> {
  const bytes = await getObjectBytes(key);
  if (!bytes) {
    return null;
  }
  return bytes.toString('utf-8');
}

export function manifestObjectKey(): string {
  return `${updateEnvPrefix()}/manifest.json`;
}

export function artifactObjectKey(version: string, filename: string): string {
  return `${updateEnvPrefix()}/${version}/${filename}`;
}
