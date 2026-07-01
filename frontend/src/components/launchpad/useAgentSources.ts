import { useCallback, useEffect, useState } from 'react'
import { signalClient } from '@/lib/signal-client'
import { useAgentStore } from '@/stores/agentStore'
import type { AppWindow, Display } from '@/types/agent'

const LOCAL_ENDPOINT_KEY = 'tabbywebrtc_local_endpoint'
const SOURCE_POLL_MS = 30_000

interface SourceView {
  id: string
  name: string
  width: number
  height: number
}

interface SourcesResponse {
  displays: SourceView[]
  apps: SourceView[]
}

function mapSources(
  displays: SourceView[],
  apps: SourceView[],
  previous: { displays: Display[]; apps: AppWindow[] },
): { displays: Display[]; apps: AppWindow[] } {
  const prevDisplayMap = new Map(previous.displays.map((d) => [d.id, d]))
  const prevAppMap = new Map(previous.apps.map((a) => [a.id, a]))

  return {
    displays: displays.map((d) => {
      const prev = prevDisplayMap.get(d.id)
      return {
        id: d.id,
        name: d.name,
        width: d.width,
        height: d.height,
        thumbnailUrl: prev?.thumbnailUrl ?? null,
        inUse: prev?.inUse ?? false,
      }
    }),
    apps: apps.map((a) => {
      const prev = prevAppMap.get(a.id)
      return {
        id: a.id,
        name: a.name,
        pid: prev?.pid ?? 0,
        thumbnailUrl: prev?.thumbnailUrl ?? null,
        inUse: prev?.inUse ?? false,
      }
    }),
  }
}

async function probeLocalAgent(baseUrl: string, agentId: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const response = await fetch(`${baseUrl}/info`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) {
      return false
    }
    const info = (await response.json()) as { agentId?: string }
    return info.agentId === agentId
  } catch {
    return false
  }
}

async function resolveAgentBaseUrl(agentId: string): Promise<string | null> {
  const stored = sessionStorage.getItem(LOCAL_ENDPOINT_KEY)
  if (stored && (await probeLocalAgent(stored, agentId))) {
    return stored
  }

  const candidates = ['http://127.0.0.1:7700', 'http://localhost:7700']
  for (const url of candidates) {
    if (await probeLocalAgent(url, agentId)) {
      sessionStorage.setItem(LOCAL_ENDPOINT_KEY, url)
      return url
    }
  }
  return null
}

async function fetchLocalSources(baseUrl: string, token: string): Promise<SourcesResponse | null> {
  try {
    const response = await fetch(`${baseUrl}/sources`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as SourcesResponse
  } catch {
    return null
  }
}

export function useAgentSources(token: string | null, agentId: string | null): {
  loading: boolean
  agentOnline: boolean
  refresh: () => void
} {
  const setDisplays = useAgentStore((s) => s.setDisplays)
  const setApps = useAgentStore((s) => s.setApps)
  const setAgentBaseUrl = useAgentStore((s) => s.setAgentBaseUrl)
  const [loading, setLoading] = useState(true)
  const [agentOnline, setAgentOnline] = useState(true)

  const applySources = useCallback(
    (displays: SourceView[], apps: SourceView[], localEndpoint?: string) => {
      const state = useAgentStore.getState()
      const mapped = mapSources(displays, apps, state)
      setDisplays(mapped.displays)
      setApps(mapped.apps)
      if (localEndpoint) {
        sessionStorage.setItem(LOCAL_ENDPOINT_KEY, localEndpoint)
        setAgentBaseUrl(localEndpoint)
      }
      setAgentOnline(true)
    },
    [setAgentBaseUrl, setApps, setDisplays],
  )

  const loadSources = useCallback(async () => {
    if (!token || !agentId) {
      setLoading(false)
      return
    }

    setLoading(true)

    const baseUrl = await resolveAgentBaseUrl(agentId)
    if (baseUrl) {
      setAgentBaseUrl(baseUrl)
      const local = await fetchLocalSources(baseUrl, token)
      if (local) {
        applySources(local.displays, local.apps, baseUrl)
        setLoading(false)
        return
      }
    }

    signalClient.send({ type: 'REQUEST_SOURCES', agentId } as never)

    const state = useAgentStore.getState()
    if (state.displays.length === 0 && state.apps.length === 0) {
      setAgentOnline(false)
    }
    setLoading(false)
  }, [agentId, applySources, setAgentBaseUrl, token])

  useEffect(() => {
    if (!token || !agentId) {
      return
    }

    if (!signalClient.isConnected) {
      signalClient.connect()
    }

    const unsub = signalClient.subscribe((message) => {
      const raw = message as { type: string; displays?: SourceView[]; apps?: SourceView[]; localEndpoint?: string }
      if (raw.type === 'AGENT_SOURCES' && raw.displays && raw.apps) {
        applySources(raw.displays, raw.apps, raw.localEndpoint)
        return
      }
      if (raw.type === 'AGENT_OFFLINE') {
        setAgentOnline(false)
      }
    })

    void loadSources()
    const interval = setInterval(() => void loadSources(), SOURCE_POLL_MS)

    return () => {
      unsub()
      clearInterval(interval)
    }
  }, [agentId, applySources, loadSources, token])

  return { loading, agentOnline, refresh: loadSources }
}
