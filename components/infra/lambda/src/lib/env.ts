export function connectionsTable(): string {
  return process.env.CONNECTIONS_TABLE ?? '';
}

export function pendingSessionsTable(): string {
  return process.env.PENDING_SESSIONS_TABLE ?? '';
}

export function agentsTable(): string {
  return process.env.AGENTS_TABLE ?? '';
}

export function sourceLocksTable(): string {
  return process.env.SOURCE_LOCKS_TABLE ?? '';
}

export function wsCallbackUrl(): string {
  return process.env.WS_CALLBACK_URL ?? '';
}

export const CONNECTION_TTL_SECONDS = 7200;
export const AGENT_HEARTBEAT_TTL_SECONDS = 12 * 60;
export const SOURCE_LOCK_TTL_SECONDS = 7200;
