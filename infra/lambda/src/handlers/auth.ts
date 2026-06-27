import type { APIGatewayProxyHandler } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async () => ({
  statusCode: 501,
  body: JSON.stringify({ error: 'Not implemented' }),
});
