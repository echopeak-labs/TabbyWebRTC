import { useCallback, useEffect, useState } from 'react'
import {
  probeAgentInfo,
  readStoredLocalEndpoint,
  storeLocalEndpoint,
} from '@/lib/local-agent'
import { signalClient } from '@/lib/signal-client'
import { useAgentStore } from '@/stores/agentStore'
import type { AppWindow, Display } from '@/types/agent'

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

interface LocalProbeResult {
  baseUrl: string
  localToken: string
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

async function probeLocalAgent(baseUrl: string, agentId: string): Promise<LocalProbeResult | null> {
  const info = await probeAgentInfo(baseUrl)
  if (!info || info.agentId !== agentId) {
    return null
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), localToken: info.localToken }
}

async function resolveLocalAgent(agentId: string): Promise<LocalProbeResult | null> {
  const stored = readStoredLocalEndpoint()
  if (stored) {
    const probed = await probeLocalAgent(stored, agentId)
    if (probed) {
      return probed
    }
  }

  const candidates = ['http://127.0.0.1:7700', 'http://localhost:7700']
  for (const url of candidates) {
    const probed = await probeLocalAgent(url, agentId)
    if (probed) {
      storeLocalEndpoint(url)
      return probed
    }
  }
  return null
}

async function fetchLocalSources(
  baseUrl: string,
  localToken: string,
): Promise<SourcesResponse | null> {
  try {
    const response = await fetch(`${baseUrl}/sources`, {
      headers: { Authorization: `Bearer ${localToken}` },
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
  const setLocalToken = useAgentStore((s) => s.setLocalToken)
  const [loading, setLoading] = useState(true)
  const [agentOnline, setAgentOnline] = useState(true)

  const applySources = useCallback(
    (displays: SourceView[], apps: SourceView[], localEndpoint?: string) => {
      const state = useAgentStore.getState()
      const mapped = mapSources(displays, apps, state)
      setDisplays(mapped.displays)
      setApps(mapped.apps)
      if (localEndpoint) {
        storeLocalEndpoint(localEndpoint)
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

    const local = await resolveLocalAgent(agentId)
    if (local) {
      setAgentBaseUrl(local.baseUrl)
      setLocalToken(local.localToken)
      const sources = await fetchLocalSources(local.baseUrl, local.localToken)
      if (sources) {
        applySources(sources.displays, sources.apps, local.baseUrl)
        setLoading(false)
        return
      }
    } else {
      setLocalToken(null)
    }

    signalClient.send({ type: 'REQUEST_SOURCES', agentId })

    const state = useAgentStore.getState()
    if (state.displays.length === 0 && state.apps.length === 0) {
      setAgentOnline(false)
    }
    setLoading(false)
  }, [agentId, applySources, setAgentBaseUrl, setLocalToken, token])

  useEffect(() => {
    if (!token || !agentId) {
      return
    }

    if (!signalClient.isConnected) {
      signalClient.connect()
    }

    const unsub = signalClient.subscribe((message) => {
      const raw = message as {
        type: string
        displays?: SourceView[]
        apps?: SourceView[]
        localEndpoint?: string
      }
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
