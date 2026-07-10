import { useAuth, useClerk } from '@clerk/clerk-react'
import { Monitor, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { getPairedAgentsFromUser, removePairedAgent } from '@/lib/clerk-client'
import { useMobileStore } from '@/stores/mobileStore'

const REST_URL = import.meta.env.VITE_REST_URL

function platformLabel(platform: string): string {
  switch (platform) {
    case 'windows':
      return 'Windows'
    case 'macos':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

function isAgentOnline(lastSeen: string): boolean {
  const seen = new Date(lastSeen).getTime()
  if (Number.isNaN(seen)) {
    return false
  }
  return Date.now() - seen < 5 * 60 * 1000
}

export function MobileAgentsPage() {
  const navigate = useNavigate()
  const { signOut, user } = useClerk()
  const { getToken } = useAuth()
  const pairedAgents = useMobileStore((s) => s.pairedAgents)
  const setPairedAgents = useMobileStore((s) => s.setPairedAgents)
  const setClerkUserId = useMobileStore((s) => s.setClerkUserId)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      return
    }
    setClerkUserId(user.id)
    const agents = getPairedAgentsFromUser(user)
    if (agents.length > 0) {
      setPairedAgents(agents)
    }
  }, [user, setClerkUserId, setPairedAgents])

  const handleRevoke = useCallback(
    async (agentId: string) => {
      if (!user) {
        return
      }
      setRevokingId(agentId)
      setError(null)
      try {
        const clerkJwt = await getToken()
        if (!clerkJwt) {
          throw new Error('Not authenticated')
        }
        const response = await fetch(`${REST_URL}/agents/${encodeURIComponent(agentId)}/revoke`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${clerkJwt}` },
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'Revoke failed')
        }
        const updated = await removePairedAgent(user, agentId)
        setPairedAgents(updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Revoke failed')
      } finally {
        setRevokingId(null)
      }
    },
    [getToken, setPairedAgents, user],
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold text-primary">TabbyWebRTC</h1>
        <Button
          variant="ghost"
          className="min-h-11 min-w-11"
          onClick={() => signOut(() => navigate('/'))}
        >
          Sign out
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="mb-4 text-base font-medium text-textPrimary">Your Machines</h2>

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        {pairedAgents.length === 0 ? (
          <p className="text-sm text-textMuted">No paired machines yet.</p>
        ) : (
          <ul className="space-y-3">
            {pairedAgents.map((agent) => {
              const online = isAgentOnline(agent.lastSeen)
              return (
                <li
                  key={agent.agentId}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <Monitor className="h-6 w-6 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-textPrimary">{agent.name}</span>
                      <span
                        className={`text-xs ${online ? 'text-green-500' : 'text-textMuted'}`}
                      >
                        {online ? '● Online' : '○ Offline'}
                      </span>
                    </div>
                    <p className="text-sm text-textMuted">{platformLabel(agent.platform)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    className="min-h-11 shrink-0 text-destructive"
                    disabled={revokingId === agent.agentId}
                    onClick={() => void handleRevoke(agent.agentId)}
                  >
                    {revokingId === agent.agentId ? 'Revoking…' : 'Revoke'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => navigate('/scan?mode=pair')}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card p-4 text-textPrimary"
        >
          <Plus className="h-5 w-5 text-primary" />
          Pair a new machine
        </button>
      </div>

      <div className="border-t border-border p-4">
        <Button asChild className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90">
          <Link to="/scan">Scan QR to connect</Link>
        </Button>
      </div>
    </div>
  )
}
