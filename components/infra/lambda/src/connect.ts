import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { getAgent } from './lib/agents.js';
import { putConnection, updateConnection } from './lib/connections.js';
import { extractBearerToken, verifyAgentJwt } from './lib/jwt.js';
import {
  createPendingSession,
  PENDING_SESSION_EXPIRES_SECONDS,
} from './lib/pending-sessions.js';
import { sendToConnection } from './lib/send-to-connection.js';
import type { ClientType } from './types.js';

function getAuthorizationHeader(
  headers: Record<string, string | undefined> | undefined,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  return headers.Authorization ?? headers.authorization;
}

function getConnectHeaders(
  event: APIGatewayProxyWebsocketEventV2,
): Record<string, string | undefined> | undefined {
  return (event as APIGatewayProxyWebsocketEventV2 & {
    headers?: Record<string, string | undefined>;
  }).headers;
}

export async function onConnect(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const params = event.queryStringParameters ?? {};
  const clientType = (params.clientType ?? 'browser') as ClientType;

  if (clientType !== 'browser' && clientType !== 'agent') {
    return { statusCode: 400, body: 'Invalid clientType' };
  }

  if (clientType === 'agent') {
    const agentToken =
      extractBearerToken(getAuthorizationHeader(getConnectHeaders(event))) ?? params.token;
    if (!agentToken) {
      return { statusCode: 401, body: 'Missing agent token' };
    }

    try {
      const payload = await verifyAgentJwt(agentToken);
      const agentId = payload.sub!;
      const agent = await getAgent(agentId);
      if (!agent?.tokenJti || !payload.jti || agent.tokenJti !== payload.jti) {
        return { statusCode: 401, body: 'Agent token revoked' };
      }
      await putConnection(connectionId, clientType, {
        agentId,
        userId: payload.userId,
      });
      return { statusCode: 200, body: 'Connected' };
    } catch {
      return { statusCode: 401, body: 'Invalid agent token' };
    }
  }

  await putConnection(connectionId, clientType, params);
  const session = await createPendingSession(connectionId);
  await updateConnection(connectionId, { pendingSessionId: session.pendingSessionId });
  await sendToConnection(connectionId, {
    type: 'SESSION_PENDING',
    pendingSessionId: session.pendingSessionId,
    expiresIn: PENDING_SESSION_EXPIRES_SECONDS,
  });

  return { statusCode: 200, body: 'Connected' };
}
