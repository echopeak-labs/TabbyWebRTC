import {
  DeleteCommand,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ConnectionRecord,
  IceCandidateMessage,
  SdpAnswerMessage,
  SdpOfferMessage,
  SourceLockRecord,
  SubscribeMessage,
  UnsubscribeMessage,
} from '../types.js';
import { findAgentConnectionId, findBrowserConnectionsByAgentId } from '../lib/connections.js';
import { docClient } from '../lib/dynamodb.js';
import { sourceLocksTable, SOURCE_LOCK_TTL_SECONDS } from '../lib/env.js';
import { sendToConnection } from '../lib/send-to-connection.js';

async function getSourceLock(sourceId: string): Promise<SourceLockRecord | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: sourceLocksTable(),
      Key: { sourceId },
    }),
  );
  return result.Item as SourceLockRecord | undefined;
}

function requireSessionToken(connection: ConnectionRecord): void {
  if (!connection.token) {
    throw new Error('UNAUTHORIZED');
  }
}

export async function handleSubscribe(
  message: SubscribeMessage,
  connection: ConnectionRecord,
): Promise<void> {
  requireSessionToken(connection);

  if (!connection.agentId) {
    throw new Error('NO_AGENT');
  }

  const existing = await getSourceLock(message.sourceId);

  if (existing && existing.tabId !== message.tabId) {
    await sendToConnection(connection.connectionId, {
      type: 'SOURCE_IN_USE',
      sourceId: message.sourceId,
      tabId: existing.tabId,
    });
    return;
  }

  const now = Date.now();
  await docClient.send(
    new PutCommand({
      TableName: sourceLocksTable(),
      Item: {
        sourceId: message.sourceId,
        tabId: message.tabId,
        connectionId: connection.connectionId,
        agentId: connection.agentId,
        TTL: Math.floor(now / 1000) + SOURCE_LOCK_TTL_SECONDS,
      } satisfies SourceLockRecord,
    }),
  );

  const agentConnectionId = await findAgentConnectionId(connection.agentId);
  if (!agentConnectionId) {
    throw new Error('AGENT_OFFLINE');
  }

  await sendToConnection(agentConnectionId, {
    type: 'NOTIFY_SUBSCRIBER',
    sourceId: message.sourceId,
    tabId: message.tabId,
    browserConnectionId: connection.connectionId,
  });
}

export async function handleUnsubscribe(
  message: UnsubscribeMessage,
  connection: ConnectionRecord,
): Promise<void> {
  const lock = await getSourceLock(message.sourceId);
  if (!lock || lock.tabId !== message.tabId) {
    return;
  }

  await docClient.send(
    new DeleteCommand({
      TableName: sourceLocksTable(),
      Key: { sourceId: message.sourceId },
    }),
  );

  const agentConnectionId = await findAgentConnectionId(lock.agentId);
  if (agentConnectionId) {
    await sendToConnection(agentConnectionId, {
      type: 'NOTIFY_UNSUBSCRIBE',
      sourceId: message.sourceId,
      tabId: message.tabId,
    });
  }

  const browsers = await findBrowserConnectionsByAgentId(lock.agentId);
  await Promise.all(
    browsers.map((browser) =>
      sendToConnection(browser.connectionId, {
        type: 'STREAM_CLOSED',
        sourceId: message.sourceId,
      }),
    ),
  );
}

export async function handleSdpOffer(message: SdpOfferMessage): Promise<void> {
  await sendToConnection(message.targetConnectionId, {
    type: 'SDP_OFFER',
    sourceId: message.sourceId,
    sdp: message.sdp,
  });
}

export async function handleSdpAnswer(
  message: SdpAnswerMessage,
  connection: ConnectionRecord,
): Promise<void> {
  const lock = await getSourceLock(message.sourceId);
  if (!lock) {
    throw new Error('NO_LOCK');
  }

  const agentId = connection.agentId ?? lock.agentId;
  const agentConnectionId = await findAgentConnectionId(agentId);
  if (!agentConnectionId) {
    throw new Error('AGENT_OFFLINE');
  }

  await sendToConnection(agentConnectionId, {
    type: 'SDP_ANSWER',
    tabId: lock.tabId,
    sdp: message.sdp,
  });
}

export async function handleIceCandidate(
  message: IceCandidateMessage,
  connection: ConnectionRecord,
): Promise<void> {
  if (connection.clientType === 'agent') {
    if (!message.targetConnectionId) {
      throw new Error('MISSING_TARGET');
    }
    await sendToConnection(message.targetConnectionId, {
      type: 'ICE_CANDIDATE',
      sourceId: message.sourceId,
      candidate: message.candidate,
    });
    return;
  }

  const lock = await getSourceLock(message.sourceId);
  if (!lock) {
    throw new Error('NO_LOCK');
  }

  const agentConnectionId = await findAgentConnectionId(lock.agentId);
  if (!agentConnectionId) {
    throw new Error('AGENT_OFFLINE');
  }

  await sendToConnection(agentConnectionId, {
    type: 'ICE_CANDIDATE',
    tabId: lock.tabId,
    candidate: message.candidate,
  });
}
