import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import * as jose from 'jose';
import WebSocket from 'ws';
import {
  issueAgentJwt,
  resetJwksCache,
  setJwksForTests,
} from '../src/shared/jwt';
import { AppModule } from '../src/app.module';
import { AgentsService } from '../src/shared/agents.service';
import { AuthHandlerService } from '../src/shared/auth-handler.service';
import { ConnectionsService } from '../src/shared/connections.service';

async function createClerkToken(userId: string): Promise<string> {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey);
  setJwksForTests(
    jose.createLocalJWKSet({
      keys: [{ ...jwk, alg: 'RS256', kid: 'integration-kid' }],
    }),
  );

  return new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'integration-kid' })
    .setSubject(userId)
    .setIssuer('https://clerk.test')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

function collectMessages(ws: WebSocket): {
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
} {
  const received: Record<string, unknown>[] = [];
  ws.on('message', (data) => {
    received.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });

  return {
    waitFor(type: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
      const existing = received.find((message) => message.type === type);
      if (existing) {
        return Promise.resolve(existing);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for ${type}`)),
          timeoutMs,
        );

        const check = (data: WebSocket.RawData) => {
          const message = JSON.parse(data.toString()) as Record<string, unknown>;
          if (message.type === type) {
            clearTimeout(timer);
            ws.off('message', check);
            resolve(message);
          }
        };

        ws.on('message', check);
      });
    },
  };
}

describe('auth and signaling integration', () => {
  let app: INestApplication;
  let port: number;
  let clerkToken: string;

  beforeAll(async () => {
    process.env.TABBYWEBRTC_JWT_SECRET = 'test-tabbywebrtc-secret';
    process.env.CLERK_ISSUER = 'https://clerk.test';
    process.env.CLERK_JWKS_URL = 'https://clerk.test/.well-known/jwks.json';
    process.env.TURN_SECRET = 'turn-secret';
    process.env.TURN_URLS = 'turn:localhost:3478';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as { port: number }).port;
    clerkToken = await createClerkToken('user-1');
  });

  afterAll(async () => {
    await app.close();
    resetJwksCache();
  });

  it(
    'browser connect → approve → AUTH_APPROVED → SUBSCRIBE → SDP round-trip',
    async () => {
      const agents = app.get(AgentsService);
      const authHandler = app.get(AuthHandlerService);
      const connections = app.get(ConnectionsService);

      agents.pairAgent({
        agentId: 'agent-1',
        userId: 'user-1',
        publicKey: 'pk',
        platform: 'linux',
        name: 'Test Agent',
        pairingToken: 'pending-agent-jwt',
        pairingNonce: 'test-nonce',
      });

      const browserWs = new WebSocket(`ws://127.0.0.1:${port}?clientType=browser`);
      const browserMessages = collectMessages(browserWs);
      await new Promise<void>((resolve, reject) => {
        browserWs.once('open', () => resolve());
        browserWs.once('error', reject);
      });

      const sessionPending = await browserMessages.waitFor('SESSION_PENDING');
      const pendingSessionId = sessionPending.pendingSessionId as string;

      const approveResult = await authHandler.handleAuthApprove(
        clerkToken,
        pendingSessionId,
        'agent-1',
      );
      expect(approveResult.status).toBe(200);

      await browserMessages.waitFor('AUTH_APPROVED');

      const agentJwt = await issueAgentJwt('agent-1', 'user-1');
      const agentWs = new WebSocket(
        `ws://127.0.0.1:${port}?clientType=agent&agentId=agent-1&token=${agentJwt}`,
      );
      const agentMessages = collectMessages(agentWs);
      await new Promise<void>((resolve, reject) => {
        agentWs.once('open', () => resolve());
        agentWs.once('error', reject);
      });

      browserWs.send(
        JSON.stringify({
          type: 'SUBSCRIBE',
          sourceId: 'display-1',
          tabId: 'tab-1',
        }),
      );

      const notifySubscriber = await agentMessages.waitFor('NOTIFY_SUBSCRIBER');
      const browserConnectionId = notifySubscriber.browserConnectionId as string;
      expect(notifySubscriber).toMatchObject({
        type: 'NOTIFY_SUBSCRIBER',
        sourceId: 'display-1',
        tabId: 'tab-1',
      });
      expect(browserConnectionId).toBeDefined();

      const browserConn = connections.getConnection(browserConnectionId);
      expect(browserConn?.token).toBeDefined();
      expect(browserConn?.agentId).toBe('agent-1');

      const sdpOffer = { type: 'offer', sdp: 'v=0' };
      agentWs.send(
        JSON.stringify({
          type: 'SDP_OFFER',
          sourceId: 'display-1',
          sdp: sdpOffer,
          targetConnectionId: browserConnectionId,
        }),
      );

      const receivedOffer = await browserMessages.waitFor('SDP_OFFER');
      expect(receivedOffer).toMatchObject({
        type: 'SDP_OFFER',
        sourceId: 'display-1',
        sdp: sdpOffer,
      });

      const sdpAnswer = { type: 'answer', sdp: 'v=0' };
      browserWs.send(
        JSON.stringify({
          type: 'SDP_ANSWER',
          sourceId: 'display-1',
          sdp: sdpAnswer,
        }),
      );

      const receivedAnswer = await agentMessages.waitFor('SDP_ANSWER');
      expect(receivedAnswer).toMatchObject({
        type: 'SDP_ANSWER',
        tabId: 'tab-1',
        sdp: sdpAnswer,
      });

      browserWs.close();
      agentWs.close();
    },
    30000,
  );
});
