import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { deleteConnection, getConnection } from './lib/connections.js';
import { markAgentOffline, notifyAgentSubscribers } from './lib/agents.js';

export async function onDisconnect(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const record = await getConnection(connectionId);

  if (record?.clientType === 'agent' && record.agentId) {
    await markAgentOffline(record.agentId);
    await notifyAgentSubscribers(record.agentId, { type: 'AGENT_OFFLINE' });
  }

  await deleteConnection(connectionId);

  return { statusCode: 200, body: 'Disconnected' };
}
