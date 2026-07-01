import { useEffect } from 'react'
import { useAgentStore } from '@/stores/agentStore'

const POLL_INTERVAL_MS = 300_000

async function fetchThumbnail(
  baseUrl: string,
  sourceId: string,
  token: string,
): Promise<string | null> {
  const url = `${baseUrl}/thumbnail/${sourceId}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    return null
  }

  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export function useThumbnailPoller(token: string | null): void {
  const agentBaseUrl = useAgentStore((s) => s.agentBaseUrl)
  const displays = useAgentStore((s) => s.displays)
  const apps = useAgentStore((s) => s.apps)
  const setThumbnail = useAgentStore((s) => s.setThumbnail)

  useEffect(() => {
    if (!token || !agentBaseUrl) {
      return
    }

    const sourceIds = [...displays.map((d) => d.id), ...apps.map((a) => a.id)]
    if (sourceIds.length === 0) {
      return
    }

    let cancelled = false

    const poll = async () => {
      for (const sourceId of sourceIds) {
        if (cancelled) return
        const url = await fetchThumbnail(agentBaseUrl, sourceId, token)
        if (url && !cancelled) {
          setThumbnail(sourceId, url)
        }
      }
    }

    void poll()
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [agentBaseUrl, apps, displays, setThumbnail, token])
}
