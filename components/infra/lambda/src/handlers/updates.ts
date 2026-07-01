import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  contentTypeForFilename,
  parseManifest,
  resolveArtifact,
} from '../lib/manifest.js';
import {
  artifactObjectKey,
  getObjectBytes,
  getObjectText,
  manifestObjectKey,
} from '../lib/r2.js';

function notFound(): APIGatewayProxyResult {
  return { statusCode: 404, body: 'Not found' };
}

export async function getManifest(): Promise<APIGatewayProxyResult> {
  const text = await getObjectText(manifestObjectKey());
  if (!text) {
    return notFound();
  }

  const manifest = parseManifest(text);
  if (!manifest) {
    return notFound();
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=300',
    },
    body: text,
  };
}

export async function downloadArtifact(platform: string): Promise<APIGatewayProxyResult> {
  const manifestText = await getObjectText(manifestObjectKey());
  if (!manifestText) {
    return notFound();
  }

  const manifest = parseManifest(manifestText);
  if (!manifest) {
    return notFound();
  }

  const artifact = resolveArtifact(manifest, platform);
  if (!artifact) {
    return notFound();
  }

  const objectKey = artifactObjectKey(manifest.version, artifact.filename);
  const bytes = await getObjectBytes(objectKey);
  if (!bytes) {
    return notFound();
  }

  const headers: Record<string, string> = {
    'Content-Type': contentTypeForFilename(artifact.filename),
    'Content-Disposition': `attachment; filename="${artifact.filename}"`,
    'X-TabbyWebRTC-Version': manifest.version,
    'X-TabbyWebRTC-SHA256': artifact.sha256,
  };

  if (artifact.size_bytes > 0) {
    headers['Content-Length'] = String(artifact.size_bytes);
  }

  return {
    statusCode: 200,
    headers,
    body: bytes.toString('base64'),
    isBase64Encoded: true,
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return notFound();
  }

  const path = event.path;

  if (path.endsWith('/updates/manifest.json')) {
    return getManifest();
  }

  const platform = event.pathParameters?.platform;
  if (platform && path.includes('/downloads/')) {
    return downloadArtifact(platform);
  }

  return notFound();
};
