import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getAgent } from '../lib/agents.js';
import { updateConnection } from '../lib/connections.js';
import {
  extractBearerToken,
  issueTabbyWebRTCToken,
  verifyClerkJwt,
  verifyTabbyWebRTCToken,
} from '../lib/jwt.js';
import {
  createPendingSession,
  deletePendingSession,
  getPendingSession,
  peekPendingSession,
  PENDING_SESSION_EXPIRES_SECONDS,
  rotatePendingSession,
} from '../lib/pending-sessions.js';
import { sendToConnection } from '../lib/send-to-connection.js';
import type { BindSessionMessage, ConnectionRecord } from '../types.js';

function jsonResponse(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function requireEncryptedSalt(): boolean {
  return process.env.REQUIRE_ENCRYPTED_SALT === 'true';
}

export async function handleAuthApprove(
  clerkToken: string,
  pendingSessionId: string,
  agentId: string,
  encryptedSalt?: string,
  localEndpoint?: { url: string; localToken: string },
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

  if (requireEncryptedSalt() && (!encryptedSalt || encryptedSalt.length < 16)) {
    return jsonResponse(400, { error: 'encryptedSalt required' });
  }

  await deletePendingSession(pendingSessionId);
  const token = await issueTabbyWebRTCToken(userId, agentId);
  await updateConnection(session.connectionId, {
    token,
    userId,
    agentId,
    ...(encryptedSalt ? { encryptedSalt } : {}),
  });

  const resolvedLocal =
    localEndpoint?.url && localEndpoint.localToken
      ? localEndpoint
      : agent.localEndpoint
        ? { url: agent.localEndpoint, localToken: '' }
        : undefined;

  await sendToConnection(session.connectionId, {
    type: 'AUTH_APPROVED',
    token,
    agentId,
    ...(encryptedSalt ? { encryptedSalt } : {}),
    ...(resolvedLocal?.url
      ? {
          localEndpoint: {
            url: resolvedLocal.url,
            ...(resolvedLocal.localToken ? { localToken: resolvedLocal.localToken } : {}),
          },
        }
      : {}),
  });

  return jsonResponse(200, { ok: true });
}

export async function handleRefreshSession(connection: ConnectionRecord): Promise<void> {
  if (connection.clientType !== 'browser') {
    throw new Error('INVALID_CLIENT');
  }

  const now = Math.floor(Date.now() / 1000);
  if (connection.pendingSessionId) {
    const previous = await peekPendingSession(connection.pendingSessionId);
    if (!previous || previous.expiresAt <= now) {
      await sendToConnection(connection.connectionId, { type: 'SESSION_EXPIRED' });
    }
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

export async function handleBindSession(
  message: BindSessionMessage,
  connection: ConnectionRecord,
): Promise<void> {
  if (connection.clientType !== 'browser') {
    throw new Error('INVALID_CLIENT');
  }
  if (!message.token) {
    throw new Error('UNAUTHORIZED');
  }

  const payload = await verifyTabbyWebRTCToken(message.token);
  await updateConnection(connection.connectionId, {
    token: message.token,
    userId: payload.sub,
    agentId: payload.agentId,
    pendingSessionId: null,
  });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const { ensureSecretsLoaded } = await import('../lib/secrets.js');
  await ensureSecretsLoaded();

  const clerkToken = extractBearerToken(
    event.headers?.Authorization ?? event.headers?.authorization,
  );
  if (!clerkToken) {
    return jsonResponse(401, { error: 'Missing authorization' });
  }

  let body: {
    pendingSessionId?: string;
    agentId?: string;
    encryptedSalt?: string;
    localEndpoint?: { url: string; localToken: string };
  };
  try {
    body = JSON.parse(event.body ?? '{}') as {
      pendingSessionId?: string;
      agentId?: string;
      encryptedSalt?: string;
      localEndpoint?: { url: string; localToken: string };
    };
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (!body.pendingSessionId || !body.agentId) {
    return jsonResponse(400, { error: 'pendingSessionId and agentId are required' });
  }

  try {
    return await handleAuthApprove(
      clerkToken,
      body.pendingSessionId,
      body.agentId,
      body.encryptedSalt,
      body.localEndpoint,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorization failed';
    if (message === 'INVALID_CLERK_JWT') {
      return jsonResponse(401, { error: 'Invalid Clerk token' });
    }
    return jsonResponse(500, { error: message });
  }
};
