import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  extractBearerToken,
  generateTurnCredential,
  verifyTabbyRDPToken,
} from '../lib/jwt.js';

const TURN_CREDENTIAL_TTL_SECONDS = 86400;

function jsonResponse(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const token = extractBearerToken(
    event.headers?.Authorization ?? event.headers?.authorization,
  );
  if (!token) {
    return jsonResponse(401, { error: 'Missing authorization' });
  }

  try {
    await verifyTabbyRDPToken(token);
  } catch {
    return jsonResponse(401, { error: 'Invalid token' });
  }

  const turnSecret = process.env.TURN_SECRET;
  const turnUrls = process.env.TURN_URLS;
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
