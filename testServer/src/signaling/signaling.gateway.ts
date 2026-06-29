import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import type { InboundMessage } from '../shared/types';
import { MessageRouterService } from '../shared/message-router.service';
import { MessageSenderService } from '../shared/message-sender.service';
import { WsConnectService } from './ws-connect.service';

type TabbySocket = WebSocket & { connectionId?: string };

@WebSocketGateway()
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SignalingGateway.name);

  constructor(
    private readonly wsConnect: WsConnectService,
    private readonly router: MessageRouterService,
    private readonly messageSender: MessageSenderService,
  ) {}

  async handleConnection(client: TabbySocket, request: IncomingMessage): Promise<void> {
    const result = await this.wsConnect.handleConnect(client, request);
    if (!result.ok) {
      return;
    }
    client.connectionId = result.connectionId;

    client.on('message', (data) => {
      void this.handleMessage(client, data);
    });
  }

  async handleDisconnect(client: TabbySocket): Promise<void> {
    if (client.connectionId) {
      await this.wsConnect.handleDisconnect(client.connectionId);
    }
  }

  private async handleMessage(client: TabbySocket, data: RawData): Promise<void> {
    const connectionId = client.connectionId;
    if (!connectionId) {
      return;
    }

    const body = typeof data === 'string' ? data : data.toString();
    if (!body) {
      return;
    }

    let message: InboundMessage;
    try {
      message = JSON.parse(body) as InboundMessage;
    } catch {
      await this.messageSender.sendToConnection(connectionId, {
        type: 'ERROR',
        message: 'Invalid JSON',
      });
      return;
    }

    if (!message.type) {
      await this.messageSender.sendToConnection(connectionId, {
        type: 'ERROR',
        message: 'Missing type',
      });
      return;
    }

    try {
      await this.router.dispatchMessage(message, connectionId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Handler failed';
      this.logger.warn(`WS handler error for ${connectionId}: ${messageText}`);
      await this.messageSender.sendToConnection(connectionId, {
        type: 'ERROR',
        message: messageText,
      });
    }
  }
}
