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

  async handleAgentRegister(
    message: AgentRegisterMessage,
    connection: ConnectionRecord,
  ): Promise<void> {
    this.agents.upsertAgentRegistration({
      agentId: message.agentId,
      userId: connection.userId,
      connectionId: connection.connectionId,
      publicKey: message.publicKey,
      platform: message.platform,
      displays: message.displays ?? [],
      apps: message.apps ?? [],
      localEndpoint: message.localEndpoint,
    });

    this.connections.updateConnection(connection.connectionId, {
      agentId: message.agentId,
    });
  }

  async handleAgentHeartbeat(
    message: AgentHeartbeatMessage,
    connection: ConnectionRecord,
  ): Promise<void> {
    this.agents.touchAgentHeartbeat(message.agentId, connection.connectionId);
  }
}
