import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  getAgent,
  listAgentsByUserId,
  pairAgent,
} from '../lib/agents.js';
import {
  extractBearerToken,
  issueAgentJwt,
  verifyClerkJwt,
  verifyTabbyWebRTCToken,
} from '../lib/jwt.js';

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

  await pairAgent({
    agentId: body.agentId,
    userId,
    publicKey: body.publicKey,
    platform: body.platform,
    name: body.name,
  });

  const agentJwt = await issueAgentJwt(body.agentId, userId);
  return jsonResponse(200, { agentJwt });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const path = event.path;

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
