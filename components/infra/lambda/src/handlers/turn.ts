import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  extractBearerToken,
  generateTurnCredential,
  verifyAgentJwt,
  verifyTabbyWebRTCToken,
} from '../lib/jwt.js';
import { getSecret } from '../lib/secrets.js';

const TURN_CREDENTIAL_TTL_SECONDS = 86400;

function jsonResponse(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function verifyBrowserOrAgentToken(token: string): Promise<void> {
  try {
    await verifyTabbyWebRTCToken(token);
    return;
  } catch {
  }
  await verifyAgentJwt(token);
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const { ensureSecretsLoaded } = await import('../lib/secrets.js');
  await ensureSecretsLoaded();

  const token = extractBearerToken(
    event.headers?.Authorization ?? event.headers?.authorization,
  );
  if (!token) {
    return jsonResponse(401, { error: 'Missing authorization' });
  }

  try {
    await verifyBrowserOrAgentToken(token);
  } catch {
    return jsonResponse(401, { error: 'Invalid token' });
  }

  const turnSecret = await getSecret('TURN_SECRET');
  const turnUrls = await getSecret('TURN_URLS');
  if (!turnSecret || !turnUrls) {
    return jsonResponse(500, { error: 'TURN not configured' });
  }

  const { username, credential, ttl } = generateTurnCredential(
    turnSecret,
    TURN_CREDENTIAL_TTL_SECONDS,
  );

  return jsonResponse(200, {
    urls: turnUrls.split(',').map((url) => url.trim()).filter(Boolean),
    username,
    credential,
    ttl,
  });
};
