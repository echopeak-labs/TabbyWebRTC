export interface SessionQRPayload {
  pendingSessionId: string
  signalingUrl: string
  version: number
}

export interface PairQRPayload {
  type: 'PAIR'
  agentId: string
  publicKey: string
  platform?: 'windows' | 'macos' | 'linux'
  name?: string
  localEndpoint?: string
  pairingNonce?: string
}

export type QRPayload = SessionQRPayload | PairQRPayload

export function isPairQRPayload(payload: QRPayload): payload is PairQRPayload {
  return 'type' in payload && payload.type === 'PAIR'
}

export function isSessionQRPayload(payload: QRPayload): payload is SessionQRPayload {
  return 'pendingSessionId' in payload && 'version' in payload
}

export interface AuthSession {
  token: string
  agentId: string
}
