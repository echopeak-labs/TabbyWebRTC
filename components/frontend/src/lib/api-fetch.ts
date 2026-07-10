import { clearSessionStorage } from '@/lib/auth-sync'
import { clearTurnCredentialsCache } from '@/lib/webrtc'
import { signalClient } from '@/lib/signal-client'

let navigatingToConnect = false

export function forceSessionExpiry(navigate?: (path: string) => void): void {
  if (navigatingToConnect) {
    return
  }
  navigatingToConnect = true
  clearTurnCredentialsCache()
  clearSessionStorage()
  signalClient.disconnect()
  if (navigate) {
    navigate('/')
  } else if (typeof window !== 'undefined') {
    window.location.assign('/')
  }
  setTimeout(() => {
    navigatingToConnect = false
  }, 500)
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { navigate?: (path: string) => void; clearOn401?: boolean },
): Promise<Response> {
  const response = await fetch(input, init)
  const clearOn401 = options?.clearOn401 ?? true
  if (response.status === 401 && clearOn401) {
    forceSessionExpiry(options?.navigate)
  }
  return response
}
