import {
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { apiMock, ddbMock } from './setup-mocks';

let dispatchMessage: (message: { type: string; [key: string]: unknown }, connectionId: string) => Promise<void>;
let resetManagementClient: () => void;

beforeAll(async () => {
  process.env.CONNECTIONS_TABLE = 'connections';
  process.env.AGENTS_TABLE = 'agents';
  process.env.SOURCE_LOCKS_TABLE = 'source-locks';
  process.env.WS_CALLBACK_URL = 'https://example.execute-api.local';
  process.env.TABBYWEBRTC_JWT_SECRET = 'test-tabbywebrtc-secret';

  const router = await import('../lambda/src/router');
  const sendModule = await import('../lambda/src/lib/send-to-connection');
  const jwt = await import('../lambda/src/lib/jwt');
  dispatchMessage = router.dispatchMessage;
  resetManagementClient = sendModule.resetManagementClient;
  issueTabbyWebRTCToken = jwt.issueTabbyWebRTCToken;
});

let issueTabbyWebRTCToken: (userId: string, agentId: string) => Promise<string>;

beforeEach(() => {
  ddbMock.reset();
  apiMock.reset();
  resetManagementClient();
});

describe('signaling round-trip', () => {
  it('relays SUBSCRIBE to agent and SDP_OFFER to browser', async () => {
    const browserConnectionId = 'browser-conn';
    const agentConnectionId = 'agent-conn';
    const agentId = 'agent-1';
    const sourceId = 'display-1';
    const tabId = 'tab-1';
    const sessionToken = await issueTabbyWebRTCToken('user-1', agentId);

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections' && input.Key?.connectionId === browserConnectionId) {
        return {
          Item: {
            connectionId: browserConnectionId,
            clientType: 'browser',
            agentId,
            userId: 'user-1',
            token: sessionToken,
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      if (input.TableName === 'source-locks') {
        return { Item: undefined };
      }
      return {};
    });

    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({
      Items: [{ connectionId: agentConnectionId, clientType: 'agent', agentId }],
    });

    apiMock.on(PostToConnectionCommand).resolves({});

    await dispatchMessage(
      { type: 'SUBSCRIBE', sourceId, tabId },
      browserConnectionId,
    );

    const notifyCall = apiMock.commandCalls(PostToConnectionCommand)[0];
    expect(notifyCall.args[0].input).toMatchObject({
      ConnectionId: agentConnectionId,
      Data: expect.any(Buffer),
    });
    const notifyPayload = JSON.parse(
      (notifyCall.args[0].input.Data as Buffer).toString(),
    );
    expect(notifyPayload).toEqual({
      type: 'NOTIFY_SUBSCRIBER',
      sourceId,
      tabId,
      browserConnectionId,
    });

    apiMock.reset();
    apiMock.on(PostToConnectionCommand).resolves({});

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections' && input.Key?.connectionId === agentConnectionId) {
        return {
          Item: {
            connectionId: agentConnectionId,
            clientType: 'agent',
            agentId,
            userId: 'user-1',
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      if (input.TableName === 'source-locks') {
        return {
          Item: {
            sourceId,
            tabId,
            connectionId: browserConnectionId,
            agentId,
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    await dispatchMessage(
      {
        type: 'SDP_OFFER',
        sourceId,
        sdp: { type: 'offer', sdp: 'v=0' },
        targetConnectionId: browserConnectionId,
      },
      agentConnectionId,
    );

    const offerCall = apiMock.commandCalls(PostToConnectionCommand)[0];
    const offerPayload = JSON.parse(
      (offerCall.args[0].input.Data as Buffer).toString(),
    );
    expect(offerPayload).toEqual({
      type: 'SDP_OFFER',
      sourceId,
      sdp: { type: 'offer', sdp: 'v=0' },
    });
  });

  it('rejects UNSUBSCRIBE without session token', async () => {
    const browserConnectionId = 'browser-conn';
    const agentId = 'agent-1';

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections') {
        return {
          Item: {
            connectionId: browserConnectionId,
            clientType: 'browser',
            agentId,
            userId: 'user-1',
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    await expect(
      dispatchMessage(
        { type: 'UNSUBSCRIBE', sourceId: 'display-1', tabId: 'tab-1' },
        browserConnectionId,
      ),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects SDP_ANSWER from non-owner connection', async () => {
    const browserConnectionId = 'browser-conn';
    const otherConnectionId = 'other-browser';
    const agentId = 'agent-1';
    const sessionToken = await issueTabbyWebRTCToken('user-1', agentId);

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections') {
        return {
          Item: {
            connectionId: otherConnectionId,
            clientType: 'browser',
            agentId,
            userId: 'user-1',
            token: sessionToken,
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      if (input.TableName === 'source-locks') {
        return {
          Item: {
            sourceId: 'display-1',
            tabId: 'tab-1',
            connectionId: browserConnectionId,
            agentId,
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    await expect(
      dispatchMessage(
        {
          type: 'SDP_ANSWER',
          sourceId: 'display-1',
          sdp: { type: 'answer', sdp: 'v=0' },
        },
        otherConnectionId,
      ),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects agent ICE_CANDIDATE without lock ownership', async () => {
    const agentConnectionId = 'agent-conn';
    const agentId = 'agent-1';

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections') {
        return {
          Item: {
            connectionId: agentConnectionId,
            clientType: 'agent',
            agentId,
            userId: 'user-1',
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      if (input.TableName === 'source-locks') {
        return {
          Item: {
            sourceId: 'display-1',
            tabId: 'tab-1',
            connectionId: 'browser-conn',
            agentId: 'other-agent',
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    await expect(
      dispatchMessage(
        {
          type: 'ICE_CANDIDATE',
          sourceId: 'display-1',
          candidate: { candidate: 'a' },
          targetConnectionId: 'browser-conn',
        },
        agentConnectionId,
      ),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects SDP_OFFER from non-agent connections', async () => {
    const browserConnectionId = 'browser-conn';
    const agentId = 'agent-1';

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections') {
        return {
          Item: {
            connectionId: browserConnectionId,
            clientType: 'browser',
            agentId,
            userId: 'user-1',
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    await expect(
      dispatchMessage(
        {
          type: 'SDP_OFFER',
          sourceId: 'display-1',
          sdp: { type: 'offer', sdp: 'v=0' },
          targetConnectionId: 'other',
        },
        browserConnectionId,
      ),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('rejects AGENT_REGISTER when message agentId mismatches JWT binding', async () => {
    const agentConnectionId = 'agent-conn';

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections') {
        return {
          Item: {
            connectionId: agentConnectionId,
            clientType: 'agent',
            agentId: 'agent-bound',
            userId: 'user-1',
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    await expect(
      dispatchMessage(
        {
          type: 'AGENT_REGISTER',
          agentId: 'agent-other',
          publicKey: 'pk',
          platform: 'linux',
          displays: [],
          apps: [],
        },
        agentConnectionId,
      ),
    ).rejects.toThrow('AGENT_ID_MISMATCH');
  });

  it('returns SOURCE_IN_USE when source is locked by another tab', async () => {
    const browserConnectionId = 'browser-conn';
    const agentId = 'agent-1';
    const sessionToken = await issueTabbyWebRTCToken('user-1', agentId);

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'connections') {
        return {
          Item: {
            connectionId: browserConnectionId,
            clientType: 'browser',
            agentId,
            userId: 'user-1',
            token: sessionToken,
            connectedAt: Date.now(),
            TTL: 9999999999,
          },
        };
      }
      if (input.TableName === 'source-locks') {
        return {
          Item: {
            sourceId: 'display-1',
            tabId: 'other-tab',
            connectionId: 'other-browser',
            agentId,
            TTL: 9999999999,
          },
        };
      }
      return {};
    });

    apiMock.on(PostToConnectionCommand).resolves({});

    await dispatchMessage(
      { type: 'SUBSCRIBE', sourceId: 'display-1', tabId: 'tab-1' },
      browserConnectionId,
    );

    const call = apiMock.commandCalls(PostToConnectionCommand)[0];
    const payload = JSON.parse((call.args[0].input.Data as Buffer).toString());
    expect(payload).toEqual({
      type: 'SOURCE_IN_USE',
      sourceId: 'display-1',
      tabId: 'other-tab',
    });
  });
});
