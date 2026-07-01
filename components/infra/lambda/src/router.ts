import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { onConnect } from './connect.js';
import { onDisconnect } from './disconnect.js';
import { getConnection } from './lib/connections.js';
import { handleAgentHeartbeat, handleAgentRegister } from './handlers/agent-ws.js';
import { handleRefreshSession } from './handlers/auth.js';
import {
  handleIceCandidate,
  handleSdpAnswer,
  handleSdpOffer,
  handleSubscribe,
  handleUnsubscribe,
} from './handlers/signal.js';
import type {
  AgentHeartbeatMessage,
  AgentRegisterMessage,
  IceCandidateMessage,
  InboundMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from './types.js';

export type MessageHandler = (
  message: InboundMessage,
  connectionId: string,
) => Promise<void>;

const MESSAGE_HANDLERS: Record<string, MessageHandler> = {
  AGENT_REGISTER: async (message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleAgentRegister(message as unknown as AgentRegisterMessage, connection);
  },
  AGENT_HEARTBEAT: async (message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleAgentHeartbeat(message as unknown as AgentHeartbeatMessage, connection);
  },
  SUBSCRIBE: async (message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleSubscribe(message as unknown as SubscribeMessage, connection);
  },
  UNSUBSCRIBE: async (message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleUnsubscribe(message as unknown as UnsubscribeMessage, connection);
  },
  SDP_OFFER: async (message) => {
    await handleSdpOffer(message as unknown as SdpOfferMessage);
  },
  SDP_ANSWER: async (message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleSdpAnswer(message as unknown as SdpAnswerMessage, connection);
  },
  ICE_CANDIDATE: async (message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleIceCandidate(message as unknown as IceCandidateMessage, connection);
  },
  REFRESH_SESSION: async (_message, connectionId) => {
    const connection = await getConnection(connectionId);
    if (!connection) {
      throw new Error('CONNECTION_NOT_FOUND');
    }
    await handleRefreshSession(connection);
  },
};

export function getHandlerForMessageType(type: string): MessageHandler | undefined {
  return MESSAGE_HANDLERS[type];
}

export async function dispatchMessage(
  message: InboundMessage,
  connectionId: string,
): Promise<void> {
  const handler = getHandlerForMessageType(message.type);
  if (!handler) {
    throw new Error(`UNKNOWN_MESSAGE_TYPE:${message.type}`);
  }
  await handler(message, connectionId);
}

export async function onDefault(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const body = event.body;

  if (!body) {
    return { statusCode: 400, body: 'Empty message' };
  }

  let message: InboundMessage;
  try {
    message = JSON.parse(body) as InboundMessage;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!message.type) {
    return { statusCode: 400, body: 'Missing type' };
  }

  try {
    await dispatchMessage(message, connectionId);
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Handler failed';
    return { statusCode: 500, body: messageText };
  }
}

export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const routeKey = event.requestContext.routeKey;

  switch (routeKey) {
    case '$connect':
      return onConnect(event);
    case '$disconnect':
      return onDisconnect(event);
    default:
      return onDefault(event);
  }
};
