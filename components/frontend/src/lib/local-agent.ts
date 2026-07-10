export const LOCAL_ENDPOINT_KEY = 'tabbywebrtc_local_endpoint'

export async function probeAgentInfo(
  baseUrl: string,
): Promise<{ agentId?: string; localToken: string } | null> {
  try {
    const normalized = baseUrl.replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const response = await fetch(`${normalized}/info`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) {
      return null
    }
    const info = (await response.json()) as {
      agentId?: string
      agent_id?: string
      localToken?: string
      local_token?: string
    }
    const localToken = info.localToken ?? info.local_token
    if (!localToken) {
      return null
    }
    return {
      agentId: info.agentId ?? info.agent_id,
      localToken,
    }
  } catch {
    return null
  }
}

export function storeLocalEndpoint(baseUrl: string): void {
  sessionStorage.setItem(LOCAL_ENDPOINT_KEY, baseUrl.replace(/\/$/, ''))
}

export function readStoredLocalEndpoint(): string | null {
  return sessionStorage.getItem(LOCAL_ENDPOINT_KEY)
}
