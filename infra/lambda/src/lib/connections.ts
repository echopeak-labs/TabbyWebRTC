import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ConnectionRecord } from '../types.js';
import { docClient } from './dynamodb.js';
import { connectionsTable, CONNECTION_TTL_SECONDS } from './env.js';

export async function getConnection(
  connectionId: string,
): Promise<ConnectionRecord | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: connectionsTable(),
      Key: { connectionId },
    }),
  );
  return result.Item as ConnectionRecord | undefined;
}

export async function putConnection(
  connectionId: string,
  clientType: ConnectionRecord['clientType'],
  queryParams: Record<string, string | undefined>,
): Promise<void> {
  const now = Date.now();
  await docClient.send(
    new PutCommand({
      TableName: connectionsTable(),
      Item: {
        connectionId,
        clientType,
        agentId: queryParams.agentId ?? null,
        userId: queryParams.userId ?? null,
        connectedAt: now,
        TTL: Math.floor(now / 1000) + CONNECTION_TTL_SECONDS,
      },
    }),
  );
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: connectionsTable(),
      Key: { connectionId },
    }),
  );
}

export async function findAgentConnectionId(agentId: string): Promise<string | undefined> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: connectionsTable(),
      IndexName: 'agentId-index',
      KeyConditionExpression: 'agentId = :agentId',
      FilterExpression: 'clientType = :clientType',
      ExpressionAttributeValues: {
        ':agentId': agentId,
        ':clientType': 'agent',
      },
      Limit: 1,
    }),
  );
  const item = result.Items?.[0] as ConnectionRecord | undefined;
  return item?.connectionId;
}

export async function findBrowserConnectionsByAgentId(
  agentId: string,
): Promise<ConnectionRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: connectionsTable(),
      IndexName: 'agentId-index',
      KeyConditionExpression: 'agentId = :agentId',
      FilterExpression: 'clientType = :clientType',
      ExpressionAttributeValues: {
        ':agentId': agentId,
        ':clientType': 'browser',
      },
    }),
  );
  return (result.Items ?? []) as ConnectionRecord[];
}
