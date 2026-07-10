import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PendingSessionRecord } from './pending-session.types';
import { PENDING_SESSION_EXPIRES_SECONDS } from './pending-session.types';

export type SessionExpiryHandler = (connectionId: string, pendingSessionId: string) => void;

@Injectable()
export class PendingSessionStore {
  private readonly records = new Map<string, PendingSessionRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private expiryHandler?: SessionExpiryHandler;

  setExpiryHandler(handler: SessionExpiryHandler): void {
    this.expiryHandler = handler;
  }

  create(connectionId: string): PendingSessionRecord {
    const pendingSessionId = randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + PENDING_SESSION_EXPIRES_SECONDS;
    const record: PendingSessionRecord = {
      pendingSessionId,
      connectionId,
      expiresAt,
      status: 'PENDING',
    };
    this.records.set(pendingSessionId, record);
    this.scheduleExpiry(pendingSessionId, connectionId);
    return record;
  }

  get(pendingSessionId: string): PendingSessionRecord | undefined {
    const record = this.peek(pendingSessionId);
    if (!record) {
      return undefined;
    }
    if (record.expiresAt <= Math.floor(Date.now() / 1000)) {
      this.delete(pendingSessionId);
      return undefined;
    }
    return record;
  }

  peek(pendingSessionId: string): PendingSessionRecord | undefined {
    return this.records.get(pendingSessionId);
  }

  delete(pendingSessionId: string): void {
    this.clearTimer(pendingSessionId);
    this.records.delete(pendingSessionId);
  }

  rotate(oldPendingSessionId: string, connectionId: string): PendingSessionRecord {
    this.delete(oldPendingSessionId);
    return this.create(connectionId);
  }

  clear(): void {
    for (const pendingSessionId of this.timers.keys()) {
      this.clearTimer(pendingSessionId);
    }
    this.records.clear();
  }

  private scheduleExpiry(pendingSessionId: string, connectionId: string): void {
    this.clearTimer(pendingSessionId);
    const timer = setTimeout(() => {
      this.timers.delete(pendingSessionId);
      if (!this.records.has(pendingSessionId)) {
        return;
      }
      this.records.delete(pendingSessionId);
      this.expiryHandler?.(connectionId, pendingSessionId);
    }, PENDING_SESSION_EXPIRES_SECONDS * 1000);
    this.timers.set(pendingSessionId, timer);
  }

  private clearTimer(pendingSessionId: string): void {
    const timer = this.timers.get(pendingSessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(pendingSessionId);
    }
  }
}
