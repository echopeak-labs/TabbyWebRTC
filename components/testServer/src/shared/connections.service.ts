import { Injectable } from '@nestjs/common';
import type { ConnectionRecord } from './types';
import { ConnectionStore } from '../storage/connection.store';

const CONNECTION_TTL_SECONDS = 86400;

@Injectable()
export class ConnectionsService {
  constructor(private readonly store: ConnectionStore) {}

  getConnection(connectionId: string): ConnectionRecord | undefined {
    return this.store.get(connectionId);
  }

  putConnection(
    connectionId: string,
    clientType: ConnectionRecord['clientType'],
    queryParams: Record<string, string | undefined>,
  ): void {
    const now = Date.now();
    const record: ConnectionRecord = {
      connectionId,
      clientType,
      agentId: queryParams.agentId ?? null,
      userId: queryParams.userId ?? null,
      connectedAt: now,
      TTL: Math.floor(now / 1000) + CONNECTION_TTL_SECONDS,
    };
    this.store.set(connectionId, record);
  }

  updateConnection(
    connectionId: string,
    updates: Partial<Pick<ConnectionRecord, 'agentId' | 'userId' | 'token' | 'pendingSessionId'>>,
  ): void {
    const existing = this.store.get(connectionId);
    if (!existing) {
      return;
    }
    this.store.set(connectionId, { ...existing, ...updates });
  }

  deleteConnection(connectionId: string): void {
    this.store.delete(connectionId);
  }

  findAgentConnectionId(agentId: string): string | undefined {
    return this.store.findAgentConnectionId(agentId);
  }

  findBrowserConnectionsByAgentId(agentId: string): ConnectionRecord[] {
    return this.store.findByAgentId(agentId, 'browser');
  }
}
