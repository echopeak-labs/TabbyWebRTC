import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';

export const ddbMock = mockClient(DynamoDBDocumentClient);
export const apiMock = mockClient(ApiGatewayManagementApiClient);
