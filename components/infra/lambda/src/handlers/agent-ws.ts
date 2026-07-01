import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  AgentHeartbeatMessage,
  AgentRegisterMessage,
  ConnectionRecord,
} from '../types.js';
import { touchAgentHeartbeat, upsertAgentRegistration } from '../lib/agents.js';
import { docClient } from '../lib/dynamodb.js';
import { connectionsTable } from '../lib/env.js';

export async function handleAgentRegister(
  message: AgentRegisterMessage,
  connection: ConnectionRecord,
): Promise<void> {
  await upsertAgentRegistration({
    agentId: message.agentId,
    userId: connection.userId,
    connectionId: connection.connectionId,
    publicKey: message.publicKey,
    platform: message.platform,
    displays: message.displays ?? [],
    apps: message.apps ?? [],
    localEndpoint: message.localEndpoint,
  });

  await docClient.send(
    new PutCommand({
      TableName: connectionsTable(),
      Item: {
        ...connection,
        agentId: message.agentId,
      },
    }),
  );
}

export async function handleAgentHeartbeat(
  message: AgentHeartbeatMessage,
  connection: ConnectionRecord,
): Promise<void> {
  await touchAgentHeartbeat(message.agentId, connection.connectionId);
}
