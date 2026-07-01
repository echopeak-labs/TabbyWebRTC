import * as jose from 'jose';
import {
  extractBearerToken,
  generateTurnCredential,
  issueAgentJwt,
  issueTabbyWebRTCToken,
  resetJwksCache,
  setJwksForTests,
  verifyAgentJwt,
  verifyClerkJwt,
  verifyTabbyWebRTCToken,
} from '../lambda/src/lib/jwt';

describe('jwt helpers', () => {
  beforeAll(() => {
    process.env.TABBYWEBRTC_JWT_SECRET = 'test-tabbywebrtc-secret';
    process.env.CLERK_ISSUER = 'https://clerk.test';
  });

  beforeEach(() => {
    resetJwksCache();
  });

  it('extracts bearer tokens', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(extractBearerToken('Basic abc')).toBeUndefined();
  });

  it('issues and verifies TabbyWebRTC session tokens', async () => {
    const token = await issueTabbyWebRTCToken('user-1', 'agent-1');
    const payload = await verifyTabbyWebRTCToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.agentId).toBe('agent-1');
    expect(payload.iss).toBe('tabbywebrtc');
    expect(payload.jti).toBeDefined();
  });

  it('issues and verifies agent tokens', async () => {
    const token = await issueAgentJwt('agent-1', 'user-1');
    const payload = await verifyAgentJwt(token);
    expect(payload.sub).toBe('agent-1');
    expect(payload.userId).toBe('user-1');
    expect(payload.iss).toBe('tabbywebrtc-agent');
  });

  it('rejects invalid TabbyWebRTC tokens', async () => {
    await expect(verifyTabbyWebRTCToken('not-a-jwt')).rejects.toThrow();
  });

  it('verifies Clerk JWTs against a local JWKS', async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
    const jwk = await jose.exportJWK(publicKey);
    setJwksForTests(
      jose.createLocalJWKSet({
        keys: [{ ...jwk, alg: 'RS256', kid: 'test-kid' }],
      }),
    );

    const clerkToken = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setSubject('user-clerk')
      .setIssuer('https://clerk.test')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const result = await verifyClerkJwt(clerkToken);
    expect(result.userId).toBe('user-clerk');
  });

  it('generates TURN REST credentials', () => {
    const { username, credential, ttl } = generateTurnCredential('turn-secret', 86400);
    expect(Number(username)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(ttl).toBe(86400);
  });
});
