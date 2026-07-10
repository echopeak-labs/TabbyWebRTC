import { Injectable } from '@nestjs/common';
import type {
  AgentHeartbeatMessage,
  AgentRegisterMessage,
  ConnectionRecord,
} from './types';
import { AgentsService } from './agents.service';
import { ConnectionsService } from './connections.service';

@Injectable()
export class AgentWsHandlerService {
  constructor(
    private readonly agents: AgentsService,
    private readonly connections: ConnectionsService,
  ) {}

  private requireBoundAgentId(connection: ConnectionRecord, messageAgentId: string): string {
    if (!connection.agentId) {
      throw new Error('UNAUTHORIZED');
    }
    if (messageAgentId !== connection.agentId) {
      throw new Error('AGENT_ID_MISMATCH');
    }
    return connection.agentId;
  }

  async handleAgentRegister(
    message: AgentRegisterMessage,
    connection: ConnectionRecord,
  ): Promise<void> {
    const agentId = this.requireBoundAgentId(connection, message.agentId);

    this.agents.upsertAgentRegistration({
      agentId,
      userId: connection.userId,
      connectionId: connection.connectionId,
      publicKey: message.publicKey,
      platform: message.platform,
      displays: message.displays ?? [],
      apps: message.apps ?? [],
      localEndpoint: message.localEndpoint,
    });
  }

  async handleAgentHeartbeat(
    message: AgentHeartbeatMessage,
    connection: ConnectionRecord,
  ): Promise<void> {
    const agentId = this.requireBoundAgentId(connection, message.agentId);
    this.agents.touchAgentHeartbeat(agentId, connection.connectionId);
  }
}
