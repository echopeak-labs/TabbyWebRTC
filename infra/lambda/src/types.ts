export type ClientType = 'browser' | 'agent';

export interface SourceDescriptor {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface ConnectionRecord {
  connectionId: string;
  clientType: ClientType;
  agentId?: string | null;
  userId?: string | null;
  token?: string;
  connectedAt: number;
  TTL: number;
}

export interface AgentRecord {
  agentId: string;
  userId?: string | null;
  connectionId: string;
  publicKey: string;
  platform: string;
  displays: SourceDescriptor[];
  apps: SourceDescriptor[];
  localEndpoint?: string;
  online: boolean;
  lastSeen: number;
  TTL?: number;
}

export interface SourceLockRecord {
  sourceId: string;
  tabId: string;
  connectionId: string;
  agentId: string;
  TTL: number;
}

export interface InboundMessage {
  type: string;
  [key: string]: unknown;
}

export interface AgentRegisterMessage {
  type: 'AGENT_REGISTER';
  agentId: string;
  publicKey: string;
  platform: 'windows' | 'macos' | 'linux' | string;
  displays: SourceDescriptor[];
  apps: SourceDescriptor[];
  localEndpoint?: string;
}

export interface AgentHeartbeatMessage {
  type: 'AGENT_HEARTBEAT';
  agentId: string;
}

export interface SubscribeMessage {
  type: 'SUBSCRIBE';
  sourceId: string;
  tabId: string;
}

export interface UnsubscribeMessage {
  type: 'UNSUBSCRIBE';
  sourceId: string;
  tabId: string;
}

export interface SdpOfferMessage {
  type: 'SDP_OFFER';
  sourceId: string;
  sdp: unknown;
  targetConnectionId: string;
}

export interface SdpAnswerMessage {
  type: 'SDP_ANSWER';
  sourceId: string;
  sdp: unknown;
}

export interface IceCandidateMessage {
  type: 'ICE_CANDIDATE';
  sourceId: string;
  candidate: unknown;
  targetConnectionId?: string;
}
