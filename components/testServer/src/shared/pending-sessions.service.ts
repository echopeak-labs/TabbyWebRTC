import { Injectable, OnModuleInit } from '@nestjs/common';
import { PendingSessionStore } from '../storage/pending-session.store';
import type { PendingSessionRecord } from '../storage/pending-session.types';
import { PENDING_SESSION_EXPIRES_SECONDS } from '../storage/pending-session.types';
import { MessageSenderService } from './message-sender.service';

export { PENDING_SESSION_EXPIRES_SECONDS };

@Injectable()
export class PendingSessionsService implements OnModuleInit {
  constructor(
    private readonly store: PendingSessionStore,
    private readonly messageSender: MessageSenderService,
  ) {}

  onModuleInit(): void {
    this.store.setExpiryHandler((connectionId) => {
      void this.messageSender.sendToConnection(connectionId, { type: 'SESSION_EXPIRED' });
    });
  }

  createPendingSession(connectionId: string): PendingSessionRecord {
    return this.store.create(connectionId);
  }

  getPendingSession(pendingSessionId: string): PendingSessionRecord | undefined {
    return this.store.get(pendingSessionId);
  }

  peekPendingSession(pendingSessionId: string): PendingSessionRecord | undefined {
    return this.store.peek(pendingSessionId);
  }

  deletePendingSession(pendingSessionId: string): void {
    this.store.delete(pendingSessionId);
  }

  rotatePendingSession(oldPendingSessionId: string, connectionId: string): PendingSessionRecord {
    return this.store.rotate(oldPendingSessionId, connectionId);
  }
}
