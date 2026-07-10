import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AgentRecord } from '../types.js';
import { findBrowserConnectionsByAgentId } from './connections.js';
import { docClient } from './dynamodb.js';
import { agentsTable, AGENT_HEARTBEAT_TTL_SECONDS } from './env.js';
import { sendToConnection } from './send-to-connection.js';

export async function getAgent(agentId: string): Promise<AgentRecord | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: agentsTable(),
      Key: { agentId },
    }),
  );
  return result.Item as AgentRecord | undefined;
}

export async function listAgentsByUserId(userId: string): Promise<AgentRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: agentsTable(),
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    }),
  );
  return (result.Items ?? []) as AgentRecord[];
}

export async function pairAgent(input: {
  agentId: string;
  userId: string;
  publicKey: string;
  platform: string;
  name: string;
  pairingToken: string;
  pairingNonce: string;
}): Promise<AgentRecord> {
  const now = Date.now();
  const item: AgentRecord = {
    agentId: input.agentId,
    userId: input.userId,
    name: input.name,
    connectionId: '',
    publicKey: input.publicKey,
    platform: input.platform,
    displays: [],
    apps: [],
    online: false,
    lastSeen: now,
    pairingToken: input.pairingToken,
    pairingNonce: input.pairingNonce,
    pairingExpiresAt: Math.floor(now / 1000) + 600,
  };
  await docClient.send(
    new PutCommand({
      TableName: agentsTable(),
      Item: item,
    }),
  );
  return item;
}

export async function consumePairingClaim(
  agentId: string,
  nonce: string,
): Promise<string | undefined> {
  const agent = await getAgent(agentId);
  if (!agent?.pairingToken || !agent.pairingNonce || !agent.pairingExpiresAt) {
    return undefined;
  }
  if (agent.pairingNonce !== nonce) {
    return undefined;
  }
  if (agent.pairingExpiresAt <= Math.floor(Date.now() / 1000)) {
    return undefined;
  }

  const token = agent.pairingToken;
  await docClient.send(
    new UpdateCommand({
      TableName: agentsTable(),
      Key: { agentId },
      UpdateExpression: 'REMOVE pairingToken, pairingNonce, pairingExpiresAt',
    }),
  );
  return token;
}

export async function markAgentOffline(agentId: string): Promise<void> {
  const now = Date.now();
  await docClient.send(
    new UpdateCommand({
      TableName: agentsTable(),
      Key: { agentId },
      UpdateExpression: 'SET online = :online, lastSeen = :lastSeen',
      ExpressionAttributeValues: {
        ':online': false,
        ':lastSeen': now,
      },
    }),
  );
}

export async function notifyAgentSubscribers(
  agentId: string,
  payload: object,
): Promise<void> {
  const browsers = await findBrowserConnectionsByAgentId(agentId);
  await Promise.all(
    browsers.map((browser) => sendToConnection(browser.connectionId, payload)),
  );
}

export async function upsertAgentRegistration(
  agent: Omit<AgentRecord, 'online' | 'lastSeen' | 'TTL'>,
): Promise<void> {
  const now = Date.now();
  const item: AgentRecord = {
    ...agent,
    online: true,
    lastSeen: now,
    TTL: Math.floor(now / 1000) + AGENT_HEARTBEAT_TTL_SECONDS,
  };
  await docClient.send(
    new PutCommand({
      TableName: agentsTable(),
      Item: item,
    }),
  );
}

export async function touchAgentHeartbeat(agentId: string, connectionId: string): Promise<void> {
  const now = Date.now();
  await docClient.send(
    new UpdateCommand({
      TableName: agentsTable(),
      Key: { agentId },
      UpdateExpression:
        'SET lastSeen = :lastSeen, online = :online, connectionId = :connectionId, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#ttl': 'TTL',
      },
      ExpressionAttributeValues: {
        ':lastSeen': now,
        ':online': true,
        ':connectionId': connectionId,
        ':ttl': Math.floor(now / 1000) + AGENT_HEARTBEAT_TTL_SECONDS,
      },
    }),
  );
}
