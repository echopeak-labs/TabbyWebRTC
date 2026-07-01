import { useAuthStore } from '@/stores/authStore'

export const SESSION_TOKEN_KEY = 'tabbywebrtc_token'
export const SESSION_AGENT_KEY = 'tabbywebrtc_agent_id'
const CHANNEL_NAME = 'auth_sync'
const SYNC_TIMEOUT_MS = 150

export type AuthSyncMessage =
  | { type: 'REQUEST_AUTH_TOKEN' }
  | { type: 'PROVIDE_AUTH_TOKEN'; token: string; agentId: string }

let channel: BroadcastChannel | null = null
let listenerStarted = false

export function readSession(): { token: string; agentId: string } | null {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY)
  const agentId = sessionStorage.getItem(SESSION_AGENT_KEY)
  if (!token || !agentId) {
    return null
  }
  return { token, agentId }
}

export function writeSession(token: string, agentId: string): void {
  sessionStorage.setItem(SESSION_TOKEN_KEY, token)
  sessionStorage.setItem(SESSION_AGENT_KEY, agentId)
  useAuthStore.getState().setSession(token, agentId)
}

export function clearSessionStorage(): void {
  sessionStorage.removeItem(SESSION_TOKEN_KEY)
  sessionStorage.removeItem(SESSION_AGENT_KEY)
  useAuthStore.getState().clearSession()
}

function startPermanentListener(): void {
  if (listenerStarted || typeof BroadcastChannel === 'undefined') {
    return
  }
  listenerStarted = true
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<AuthSyncMessage>) => {
    const msg = event.data
    if (msg.type !== 'REQUEST_AUTH_TOKEN') {
      return
    }
    const session = readSession()
    if (session) {
      channel?.postMessage({
        type: 'PROVIDE_AUTH_TOKEN',
        token: session.token,
        agentId: session.agentId,
      } satisfies AuthSyncMessage)
    }
  }
}

export function initAuthSync(): Promise<{ token: string; agentId: string } | null> {
  startPermanentListener()

  const existing = readSession()
  if (existing) {
    useAuthStore.getState().setSession(existing.token, existing.agentId)
    return Promise.resolve(existing)
  }

  if (!channel) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let settled = false

    const onMessage = (event: MessageEvent<AuthSyncMessage>) => {
      const msg = event.data
      if (msg.type !== 'PROVIDE_AUTH_TOKEN' || settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      channel?.removeEventListener('message', onMessage)
      writeSession(msg.token, msg.agentId)
      resolve({ token: msg.token, agentId: msg.agentId })
    }

    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      channel?.removeEventListener('message', onMessage)
      resolve(null)
    }, SYNC_TIMEOUT_MS)

    if (!channel) {
      settled = true
      clearTimeout(timer)
      resolve(null)
      return
    }

    channel.addEventListener('message', onMessage)
    channel.postMessage({ type: 'REQUEST_AUTH_TOKEN' } satisfies AuthSyncMessage)
  })
}
