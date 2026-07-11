import { useEffect } from 'react'
import { resolveReachableLocalAgent } from '@/lib/local-agent'
import { useAgentStore } from '@/stores/agentStore'
import { useAuthStore } from '@/stores/authStore'

const POLL_INTERVAL_MS = 15_000

interface ThumbnailView {
  id: string
  jpeg_base64?: string
  jpegBase64?: string
}

async function fetchAllThumbnails(
  baseUrl: string,
  localToken: string,
): Promise<ThumbnailView[] | null> {
  try {
    const response = await fetch(`${baseUrl}/thumbnails`, {
      headers: { Authorization: `Bearer ${localToken}` },
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as { thumbnails?: ThumbnailView[] }
    return Array.isArray(data.thumbnails) ? data.thumbnails : null
  } catch {
    return null
  }
}

export function useThumbnailPoller(_sessionToken: string | null): void {
  const displays = useAgentStore((s) => s.displays)
  const apps = useAgentStore((s) => s.apps)
  const setThumbnail = useAgentStore((s) => s.setThumbnail)
  const setAgentBaseUrl = useAgentStore((s) => s.setAgentBaseUrl)
  const setLocalToken = useAgentStore((s) => s.setLocalToken)
  const agentId = useAuthStore((s) => s.agentId)

  const sourceKey = [
    ...displays.map((d) => d.id),
    ...apps.map((a) => a.id),
  ].join(',')

  useEffect(() => {
    if (!sourceKey) {
      return
    }

    let cancelled = false

    const poll = async () => {
      const preferred = useAgentStore.getState().agentBaseUrl
      const info = await resolveReachableLocalAgent(agentId, preferred)
      if (cancelled || !info) {
        return
      }

      setAgentBaseUrl(info.baseUrl)
      setLocalToken(info.localToken)

      const thumbnails = await fetchAllThumbnails(info.baseUrl, info.localToken)
      if (cancelled || !thumbnails) {
        return
      }

      for (const item of thumbnails) {
        const jpeg = item.jpeg_base64 ?? item.jpegBase64
        if (!jpeg) {
          continue
        }
        const nextUrl = `data:image/jpeg;base64,${jpeg}`
        const prev = [
          ...useAgentStore.getState().displays,
          ...useAgentStore.getState().apps,
        ].find((s) => s.id === item.id)?.thumbnailUrl
        setThumbnail(item.id, nextUrl)
        if (prev?.startsWith('blob:')) {
          URL.revokeObjectURL(prev)
        }
      }
    }

    void poll()
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [agentId, setAgentBaseUrl, setLocalToken, setThumbnail, sourceKey])
}
