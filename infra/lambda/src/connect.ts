import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { putConnection } from './lib/connections.js';
import type { ClientType } from './types.js';

export async function onConnect(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const params = event.queryStringParameters ?? {};
  const clientType = (params.clientType ?? 'browser') as ClientType;

  if (clientType !== 'browser' && clientType !== 'agent') {
    return { statusCode: 400, body: 'Invalid clientType' };
  }

  await putConnection(connectionId, clientType, params);

  return { statusCode: 200, body: 'Connected' };
}
