import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getAgent } from '../lib/agents.js';
import { updateConnection } from '../lib/connections.js';
import {
  extractBearerToken,
  issueTabbyRDPToken,
  verifyClerkJwt,
} from '../lib/jwt.js';
import {
  createPendingSession,
  deletePendingSession,
  getPendingSession,
  PENDING_SESSION_EXPIRES_SECONDS,
  rotatePendingSession,
} from '../lib/pending-sessions.js';
import { sendToConnection } from '../lib/send-to-connection.js';
import type { ConnectionRecord } from '../types.js';

function jsonResponse(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function handleAuthApprove(
  clerkToken: string,
  pendingSessionId: string,
  agentId: string,
): Promise<APIGatewayProxyResult> {
  const { userId } = await verifyClerkJwt(clerkToken);
  const session = await getPendingSession(pendingSessionId);
  if (!session) {
    return jsonResponse(404, { error: 'Session not found or expired' });
  }

  const agent = await getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    return jsonResponse(403, { error: 'Agent not found or not owned by user' });
  }

  await deletePendingSession(pendingSessionId);
  const token = await issueTabbyRDPToken(userId, agentId);
  await updateConnection(session.connectionId, {
    token,
    userId,
    agentId,
  });

  await sendToConnection(session.connectionId, {
    type: 'AUTH_APPROVED',
    token,
    agentId,
  });

  return jsonResponse(200, { ok: true });
}

export async function handleRefreshSession(connection: ConnectionRecord): Promise<void> {
  if (connection.clientType !== 'browser') {
    throw new Error('INVALID_CLIENT');
  }

  const session = connection.pendingSessionId
    ? await rotatePendingSession(connection.pendingSessionId, connection.connectionId)
    : await createPendingSession(connection.connectionId);

  await updateConnection(connection.connectionId, {
    pendingSessionId: session.pendingSessionId,
  });

  await sendToConnection(connection.connectionId, {
    type: 'SESSION_PENDING',
    pendingSessionId: session.pendingSessionId,
    expiresIn: PENDING_SESSION_EXPIRES_SECONDS,
  });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const clerkToken = extractBearerToken(
    event.headers?.Authorization ?? event.headers?.authorization,
  );
  if (!clerkToken) {
    return jsonResponse(401, { error: 'Missing authorization' });
  }

  let body: { pendingSessionId?: string; agentId?: string };
  try {
    body = JSON.parse(event.body ?? '{}') as { pendingSessionId?: string; agentId?: string };
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (!body.pendingSessionId || !body.agentId) {
    return jsonResponse(400, { error: 'pendingSessionId and agentId are required' });
  }

  try {
    return await handleAuthApprove(clerkToken, body.pendingSessionId, body.agentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorization failed';
    if (message === 'INVALID_CLERK_JWT') {
      return jsonResponse(401, { error: 'Invalid Clerk token' });
    }
    return jsonResponse(500, { error: message });
  }
};
