export interface PendingSessionRecord {
  pendingSessionId: string;
  connectionId: string;
  expiresAt: number;
  status: 'PENDING';
}

export const PENDING_SESSION_EXPIRES_SECONDS = 30;
