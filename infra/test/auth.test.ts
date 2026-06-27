import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import * as jose from 'jose';
import type { APIGatewayProxyResult } from 'aws-lambda';
import type { ConnectionRecord } from '../lambda/src/types';
import { apiMock, ddbMock } from './setup-mocks';

let handleAuthApprove: (
  clerkToken: string,
  pendingSessionId: string,
  agentId: string,
) => Promise<{ statusCode: number; body: string }>;
let handleRefreshSession: (connection: ConnectionRecord) => Promise<void>;
let issueTabbyRDPToken: (userId: string, agentId: string) => Promise<string>;
let setJwksForTests: (jwks: ReturnType<typeof jose.createLocalJWKSet>) => void;

beforeAll(async () => {
  process.env.PENDING_SESSIONS_TABLE = 'pending-sessions';
  process.env.AGENTS_TABLE = 'agents';
  process.env.CONNECTIONS_TABLE = 'connections';
  process.env.WS_CALLBACK_URL = 'https://example.execute-api.local';
  process.env.TABBYRDP_JWT_SECRET = 'test-tabbyrdp-secret';
  process.env.CLERK_ISSUER = 'https://clerk.test';

  const auth = await import('../lambda/src/handlers/auth');
  const jwt = await import('../lambda/src/lib/jwt');
  handleAuthApprove = async (clerkToken, pendingSessionId, agentId) => {
    const result = await auth.handleAuthApprove(clerkToken, pendingSessionId, agentId);
    return { statusCode: result.statusCode, body: result.body ?? '' };
  };
  handleRefreshSession = auth.handleRefreshSession;
  issueTabbyRDPToken = jwt.issueTabbyRDPToken;
  setJwksForTests = jwt.setJwksForTests;
});

beforeEach(() => {
  ddbMock.reset();
  apiMock.reset();
});

async function signClerkToken(userId: string): Promise<string> {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey);
  setJwksForTests(
    jose.createLocalJWKSet({
      keys: [{ ...jwk, alg: 'RS256', kid: 'test-kid' }],
    }),
  );
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setSubject(userId)
    .setIssuer('https://clerk.test')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('auth flow', () => {
  it('approves a pending session and notifies the browser', async () => {
    const clerkToken = await signClerkToken('user-1');
    const pendingSessionId = 'pending-1';
    const browserConnectionId = 'browser-conn';
    const agentId = 'agent-1';

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'pending-sessions') {
        return {
          Item: {
            pendingSessionId,
            connectionId: browserConnectionId,
            expiresAt: Math.floor(Date.now() / 1000) + 30,
            status: 'PENDING',
          },
        };
      }
      if (input.TableName === 'agents') {
        return {
          Item: {
            agentId,
            userId: 'user-1',
            connectionId: '',
            publicKey: 'pk',
            platform: 'linux',
            displays: [],
            apps: [],
            online: false,
            lastSeen: Date.now(),
          },
        };
      }
      return {};
    });

    ddbMock.on(PutCommand).resolves({});
    apiMock.on(PostToConnectionCommand).resolves({});

    const result = await handleAuthApprove(clerkToken, pendingSessionId, agentId);
    expect(result.statusCode).toBe(200);

    const notifyCall = apiMock.commandCalls(PostToConnectionCommand)[0];
    const payload = JSON.parse((notifyCall.args[0].input.Data as Buffer).toString());
    expect(payload.type).toBe('AUTH_APPROVED');
    expect(payload.agentId).toBe(agentId);
    expect(payload.token).toBeDefined();
  });

  it('rotates pending sessions on refresh', async () => {
    ddbMock.on(PutCommand).resolves({});
    apiMock.on(PostToConnectionCommand).resolves({});

    await handleRefreshSession({
      connectionId: 'browser-conn',
      clientType: 'browser',
      pendingSessionId: 'old-pending',
      connectedAt: Date.now(),
      TTL: 9999999999,
    } satisfies ConnectionRecord);

    const notifyCall = apiMock.commandCalls(PostToConnectionCommand)[0];
    const payload = JSON.parse((notifyCall.args[0].input.Data as Buffer).toString());
    expect(payload.type).toBe('SESSION_PENDING');
    expect(payload.pendingSessionId).not.toBe('old-pending');
    expect(payload.expiresIn).toBe(30);
  });
});

describe('turn credentials handler', () => {
  it('returns HMAC credentials for valid session tokens', async () => {
    process.env.TURN_SECRET = 'turn-secret';
    process.env.TURN_URLS = 'turn:example.com:3478,turns:example.com:5349';

    const { handler } = await import('../lambda/src/handlers/turn');
    const token = await issueTabbyRDPToken('user-1', 'agent-1');

    const result = (await handler(
      {
        httpMethod: 'GET',
        path: '/turn-credentials',
        headers: { Authorization: `Bearer ${token}` },
      } as never,
      {} as never,
      {} as never,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.urls).toEqual(['turn:example.com:3478', 'turns:example.com:5349']);
    expect(body.username).toBeDefined();
    expect(body.credential).toBeDefined();
    expect(body.ttl).toBe(86400);
  });
});

describe('agent REST handlers', () => {
  it('lists agents for the authenticated user', async () => {
    const { handler } = await import('../lambda/src/handlers/agent');
    const token = await issueTabbyRDPToken('user-1', 'agent-1');

    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          agentId: 'agent-1',
          userId: 'user-1',
          name: 'Home Desktop',
          connectionId: 'conn-1',
          publicKey: 'pk',
          platform: 'linux',
          displays: [],
          apps: [],
          online: true,
          lastSeen: 1_700_000_000_000,
        },
      ],
    });

    const result = (await handler(
      {
        httpMethod: 'GET',
        path: '/agents',
        headers: { Authorization: `Bearer ${token}` },
      } as never,
      {} as never,
      {} as never,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({
      id: 'agent-1',
      name: 'Home Desktop',
      platform: 'linux',
      online: true,
    });
  });
});
