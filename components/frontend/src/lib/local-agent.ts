export const LOCAL_ENDPOINT_KEY = 'tabbywebrtc_local_endpoint'
const REMEMBERED_HOSTS_KEY = 'tabbywebrtc_remembered_hosts'

export interface AgentInfo {
  agentId?: string
  name?: string
  platform?: string
  localToken: string
  baseUrl: string
}

export async function probeAgentInfo(baseUrl: string): Promise<AgentInfo | null> {
  try {
    const normalized = normalizeAgentBaseUrl(baseUrl)
    if (!normalized) {
      return null
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 900)
    const response = await fetch(`${normalized}/info`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) {
      return null
    }
    const info = (await response.json()) as {
      agentId?: string
      agent_id?: string
      name?: string
      platform?: string
      localToken?: string
      local_token?: string
    }
    const localToken = info.localToken ?? info.local_token
    if (!localToken) {
      return null
    }
    return {
      agentId: info.agentId ?? info.agent_id,
      name: info.name,
      platform: info.platform,
      localToken,
      baseUrl: normalized,
    }
  } catch {
    return null
  }
}

export function storeLocalEndpoint(baseUrl: string): void {
  const normalized = normalizeAgentBaseUrl(baseUrl)
  if (!normalized) {
    return
  }
  sessionStorage.setItem(LOCAL_ENDPOINT_KEY, normalized)
  try {
    const url = new URL(normalized)
    if (url.pathname.replace(/\/$/, '') === '/local-agent') {
      return
    }
  } catch {
    return
  }
  rememberHost(normalized)
}

export function normalizeAgentBaseUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`)
    const pageHost = typeof window !== 'undefined' ? window.location.hostname : ''
    const pageIsLoopback = pageHost === 'localhost' || pageHost === '127.0.0.1'
    const targetIsLoopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    const targetIsUnspecified =
      url.hostname === '0.0.0.0' || url.hostname === '::' || url.hostname === '[::]'

    if (targetIsUnspecified || (targetIsLoopback && !pageIsLoopback)) {
      if (!pageHost || pageIsLoopback) {
        if (targetIsUnspecified) {
          return null
        }
      } else {
        url.hostname = pageHost
      }
    }

    if (!pageIsLoopback && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return null
    }

    const path = url.pathname.replace(/\/$/, '')
    if (path && path !== '/local-agent' && !path.startsWith('/local-agent/')) {
      url.pathname = ''
    } else if (path === '/local-agent' || path.startsWith('/local-agent/')) {
      url.pathname = '/local-agent'
    } else {
      url.pathname = ''
    }
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function localAgentBaseUrlCandidates(preferred?: string | null): string[] {
  const pageHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const pageIsLoopback = pageHost === 'localhost' || pageHost === '127.0.0.1'
  const sameOriginProxy =
    typeof window !== 'undefined' ? `${window.location.origin}/local-agent` : null
  const sameHost =
    pageHost && !pageIsLoopback
      ? `http://${pageHost}:7700`
      : pageIsLoopback
        ? 'http://127.0.0.1:7700'
        : null
  const loopback = pageIsLoopback ? ['http://127.0.0.1:7700', 'http://localhost:7700'] : []

  return [sameOriginProxy, preferred, readStoredLocalEndpoint(), sameHost, ...loopback]
    .map((value) => (value ? normalizeAgentBaseUrl(value) : null))
    .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)
}

export async function resolveReachableLocalAgent(
  agentId: string | null,
  preferred?: string | null,
): Promise<AgentInfo | null> {
  for (const url of localAgentBaseUrlCandidates(preferred)) {
    const info = await probeAgentInfo(url)
    if (!info) {
      continue
    }
    if (agentId && info.agentId && info.agentId !== agentId) {
      continue
    }
    storeLocalEndpoint(info.baseUrl)
    return info
  }
  return null
}

export function readStoredLocalEndpoint(): string | null {
  const raw = sessionStorage.getItem(LOCAL_ENDPOINT_KEY)
  if (!raw) {
    return null
  }
  const normalized = normalizeAgentBaseUrl(raw)
  if (!normalized) {
    sessionStorage.removeItem(LOCAL_ENDPOINT_KEY)
    return null
  }
  if (normalized !== raw) {
    sessionStorage.setItem(LOCAL_ENDPOINT_KEY, normalized)
  }
  return normalized
}

function rememberHost(baseUrl: string): void {
  try {
    const host = new URL(baseUrl).host
    const existing = readRememberedHosts().filter((item) => item !== host)
    const next = [host, ...existing].slice(0, 8)
    localStorage.setItem(REMEMBERED_HOSTS_KEY, JSON.stringify(next))
  } catch {
  }
}

export function readRememberedHosts(): string[] {
  try {
    const raw = localStorage.getItem(REMEMBERED_HOSTS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

async function discoverLocalIpv4(): Promise<string | null> {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] })
    pc.createDataChannel('lan')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const ip = await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 1200)
      pc.onicecandidate = (event) => {
        const candidate = event.candidate?.candidate
        if (!candidate) {
          return
        }
        const match = / ([0-9]{1,3}(?:\.[0-9]{1,3}){3}) /.exec(candidate)
        const found = match?.[1]
        if (found && !found.startsWith('127.')) {
          window.clearTimeout(timer)
          resolve(found)
        }
      }
    })
    pc.close()
    return ip
  } catch {
    return null
  }
}

function subnetHosts(ipv4: string): string[] {
  const parts = ipv4.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return []
  }
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`
  const hosts: string[] = []
  for (let i = 1; i <= 254; i++) {
    if (i === parts[3]) {
      continue
    }
    hosts.push(`${prefix}.${i}`)
  }
  return hosts
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function run(): Promise<void> {
    while (index < items.length) {
      const current = items[index++]
      if (current === undefined) {
        return
      }
      const value = await worker(current)
      if (value) {
        results.push(value)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

export async function discoverLanAgents(options?: {
  onProgress?: (found: AgentInfo[]) => void
  signal?: AbortSignal
}): Promise<AgentInfo[]> {
  const found = new Map<string, AgentInfo>()

  const publish = (info: AgentInfo) => {
    const key = info.agentId ?? info.baseUrl
    if (!found.has(key)) {
      found.set(key, info)
      options?.onProgress?.([...found.values()])
    }
  }

  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const loopback =
    host === 'localhost' || host === '127.0.0.1'
      ? ['http://127.0.0.1:7700', 'http://localhost:7700']
      : []
  const seedUrls = [
    ...readRememberedHosts().map((hostName) =>
      hostName.includes('://') ? hostName.replace(/\/$/, '') : `http://${hostName}`,
    ),
    readStoredLocalEndpoint(),
    host && host !== 'localhost' && host !== '127.0.0.1' ? `http://${host}:7700` : null,
    ...loopback,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)

  for (const url of seedUrls) {
    if (options?.signal?.aborted) {
      break
    }
    const info = await probeAgentInfo(url.includes('://') ? url : `http://${url}`)
    if (info) {
      publish(info)
    }
  }

  const localIp = await discoverLocalIpv4()
  if (!localIp || options?.signal?.aborted) {
    return [...found.values()]
  }

  const hosts = subnetHosts(localIp)
  await mapPool(hosts, 40, async (host) => {
    if (options?.signal?.aborted) {
      return null
    }
    const info = await probeAgentInfo(`http://${host}:7700`)
    if (info) {
      publish(info)
    }
    return info
  })

  return [...found.values()]
}
