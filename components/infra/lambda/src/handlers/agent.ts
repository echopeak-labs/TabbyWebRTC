import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import * as jose from 'jose';
import {
  consumePairingClaim,
  getAgent,
  listAgentsByUserId,
  pairAgent,
  revokeAgentToken,
} from '../lib/agents.js';
import { findAgentConnectionId, deleteConnection } from '../lib/connections.js';
import {
  extractBearerToken,
  issueAgentJwt,
  verifyClerkJwt,
  verifyTabbyWebRTCToken,
} from '../lib/jwt.js';
import { forceDisconnect } from '../lib/send-to-connection.js';

function jsonResponse(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function handleListAgents(token: string): Promise<APIGatewayProxyResult> {
  const payload = await verifyTabbyWebRTCToken(token);
  const userId = payload.sub!;
  const agents = await listAgentsByUserId(userId);

  return jsonResponse(200, {
    agents: agents.map((agent) => ({
      id: agent.agentId,
      name: agent.name ?? agent.agentId,
      platform: agent.platform,
      online: agent.online,
      lastSeen: new Date(agent.lastSeen).toISOString(),
    })),
  });
}

async function handlePairAgent(
  clerkToken: string,
  body: {
    agentId?: string;
    publicKey?: string;
    platform?: string;
    name?: string;
    pairingNonce?: string;
  },
): Promise<APIGatewayProxyResult> {
  const { userId } = await verifyClerkJwt(clerkToken);

  if (!body.agentId || !body.publicKey || !body.platform || !body.name) {
    return jsonResponse(400, {
      error: 'agentId, publicKey, platform, and name are required',
    });
  }

  const existing = await getAgent(body.agentId);
  if (existing && existing.userId !== userId) {
    return jsonResponse(403, { error: 'Agent already paired to another user' });
  }

  const agentJwt = await issueAgentJwt(body.agentId, userId);
  const decoded = jose.decodeJwt(agentJwt);
  const tokenJti = typeof decoded.jti === 'string' ? decoded.jti : randomUUID();
  const pairingNonce = body.pairingNonce || randomUUID();

  await pairAgent({
    agentId: body.agentId,
    userId,
    publicKey: body.publicKey,
    platform: body.platform,
    name: body.name,
    pairingToken: agentJwt,
    pairingNonce,
    tokenJti,
  });

  return jsonResponse(200, { agentJwt, pairingNonce });
}

async function handlePairClaim(
  agentId: string | undefined,
  nonce: string | undefined,
): Promise<APIGatewayProxyResult> {
  if (!agentId || !nonce) {
    return jsonResponse(400, { error: 'agentId and nonce are required' });
  }

  const agentJwt = await consumePairingClaim(agentId, nonce);
  if (!agentJwt) {
    return jsonResponse(404, { error: 'Pairing claim not found or expired' });
  }

  return jsonResponse(200, { agentJwt });
}

async function handleRevokeAgent(
  clerkToken: string,
  agentId: string,
): Promise<APIGatewayProxyResult> {
  const { userId } = await verifyClerkJwt(clerkToken);
  const agent = await getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    return jsonResponse(403, { error: 'Agent not found or not owned by user' });
  }

  const connectionId = await findAgentConnectionId(agentId);
  await revokeAgentToken(agentId);
  if (connectionId) {
    await forceDisconnect(connectionId);
    await deleteConnection(connectionId);
  }

  return jsonResponse(200, { ok: true, agentId });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const path = event.path;

  if (method === 'GET' && path.endsWith('/agents/pair-claim')) {
    return handlePairClaim(
      event.queryStringParameters?.agentId,
      event.queryStringParameters?.nonce,
    );
  }

  if (method === 'GET' && path.endsWith('/agents')) {
    const token = extractBearerToken(
      event.headers?.Authorization ?? event.headers?.authorization,
    );
    if (!token) {
      return jsonResponse(401, { error: 'Missing authorization' });
    }
    try {
      return await handleListAgents(token);
    } catch {
      return jsonResponse(401, { error: 'Invalid token' });
    }
  }

  const revokeMatch = path.match(/\/agents\/([^/]+)\/revoke$/);
  if (method === 'POST' && revokeMatch) {
    const clerkToken = extractBearerToken(
      event.headers?.Authorization ?? event.headers?.authorization,
    );
    if (!clerkToken) {
      return jsonResponse(401, { error: 'Missing authorization' });
    }
    try {
      return await handleRevokeAgent(clerkToken, decodeURIComponent(revokeMatch[1]!));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Revoke failed';
      if (message === 'INVALID_CLERK_JWT') {
        return jsonResponse(401, { error: 'Invalid Clerk token' });
      }
      return jsonResponse(500, { error: message });
    }
  }

  if (method === 'POST' && path.endsWith('/agents/pair')) {
    const clerkToken = extractBearerToken(
      event.headers?.Authorization ?? event.headers?.authorization,
    );
    if (!clerkToken) {
      return jsonResponse(401, { error: 'Missing authorization' });
    }

    let body: {
      agentId?: string;
      publicKey?: string;
      platform?: string;
      name?: string;
      pairingNonce?: string;
    };
    try {
      body = JSON.parse(event.body ?? '{}') as typeof body;
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }

    try {
      return await handlePairAgent(clerkToken, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pairing failed';
      if (message === 'INVALID_CLERK_JWT') {
        return jsonResponse(401, { error: 'Invalid Clerk token' });
      }
      return jsonResponse(500, { error: message });
    }
  }

  return jsonResponse(404, { error: 'Not found' });
};
