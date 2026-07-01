import { ChevronDown, LogOut, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { clearSessionStorage } from '@/lib/auth-sync'
import { useAuthStore } from '@/stores/authStore'
import { useStreamStore } from '@/stores/streamStore'
import { useConnectionStats, type ConnectionPath } from '@/components/layout/useConnectionStats'
import { cn } from '@/lib/utils'

const REST_URL = import.meta.env.VITE_REST_URL

interface AgentListItem {
  id: string
  name: string
  platform: string
  online: boolean
}

export interface TopBarProps {
  peerConnection?: RTCPeerConnection | null
  onAgentSwitch?: () => void
}

function pathBadgeVariant(path: ConnectionPath): 'success' | 'default' | 'secondary' {
  if (path === 'lan') {
    return 'success'
  }
  if (path === 'wan') {
    return 'default'
  }
  return 'secondary'
}

function pathLabel(path: ConnectionPath): string {
  if (path === 'lan') {
    return 'LAN'
  }
  if (path === 'wan') {
    return 'WAN'
  }
  return '—'
}

export function TopBar({ peerConnection = null, onAgentSwitch }: TopBarProps) {
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)
  const agentId = useAuthStore((s) => s.agentId)
  const releaseStream = useStreamStore((s) => s.releaseStream)
  const activeStreams = useStreamStore((s) => s.activeStreams)

  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const avatarMenuRef = useRef<HTMLDivElement>(null)

  const { latencyMs, path } = useConnectionStats(peerConnection)

  const currentAgent = agents.find((a) => a.id === agentId)

  useEffect(() => {
    if (!token) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`${REST_URL}/agents`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok || cancelled) {
          return
        }
        const data = (await response.json()) as { agents: AgentListItem[] }
        if (!cancelled) {
          setAgents(data.agents)
        }
      } catch {
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(event.target as Node)) {
        setAgentMenuOpen(false)
      }
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target as Node)) {
        setAvatarMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleAgentSelect = useCallback(
    (selectedId: string) => {
      setAgentMenuOpen(false)
      if (selectedId === agentId) {
        return
      }
      Object.keys(activeStreams).forEach((sourceId) => releaseStream(sourceId))
      onAgentSwitch?.()
      navigate('/')
    },
    [activeStreams, agentId, navigate, onAgentSwitch, releaseStream],
  )

  const handleSignOut = useCallback(() => {
    Object.keys(activeStreams).forEach((sourceId) => releaseStream(sourceId))
    clearSessionStorage()
    navigate('/')
  }, [activeStreams, navigate, releaseStream])

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-4">
        <span className="text-lg font-bold text-primary">TabbyWebRTC</span>

        <div className="relative" ref={agentMenuRef}>
          <button
            type="button"
            onClick={() => setAgentMenuOpen((open) => !open)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-textPrimary hover:bg-surfaceHigh"
          >
            Agent: {currentAgent?.name ?? agentId ?? 'Unknown'}
            <ChevronDown className="h-4 w-4 text-textMuted" />
          </button>
          {agentMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-border bg-surfaceHigh py-1 shadow-lg">
              {agents.length === 0 && (
                <p className="px-3 py-2 text-sm text-textMuted">No agents found</p>
              )}
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => handleAgentSelect(agent.id)}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background',
                    agent.id === agentId && 'text-primary',
                  )}
                >
                  <span>{agent.name}</span>
                  <span className={cn('text-xs', agent.online ? 'text-success' : 'text-textMuted')}>
                    {agent.online ? 'Online' : 'Offline'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant={pathBadgeVariant(path)}>{pathLabel(path)}</Badge>
        <span className="text-sm text-textMuted">
          {latencyMs !== null ? `${latencyMs} ms` : '— ms'}
        </span>

        <div className="relative" ref={avatarMenuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAvatarMenuOpen((open) => !open)}
            title="Account menu"
          >
            <User />
          </Button>
          {avatarMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-36 rounded-md border border-border bg-surfaceHigh py-1 shadow-lg">
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-textPrimary hover:bg-background"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
