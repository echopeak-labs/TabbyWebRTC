export interface QRPayload {
  type: 'SESSION' | 'PAIR'
  pendingSessionId?: string
  agentId?: string
  publicKey?: string
}

export interface AuthSession {
  token: string
  agentId: string
}
