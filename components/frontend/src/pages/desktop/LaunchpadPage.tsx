import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppCard } from '@/components/launchpad/AppCard'
import { DisplayCard } from '@/components/launchpad/DisplayCard'
import { useAgentSources } from '@/components/launchpad/useAgentSources'
import { TopBar } from '@/components/layout/TopBar'
import { useThumbnailPoller } from '@/hooks/useThumbnailPoller'
import { useSourceLockListener } from '@/hooks/useSourceLockListener'
import { useAgentStore } from '@/stores/agentStore'
import { useAuthStore } from '@/stores/authStore'

export function LaunchpadPage() {
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)
  const agentId = useAuthStore((s) => s.agentId)
  const displays = useAgentStore((s) => s.displays)
  const apps = useAgentStore((s) => s.apps)
  const setDisplays = useAgentStore((s) => s.setDisplays)
  const setApps = useAgentStore((s) => s.setApps)
  const setAgentBaseUrl = useAgentStore((s) => s.setAgentBaseUrl)

  const [navigatingId, setNavigatingId] = useState<string | null>(null)

  const { loading, agentOnline, refresh } = useAgentSources(token, agentId)
  useThumbnailPoller(token)
  useSourceLockListener()

  const handleSourceClick = useCallback(
    (sourceId: string) => {
      setNavigatingId(sourceId)
      navigate(`/stream/${sourceId}`)
    },
    [navigate],
  )

  const handleAgentSwitch = useCallback(() => {
    setDisplays([])
    setApps([])
    setAgentBaseUrl(null)
    refresh()
  }, [refresh, setAgentBaseUrl, setApps, setDisplays])

  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar onAgentSwitch={handleAgentSwitch} />

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-4">
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-textMuted">
              Displays
            </h2>
            {loading && displays.length === 0 ? (
              <p className="text-sm text-textMuted">Loading displays…</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {displays.map((display) => (
                  <DisplayCard
                    key={display.id}
                    display={display}
                    offline={!agentOnline}
                    loading={navigatingId === display.id}
                    onClick={handleSourceClick}
                  />
                ))}
                {!loading && displays.length === 0 && (
                  <p className="text-sm text-textMuted">No displays available</p>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-textMuted">
              Applications
            </h2>
            {loading && apps.length === 0 ? (
              <p className="text-sm text-textMuted">Loading applications…</p>
            ) : (
              <div className="flex flex-col gap-4">
                {apps.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    offline={!agentOnline}
                    loading={navigatingId === app.id}
                    onClick={handleSourceClick}
                  />
                ))}
                {!loading && apps.length === 0 && (
                  <p className="text-sm text-textMuted">No applications available</p>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
