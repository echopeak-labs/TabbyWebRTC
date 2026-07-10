import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamodb.js';
import { pendingSessionsTable } from './env.js';

export const PENDING_SESSION_EXPIRES_SECONDS = 30;

export interface PendingSessionRecord {
  pendingSessionId: string;
  connectionId: string;
  expiresAt: number;
  status: 'PENDING';
}

export async function createPendingSession(connectionId: string): Promise<PendingSessionRecord> {
  const pendingSessionId = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + PENDING_SESSION_EXPIRES_SECONDS;
  const record: PendingSessionRecord = {
    pendingSessionId,
    connectionId,
    expiresAt,
    status: 'PENDING',
  };
  await docClient.send(
    new PutCommand({
      TableName: pendingSessionsTable(),
      Item: record,
    }),
  );
  return record;
}

export async function peekPendingSession(
  pendingSessionId: string,
): Promise<PendingSessionRecord | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: pendingSessionsTable(),
      Key: { pendingSessionId },
    }),
  );
  return result.Item as PendingSessionRecord | undefined;
}

export async function getPendingSession(
  pendingSessionId: string,
): Promise<PendingSessionRecord | undefined> {
  const record = await peekPendingSession(pendingSessionId);
  if (!record) {
    return undefined;
  }
  if (record.expiresAt <= Math.floor(Date.now() / 1000)) {
    await deletePendingSession(pendingSessionId);
    return undefined;
  }
  return record;
}

export async function deletePendingSession(pendingSessionId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: pendingSessionsTable(),
      Key: { pendingSessionId },
    }),
  );
}

export async function rotatePendingSession(
  oldPendingSessionId: string,
  connectionId: string,
): Promise<PendingSessionRecord> {
  await deletePendingSession(oldPendingSessionId);
  return createPendingSession(connectionId);
}
