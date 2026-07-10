import { Injectable } from '@nestjs/common';
import { verifyTabbyWebRTCToken, type TabbyWebRTCTokenPayload } from './jwt';
import type {
  ConnectionRecord,
  IceCandidateMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
  SourceLockRecord,
  SubscribeMessage,
  UnsubscribeMessage,
} from './types';
import { AgentsService } from './agents.service';
import { ConnectionsService } from './connections.service';
import { MessageSenderService } from './message-sender.service';
import { SourceLockStore } from '../storage/source-lock.store';

const SOURCE_LOCK_TTL_SECONDS = 86400;

@Injectable()
export class SignalingHandlerService {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly messageSender: MessageSenderService,
    private readonly sourceLocks: SourceLockStore,
    private readonly agents: AgentsService,
  ) {}

  private getSourceLock(sourceId: string): SourceLockRecord | undefined {
    return this.sourceLocks.get(sourceId);
  }

  private async requireValidSessionToken(
    connection: ConnectionRecord,
  ): Promise<TabbyWebRTCTokenPayload> {
    if (!connection.token) {
      throw new Error('UNAUTHORIZED');
    }

    const payload = await verifyTabbyWebRTCToken(connection.token);
    if (connection.agentId && payload.agentId !== connection.agentId) {
      throw new Error('UNAUTHORIZED');
    }
    if (connection.userId && payload.sub !== connection.userId) {
      throw new Error('UNAUTHORIZED');
    }
    return payload;
  }

  async handleSubscribe(message: SubscribeMessage, connection: ConnectionRecord): Promise<void> {
    await this.requireValidSessionToken(connection);

    if (!connection.agentId) {
      throw new Error('NO_AGENT');
    }

    const existing = this.getSourceLock(message.sourceId);

    if (existing && existing.tabId !== message.tabId) {
      await this.messageSender.sendToConnection(connection.connectionId, {
        type: 'SOURCE_IN_USE',
        sourceId: message.sourceId,
        tabId: existing.tabId,
      });
      return;
    }

    const now = Date.now();
    this.sourceLocks.set(message.sourceId, {
      sourceId: message.sourceId,
      tabId: message.tabId,
      connectionId: connection.connectionId,
      agentId: connection.agentId,
      TTL: Math.floor(now / 1000) + SOURCE_LOCK_TTL_SECONDS,
    });

    const agentConnectionId = this.connections.findAgentConnectionId(connection.agentId);
    if (!agentConnectionId) {
      throw new Error('AGENT_OFFLINE');
    }

    await this.messageSender.sendToConnection(agentConnectionId, {
      type: 'NOTIFY_SUBSCRIBER',
      sourceId: message.sourceId,
      tabId: message.tabId,
      browserConnectionId: connection.connectionId,
    });
  }

  async handleUnsubscribe(message: UnsubscribeMessage, connection: ConnectionRecord): Promise<void> {
    const lock = this.getSourceLock(message.sourceId);
    if (!lock || lock.tabId !== message.tabId) {
      return;
    }

    this.sourceLocks.delete(message.sourceId);

    const agentConnectionId = this.connections.findAgentConnectionId(lock.agentId);
    if (agentConnectionId) {
      await this.messageSender.sendToConnection(agentConnectionId, {
        type: 'NOTIFY_UNSUBSCRIBE',
        sourceId: message.sourceId,
        tabId: message.tabId,
      });
    }

    const browsers = this.connections.findBrowserConnectionsByAgentId(lock.agentId);
    await Promise.all(
      browsers.map((browser) =>
        this.messageSender.sendToConnection(browser.connectionId, {
          type: 'STREAM_CLOSED',
          sourceId: message.sourceId,
        }),
      ),
    );
  }

  async handleSdpOffer(message: SdpOfferMessage, connection: ConnectionRecord): Promise<void> {
    if (connection.clientType !== 'agent' || !connection.agentId) {
      throw new Error('UNAUTHORIZED');
    }

    const lock = this.getSourceLock(message.sourceId);
    if (!lock || lock.agentId !== connection.agentId) {
      throw new Error('UNAUTHORIZED');
    }
    if (lock.connectionId !== message.targetConnectionId) {
      throw new Error('UNAUTHORIZED');
    }

    await this.messageSender.sendToConnection(message.targetConnectionId, {
      type: 'SDP_OFFER',
      sourceId: message.sourceId,
      sdp: message.sdp,
    });
  }

  async handleSdpAnswer(message: SdpAnswerMessage, connection: ConnectionRecord): Promise<void> {
    const lock = this.getSourceLock(message.sourceId);
    if (!lock) {
      throw new Error('NO_LOCK');
    }

    const agentId = connection.agentId ?? lock.agentId;
    const agentConnectionId = this.connections.findAgentConnectionId(agentId);
    if (!agentConnectionId) {
      throw new Error('AGENT_OFFLINE');
    }

    await this.messageSender.sendToConnection(agentConnectionId, {
      type: 'SDP_ANSWER',
      tabId: lock.tabId,
      sdp: message.sdp,
    });
  }

  async handleIceCandidate(
    message: IceCandidateMessage,
    connection: ConnectionRecord,
  ): Promise<void> {
    if (connection.clientType === 'agent') {
      if (!message.targetConnectionId) {
        throw new Error('MISSING_TARGET');
      }
      await this.messageSender.sendToConnection(message.targetConnectionId, {
        type: 'ICE_CANDIDATE',
        sourceId: message.sourceId,
        candidate: message.candidate,
      });
      return;
    }

    const lock = this.getSourceLock(message.sourceId);
    if (!lock) {
      throw new Error('NO_LOCK');
    }

    const agentConnectionId = this.connections.findAgentConnectionId(lock.agentId);
    if (!agentConnectionId) {
      throw new Error('AGENT_OFFLINE');
    }

    await this.messageSender.sendToConnection(agentConnectionId, {
      type: 'ICE_CANDIDATE',
      tabId: lock.tabId,
      candidate: message.candidate,
    });
  }

  async handleRequestSources(
    message: { type: 'REQUEST_SOURCES'; agentId: string },
    connection: ConnectionRecord,
  ): Promise<void> {
    const payload = await this.requireValidSessionToken(connection);
    if (payload.agentId !== message.agentId) {
      throw new Error('UNAUTHORIZED');
    }
    if (connection.agentId && connection.agentId !== message.agentId) {
      throw new Error('UNAUTHORIZED');
    }

    const agent = this.agents.getAgent(message.agentId);
    if (!agent) {
      throw new Error('AGENT_OFFLINE');
    }

    await this.messageSender.sendToConnection(connection.connectionId, {
      type: 'AGENT_SOURCES',
      agentId: agent.agentId,
      displays: agent.displays ?? [],
      apps: agent.apps ?? [],
      localEndpoint: agent.localEndpoint,
    });
  }
}
