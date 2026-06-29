import * as jose from 'jose';
import {
  issueTabbyRDPToken,
  issueAgentJwt,
  resetJwksCache,
  setJwksForTests,
  verifyTabbyRDPToken,
  verifyAgentJwt,
  generateTurnCredential,
} from '../src/shared/jwt';
import { PendingSessionStore } from '../src/storage/pending-session.store';
import { SignalingHandlerService } from '../src/shared/signaling-handler.service';
import { ConnectionsService } from '../src/shared/connections.service';
import { MessageSenderService } from '../src/shared/message-sender.service';
import { ConnectionStore } from '../src/storage/connection.store';
import { SourceLockStore } from '../src/storage/source-lock.store';

describe('jwt helpers via lambda import', () => {
  beforeAll(() => {
    process.env.TABBYRDP_JWT_SECRET = 'test-tabbyrdp-secret';
    process.env.CLERK_ISSUER = 'https://clerk.test';
    process.env.CLERK_JWKS_URL = 'https://clerk.test/.well-known/jwks.json';
  });

  beforeEach(() => {
    resetJwksCache();
  });

  it('issues and verifies TabbyRDP session tokens', async () => {
    const token = await issueTabbyRDPToken('user-1', 'agent-1');
    const payload = await verifyTabbyRDPToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.agentId).toBe('agent-1');
  });

  it('issues and verifies agent tokens', async () => {
    const token = await issueAgentJwt('agent-1', 'user-1');
    const payload = await verifyAgentJwt(token);
    expect(payload.sub).toBe('agent-1');
    expect(payload.userId).toBe('user-1');
  });

  it('generates TURN credentials', () => {
    const cred = generateTurnCredential('turn-secret', 3600);
    expect(cred.username).toBeDefined();
    expect(cred.credential).toBeDefined();
    expect(cred.ttl).toBe(3600);
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

    const { verifyClerkJwt } = await import('../src/shared/jwt');
    const result = await verifyClerkJwt(clerkToken);
    expect(result.userId).toBe('user-clerk');
  });
});

describe('pending session TTL', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('expires pending sessions after 30 seconds', () => {
    const store = new PendingSessionStore();
    const expired: string[] = [];
    store.setExpiryHandler((connectionId) => {
      expired.push(connectionId);
    });

    const session = store.create('conn-1');
    expect(store.get(session.pendingSessionId)).toBeDefined();

    jest.advanceTimersByTime(30_000);
    expect(store.get(session.pendingSessionId)).toBeUndefined();
    expect(expired).toEqual(['conn-1']);
  });

  it('rotates pending session and clears old timer', () => {
    const store = new PendingSessionStore();
    const first = store.create('conn-1');
    const second = store.rotate(first.pendingSessionId, 'conn-1');

    expect(first.pendingSessionId).not.toBe(second.pendingSessionId);
    expect(store.get(first.pendingSessionId)).toBeUndefined();
    expect(store.get(second.pendingSessionId)).toBeDefined();
  });
});

describe('source lock contention', () => {
  let signaling: SignalingHandlerService;
  let connections: ConnectionsService;
  let messageSender: MessageSenderService;
  const sent: Array<{ connectionId: string; payload: object }> = [];

  beforeEach(async () => {
    sent.length = 0;
    process.env.TABBYRDP_JWT_SECRET = 'test-tabbyrdp-secret';

    const connectionStore = new ConnectionStore();
    const sourceLockStore = new SourceLockStore();
    connections = new ConnectionsService(connectionStore);
    messageSender = new MessageSenderService(connectionStore);
    messageSender.sendToConnection = async (connectionId, payload) => {
      sent.push({ connectionId, payload });
    };
    signaling = new SignalingHandlerService(connections, messageSender, sourceLockStore);

    const token = await issueTabbyRDPToken('user-1', 'agent-1');
    connections.putConnection('browser-1', 'browser', { agentId: 'agent-1', userId: 'user-1' });
    connections.updateConnection('browser-1', { token, agentId: 'agent-1', userId: 'user-1' });
    connections.putConnection('browser-2', 'browser', { agentId: 'agent-1', userId: 'user-1' });
    connections.updateConnection('browser-2', { token, agentId: 'agent-1', userId: 'user-1' });
    connections.putConnection('agent-conn', 'agent', { agentId: 'agent-1', userId: 'user-1' });
  });

  it('returns SOURCE_IN_USE when another tab holds the lock', async () => {
    await signaling.handleSubscribe(
      { type: 'SUBSCRIBE', sourceId: 'display-1', tabId: 'tab-1' },
      connections.getConnection('browser-1')!,
    );

    await signaling.handleSubscribe(
      { type: 'SUBSCRIBE', sourceId: 'display-1', tabId: 'tab-2' },
      connections.getConnection('browser-2')!,
    );

    const inUse = sent.find((s) => (s.payload as { type: string }).type === 'SOURCE_IN_USE');
    expect(inUse).toMatchObject({
      connectionId: 'browser-2',
      payload: { type: 'SOURCE_IN_USE', sourceId: 'display-1', tabId: 'tab-1' },
    });
  });
});
