import { Injectable } from '@nestjs/common';
import type { AgentRecord } from '../shared/types';

@Injectable()
export class AgentStore {
  private readonly records = new Map<string, AgentRecord>();

  get(agentId: string): AgentRecord | undefined {
    return this.records.get(agentId);
  }

  set(agentId: string, record: AgentRecord): void {
    this.records.set(agentId, record);
  }

  listByUserId(userId: string): AgentRecord[] {
    return [...this.records.values()].filter((record) => record.userId === userId);
  }

  clear(): void {
    this.records.clear();
  }
}
