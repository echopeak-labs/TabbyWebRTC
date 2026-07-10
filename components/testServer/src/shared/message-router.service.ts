import { Injectable } from '@nestjs/common';
import type {
  AgentHeartbeatMessage,
  AgentRegisterMessage,
  IceCandidateMessage,
  InboundMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from './types';
import { AgentWsHandlerService } from './agent-ws-handler.service';
import { AuthHandlerService } from './auth-handler.service';
import { ConnectionsService } from './connections.service';
import { SignalingHandlerService } from './signaling-handler.service';

export type MessageHandler = (
  message: InboundMessage,
  connectionId: string,
) => Promise<void>;

@Injectable()
export class MessageRouterService {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly authHandler: AuthHandlerService,
    private readonly agentWsHandler: AgentWsHandlerService,
    private readonly signalingHandler: SignalingHandlerService,
  ) {}

  async dispatchMessage(message: InboundMessage, connectionId: string): Promise<void> {
    const handler = this.getHandlerForMessageType(message.type);
    if (!handler) {
      throw new Error(`UNKNOWN_MESSAGE_TYPE:${message.type}`);
    }
    await handler(message, connectionId);
  }

  getHandlerForMessageType(type: string): MessageHandler | undefined {
    const handlers: Record<string, MessageHandler> = {
      AGENT_REGISTER: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.agentWsHandler.handleAgentRegister(
          msg as unknown as AgentRegisterMessage,
          connection,
        );
      },
      AGENT_HEARTBEAT: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.agentWsHandler.handleAgentHeartbeat(
          msg as unknown as AgentHeartbeatMessage,
          connection,
        );
      },
      SUBSCRIBE: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.signalingHandler.handleSubscribe(
          msg as unknown as SubscribeMessage,
          connection,
        );
      },
      UNSUBSCRIBE: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.signalingHandler.handleUnsubscribe(
          msg as unknown as UnsubscribeMessage,
          connection,
        );
      },
      SDP_OFFER: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.signalingHandler.handleSdpOffer(
          msg as unknown as SdpOfferMessage,
          connection,
        );
      },
      SDP_ANSWER: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.signalingHandler.handleSdpAnswer(
          msg as unknown as SdpAnswerMessage,
          connection,
        );
      },
      ICE_CANDIDATE: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.signalingHandler.handleIceCandidate(
          msg as unknown as IceCandidateMessage,
          connection,
        );
      },
      REFRESH_SESSION: async (_msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.authHandler.handleRefreshSession(connection);
      },
      BIND_SESSION: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.authHandler.handleBindSession(
          msg as { type: 'BIND_SESSION'; token: string },
          connection,
        );
      },
      REQUEST_SOURCES: async (msg, connectionId) => {
        const connection = this.connections.getConnection(connectionId);
        if (!connection) {
          throw new Error('CONNECTION_NOT_FOUND');
        }
        await this.signalingHandler.handleRequestSources(
          msg as { type: 'REQUEST_SOURCES'; agentId: string },
          connection,
        );
      },
    };
    return handlers[type];
  }
}
