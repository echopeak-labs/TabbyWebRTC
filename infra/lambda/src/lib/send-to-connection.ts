import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamodb.js';
import { connectionsTable, wsCallbackUrl } from './env.js';

let managementClient: ApiGatewayManagementApiClient | undefined;

function getManagementClient(): ApiGatewayManagementApiClient {
  if (!managementClient) {
    managementClient = new ApiGatewayManagementApiClient({
      endpoint: wsCallbackUrl(),
    });
  }
  return managementClient;
}

export async function sendToConnection(
  connectionId: string,
  payload: object,
): Promise<void> {
  const client = getManagementClient();
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      }),
    );
  } catch (error) {
    if (error instanceof GoneException || (error as { name?: string }).name === 'GoneException') {
      await docClient.send(
        new DeleteCommand({
          TableName: connectionsTable(),
          Key: { connectionId },
        }),
      );
      return;
    }
    throw error;
  }
}

export function resetManagementClient(): void {
  managementClient = undefined;
}
