import { useEffect } from 'react'
import { useAgentStore } from '@/stores/agentStore'

const POLL_INTERVAL_MS = 300_000

async function fetchThumbnail(
  baseUrl: string,
  sourceId: string,
  localToken: string,
): Promise<string | null> {
  const url = `${baseUrl}/thumbnail/${sourceId}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${localToken}` },
  })

  if (!response.ok) {
    return null
  }

  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export function useThumbnailPoller(_sessionToken: string | null): void {
  const agentBaseUrl = useAgentStore((s) => s.agentBaseUrl)
  const localToken = useAgentStore((s) => s.localToken)
  const displays = useAgentStore((s) => s.displays)
  const apps = useAgentStore((s) => s.apps)
  const setThumbnail = useAgentStore((s) => s.setThumbnail)

  useEffect(() => {
    if (!localToken || !agentBaseUrl) {
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
        const url = await fetchThumbnail(agentBaseUrl, sourceId, localToken)
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
  }, [agentBaseUrl, apps, displays, localToken, setThumbnail])
}
