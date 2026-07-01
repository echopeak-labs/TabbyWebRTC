import type { DesktopInboundMessage, OutboundSignalMessage } from '@/types/signaling'

export type AuthInboundMessage =
  | { type: 'SESSION_PENDING'; pendingSessionId: string; expiresIn: number }
  | { type: 'AUTH_APPROVED'; token: string; agentId: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'ERROR'; code: string; message: string }

export type AuthOutboundMessage = { type: 'REFRESH_SESSION' }

type MessageListener = (message: DesktopInboundMessage) => void
type ConnectionStateListener = (state: 'connected' | 'disconnected' | 'offline') => void

const RECONNECT_INTERVAL_MS = 2000
const RECONNECT_MAX_MS = 30000

export class SignalClient {
  private ws: WebSocket | null = null
  private listeners = new Set<MessageListener>()
  private stateListeners = new Set<ConnectionStateListener>()
  private url: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectStartedAt: number | null = null
  private intentionalClose = false
  private autoReconnect: boolean

  constructor(url: string, options?: { autoReconnect?: boolean }) {
    this.url = url
    this.autoReconnect = options?.autoReconnect ?? false
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return
    }

    this.intentionalClose = false
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.clearReconnect()
      this.emitState('connected')
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as DesktopInboundMessage
        this.listeners.forEach((listener) => listener(message))
      } catch {
        return
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      this.emitState('disconnected')
      if (!this.intentionalClose && this.autoReconnect) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribe(listener: MessageListener): () => void {
    return this.onMessage(listener)
  }

  onConnectionState(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  send(message: OutboundSignalMessage | AuthOutboundMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  refreshSession(): void {
    this.send({ type: 'REFRESH_SESSION' })
  }

  subscribeToSource(sourceId: string, tabId: string): void {
    this.send({ type: 'SUBSCRIBE', sourceId, tabId })
  }

  unsubscribeFromSource(sourceId: string, tabId: string): void {
    if (this.connected) {
      this.send({ type: 'UNSUBSCRIBE', sourceId, tabId })
    }
  }

  sendSdpAnswer(sourceId: string, sdp: RTCSessionDescriptionInit): void {
    this.send({ type: 'SDP_ANSWER', sourceId, sdp })
  }

  sendIceCandidate(sourceId: string, candidate: RTCIceCandidateInit): void {
    this.send({ type: 'ICE_CANDIDATE', sourceId, candidate })
  }

  disconnect(): void {
    this.intentionalClose = true
    this.clearReconnect()
    this.ws?.close()
    this.ws = null
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  get isConnected(): boolean {
    return this.connected
  }

  private emitState(state: 'connected' | 'disconnected' | 'offline'): void {
    this.stateListeners.forEach((listener) => listener(state))
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return
    }

    if (this.reconnectStartedAt === null) {
      this.reconnectStartedAt = Date.now()
    }

    const elapsed = Date.now() - this.reconnectStartedAt
    if (elapsed >= RECONNECT_MAX_MS) {
      this.reconnectStartedAt = null
      this.emitState('offline')
      return
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_INTERVAL_MS)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectStartedAt = null
  }
}

export const signalClient = new SignalClient(import.meta.env.VITE_WS_URL, {
  autoReconnect: true,
})
