import type {
  AgentHeartbeatMessage,
  AgentRegisterMessage,
  ConnectionRecord,
} from '../types.js';
import { touchAgentHeartbeat, upsertAgentRegistration } from '../lib/agents.js';

function requireBoundAgentId(
  connection: ConnectionRecord,
  messageAgentId: string,
): string {
  if (!connection.agentId) {
    throw new Error('UNAUTHORIZED');
  }
  if (messageAgentId !== connection.agentId) {
    throw new Error('AGENT_ID_MISMATCH');
  }
  return connection.agentId;
}

export async function handleAgentRegister(
  message: AgentRegisterMessage,
  connection: ConnectionRecord,
): Promise<void> {
  const agentId = requireBoundAgentId(connection, message.agentId);

  await upsertAgentRegistration({
    agentId,
    userId: connection.userId,
    connectionId: connection.connectionId,
    publicKey: message.publicKey,
    platform: message.platform,
    displays: message.displays ?? [],
    apps: message.apps ?? [],
    localEndpoint: message.localEndpoint,
  });
}

export async function handleAgentHeartbeat(
  message: AgentHeartbeatMessage,
  connection: ConnectionRecord,
): Promise<void> {
  const agentId = requireBoundAgentId(connection, message.agentId);
  await touchAgentHeartbeat(agentId, connection.connectionId);
}
