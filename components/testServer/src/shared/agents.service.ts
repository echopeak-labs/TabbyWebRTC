import { Injectable } from '@nestjs/common';
import type { AgentRecord } from './types';
import { AgentStore } from '../storage/agent.store';
import { ConnectionsService } from './connections.service';
import { MessageSenderService } from './message-sender.service';

const AGENT_HEARTBEAT_TTL_SECONDS = 120;

@Injectable()
export class AgentsService {
  constructor(
    private readonly store: AgentStore,
    private readonly connections: ConnectionsService,
    private readonly messageSender: MessageSenderService,
  ) {}

  getAgent(agentId: string): AgentRecord | undefined {
    return this.store.get(agentId);
  }

  listAgentsByUserId(userId: string): AgentRecord[] {
    return this.store.listByUserId(userId);
  }

  pairAgent(input: {
    agentId: string;
    userId: string;
    publicKey: string;
    platform: string;
    name: string;
    pairingToken: string;
    pairingNonce: string;
    tokenJti: string;
  }): AgentRecord {
    const now = Date.now();
    const item: AgentRecord = {
      agentId: input.agentId,
      userId: input.userId,
      name: input.name,
      connectionId: '',
      publicKey: input.publicKey,
      platform: input.platform,
      displays: [],
      apps: [],
      online: false,
      lastSeen: now,
      pairingToken: input.pairingToken,
      pairingNonce: input.pairingNonce,
      pairingExpiresAt: Math.floor(now / 1000) + 600,
      tokenJti: input.tokenJti,
    };
    this.store.set(input.agentId, item);
    return item;
  }

  revokeAgentToken(agentId: string): AgentRecord | undefined {
    const agent = this.store.get(agentId);
    if (!agent) {
      return undefined;
    }
    const updated = { ...agent, tokenJti: undefined, online: false, lastSeen: Date.now() };
    this.store.set(agentId, updated);
    return updated;
  }

  consumePairingClaim(agentId: string, nonce: string): string | undefined {
    const agent = this.store.get(agentId);
    if (!agent?.pairingToken || !agent.pairingNonce || !agent.pairingExpiresAt) {
      return undefined;
    }
    if (agent.pairingNonce !== nonce) {
      return undefined;
    }
    if (agent.pairingExpiresAt <= Math.floor(Date.now() / 1000)) {
      return undefined;
    }
    const token = agent.pairingToken;
    const { pairingToken: _t, pairingNonce: _n, pairingExpiresAt: _e, ...rest } = agent;
    this.store.set(agentId, rest);
    return token;
  }

  markAgentOffline(agentId: string): void {
    const agent = this.store.get(agentId);
    if (!agent) {
      return;
    }
    const now = Date.now();
    this.store.set(agentId, { ...agent, online: false, lastSeen: now });
  }

  async notifyAgentSubscribers(agentId: string, payload: object): Promise<void> {
    const browsers = this.connections.findBrowserConnectionsByAgentId(agentId);
    await Promise.all(
      browsers.map((browser) => this.messageSender.sendToConnection(browser.connectionId, payload)),
    );
  }

  upsertAgentRegistration(
    agent: Omit<AgentRecord, 'online' | 'lastSeen' | 'TTL'>,
  ): void {
    const now = Date.now();
    const item: AgentRecord = {
      ...agent,
      online: true,
      lastSeen: now,
      TTL: Math.floor(now / 1000) + AGENT_HEARTBEAT_TTL_SECONDS,
    };
    this.store.set(agent.agentId, item);
  }

  touchAgentHeartbeat(agentId: string, connectionId: string): void {
    const agent = this.store.get(agentId);
    if (!agent) {
      return;
    }
    const now = Date.now();
    this.store.set(agentId, {
      ...agent,
      lastSeen: now,
      online: true,
      connectionId,
      TTL: Math.floor(now / 1000) + AGENT_HEARTBEAT_TTL_SECONDS,
    });
  }
}
