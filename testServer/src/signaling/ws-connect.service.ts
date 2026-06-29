import { Injectable } from '@nestjs/common';
import { verifyAgentJwt, extractBearerToken } from '../shared/jwt';
import type { ClientType } from '../shared/types';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { AgentsService } from '../shared/agents.service';
import { ConnectionsService } from '../shared/connections.service';
import { MessageSenderService } from '../shared/message-sender.service';
import {
  PendingSessionsService,
  PENDING_SESSION_EXPIRES_SECONDS,
} from '../shared/pending-sessions.service';

@Injectable()
export class WsConnectService {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly pendingSessions: PendingSessionsService,
    private readonly messageSender: MessageSenderService,
    private readonly agents: AgentsService,
  ) {}

  async handleConnect(
    client: WebSocket,
    request: IncomingMessage,
  ): Promise<{ connectionId: string; ok: boolean; statusCode?: number; message?: string }> {
    const connectionId = randomUUID();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const params = Object.fromEntries(url.searchParams.entries());
    const clientType = (params.clientType ?? 'browser') as ClientType;

    if (clientType !== 'browser' && clientType !== 'agent') {
      client.close(1008, 'Invalid clientType');
      return { connectionId, ok: false, statusCode: 400, message: 'Invalid clientType' };
    }

    this.messageSender.registerSocket(connectionId, client);

    if (clientType === 'agent') {
      const authHeader = request.headers.authorization;
      const agentToken = extractBearerToken(
        typeof authHeader === 'string' ? authHeader : undefined,
      ) ?? params.token;

      if (!agentToken) {
        client.close(1008, 'Missing agent token');
        return { connectionId, ok: false, statusCode: 401, message: 'Missing agent token' };
      }

      try {
        const payload = await verifyAgentJwt(agentToken);
        this.connections.putConnection(connectionId, clientType, {
          agentId: payload.sub,
          userId: payload.userId,
        });
        return { connectionId, ok: true };
      } catch {
        client.close(1008, 'Invalid agent token');
        return { connectionId, ok: false, statusCode: 401, message: 'Invalid agent token' };
      }
    }

    this.connections.putConnection(connectionId, clientType, params);
    const session = this.pendingSessions.createPendingSession(connectionId);
    this.connections.updateConnection(connectionId, {
      pendingSessionId: session.pendingSessionId,
    });
    await this.messageSender.sendToConnection(connectionId, {
      type: 'SESSION_PENDING',
      pendingSessionId: session.pendingSessionId,
      expiresIn: PENDING_SESSION_EXPIRES_SECONDS,
    });

    return { connectionId, ok: true };
  }

  async handleDisconnect(connectionId: string): Promise<void> {
    const record = this.connections.getConnection(connectionId);

    if (record?.clientType === 'agent' && record.agentId) {
      this.agents.markAgentOffline(record.agentId);
      await this.agents.notifyAgentSubscribers(record.agentId, { type: 'AGENT_OFFLINE' });
    }

    this.connections.deleteConnection(connectionId);
    this.messageSender.unregisterSocket(connectionId);
  }
}
