import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AgentRecord } from '../types.js';
import { findBrowserConnectionsByAgentId } from './connections.js';
import { docClient } from './dynamodb.js';
import { agentsTable, AGENT_HEARTBEAT_TTL_SECONDS } from './env.js';
import { sendToConnection } from './send-to-connection.js';

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
