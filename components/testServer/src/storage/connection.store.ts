import { Injectable } from '@nestjs/common';
import type { ConnectionRecord } from '../shared/types';

@Injectable()
export class ConnectionStore {
  private readonly records = new Map<string, ConnectionRecord>();

  get(connectionId: string): ConnectionRecord | undefined {
    return this.records.get(connectionId);
  }

  set(connectionId: string, record: ConnectionRecord): void {
    this.records.set(connectionId, record);
  }

  delete(connectionId: string): void {
    this.records.delete(connectionId);
  }

  findByAgentId(agentId: string, clientType: ConnectionRecord['clientType']): ConnectionRecord[] {
    return [...this.records.values()].filter(
      (record) => record.agentId === agentId && record.clientType === clientType,
    );
  }

  findAgentConnectionId(agentId: string): string | undefined {
    const agents = this.findByAgentId(agentId, 'agent');
    if (agents.length === 0) {
      return undefined;
    }
    agents.sort((a, b) => b.connectedAt - a.connectedAt);
    return agents[0]?.connectionId;
  }

  clear(): void {
    this.records.clear();
  }
}
