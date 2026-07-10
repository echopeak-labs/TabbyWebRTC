import { createHmac, randomUUID } from 'node:crypto';
import * as jose from 'jose';

export interface TabbyWebRTCTokenPayload extends jose.JWTPayload {
  agentId: string;
  jti?: string;
}

export interface AgentTokenPayload extends jose.JWTPayload {
  userId: string;
  jti?: string;
}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!jwks) {
    const jwksUrl = process.env.CLERK_JWKS_URL?.trim();
    if (!jwksUrl) {
      throw new Error('CLERK_JWKS_URL is not configured');
    }
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

function tabbywebrtcSecret(): Uint8Array {
  return new TextEncoder().encode(process.env.TABBYWEBRTC_JWT_SECRET!);
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice(7);
}

export async function verifyClerkJwt(token: string): Promise<{ userId: string }> {
  const { payload } = await jose.jwtVerify(token, getJwks(), {
    issuer: process.env.CLERK_ISSUER,
  });
  if (!payload.sub) {
    throw new Error('INVALID_CLERK_JWT');
  }
  return { userId: payload.sub };
}

export async function verifyTabbyWebRTCToken(token: string): Promise<TabbyWebRTCTokenPayload> {
  const { payload } = await jose.jwtVerify(token, tabbywebrtcSecret(), {
    issuer: 'tabbywebrtc',
  });
  if (!payload.sub || typeof payload.agentId !== 'string') {
    throw new Error('INVALID_TABBYWEBRTC_TOKEN');
  }
  return payload as TabbyWebRTCTokenPayload;
}

export async function verifyAgentJwt(token: string): Promise<AgentTokenPayload> {
  const { payload } = await jose.jwtVerify(token, tabbywebrtcSecret(), {
    issuer: 'tabbywebrtc-agent',
  });
  if (!payload.sub || typeof payload.userId !== 'string') {
    throw new Error('INVALID_AGENT_TOKEN');
  }
  return payload as AgentTokenPayload;
}

export async function issueTabbyWebRTCToken(userId: string, agentId: string): Promise<string> {
  return new jose.SignJWT({ agentId, jti: randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('tabbywebrtc')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(tabbywebrtcSecret());
}

export async function issueAgentJwt(agentId: string, userId: string): Promise<string> {
  return new jose.SignJWT({ userId, jti: randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(agentId)
    .setIssuer('tabbywebrtc-agent')
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(tabbywebrtcSecret());
}

export function generateTurnCredential(
  turnSecret: string,
  ttlSeconds: number,
): { username: string; credential: string; ttl: number } {
  const username = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const credential = createHmac('sha1', turnSecret)
    .update(username)
    .digest('base64');
  return { username, credential, ttl: ttlSeconds };
}

export function resetJwksCache(): void {
  jwks = undefined;
}

export function setJwksForTests(
  localJwks: ReturnType<typeof jose.createLocalJWKSet>,
): void {
  jwks = localJwks as ReturnType<typeof jose.createRemoteJWKSet>;
}
