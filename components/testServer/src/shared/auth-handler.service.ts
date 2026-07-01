import { Injectable } from '@nestjs/common';
import {
  issueTabbyWebRTCToken,
  verifyClerkJwt,
} from './jwt';
import type { ConnectionRecord } from './types';
import { AgentsService } from './agents.service';
import { ConnectionsService } from './connections.service';
import { MessageSenderService } from './message-sender.service';
import {
  PendingSessionsService,
  PENDING_SESSION_EXPIRES_SECONDS,
} from './pending-sessions.service';

@Injectable()
export class AuthHandlerService {
  constructor(
    private readonly agents: AgentsService,
    private readonly connections: ConnectionsService,
    private readonly pendingSessions: PendingSessionsService,
    private readonly messageSender: MessageSenderService,
  ) {}

  async handleAuthApprove(
    clerkToken: string,
    pendingSessionId: string,
    agentId: string,
  ): Promise<{ status: number; body: object }> {
    const { userId } = await verifyClerkJwt(clerkToken);
    const session = this.pendingSessions.getPendingSession(pendingSessionId);
    if (!session) {
      return { status: 404, body: { error: 'Session not found or expired' } };
    }

    const agent = this.agents.getAgent(agentId);
    if (!agent || agent.userId !== userId) {
      return { status: 403, body: { error: 'Agent not found or not owned by user' } };
    }

    this.pendingSessions.deletePendingSession(pendingSessionId);
    const token = await issueTabbyWebRTCToken(userId, agentId);
    this.connections.updateConnection(session.connectionId, {
      token,
      userId,
      agentId,
    });

    await this.messageSender.sendToConnection(session.connectionId, {
      type: 'AUTH_APPROVED',
      token,
      agentId,
    });

    return { status: 200, body: { ok: true } };
  }

  async handleRefreshSession(connection: ConnectionRecord): Promise<void> {
    if (connection.clientType !== 'browser') {
      throw new Error('INVALID_CLIENT');
    }

    const session = connection.pendingSessionId
      ? this.pendingSessions.rotatePendingSession(
          connection.pendingSessionId,
          connection.connectionId,
        )
      : this.pendingSessions.createPendingSession(connection.connectionId);

    this.connections.updateConnection(connection.connectionId, {
      pendingSessionId: session.pendingSessionId,
    });

    await this.messageSender.sendToConnection(connection.connectionId, {
      type: 'SESSION_PENDING',
      pendingSessionId: session.pendingSessionId,
      expiresIn: PENDING_SESSION_EXPIRES_SECONDS,
    });
  }
}
