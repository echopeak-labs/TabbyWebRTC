import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { writeSession } from '@/lib/auth-sync'
import {
  discoverLanAgents,
  probeAgentInfo,
  readStoredLocalEndpoint,
  storeLocalEndpoint,
  type AgentInfo,
} from '@/lib/local-agent'
import { signalClient } from '@/lib/signal-client'
import type { SessionQRPayload } from '@/types/auth'
import { cn } from '@/lib/utils'

const WS_URL = import.meta.env.VITE_WS_URL
const REFRESH_INTERVAL_S = 28

type ConnectStatus = 'idle' | 'waiting' | 'authorized' | 'loading'

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const radius = 118
  const stroke = 3
  const normalizedRadius = radius - stroke
  const circumference = normalizedRadius * 2 * Math.PI
  const progress = Math.max(0, Math.min(1, seconds / total))
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 256 256">
      <circle
        cx="128"
        cy="128"
        r={normalizedRadius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-border/70"
      />
      <circle
        cx="128"
        cy="128"
        r={normalizedRadius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        className="text-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  )
}

export function ConnectPage() {
  const navigate = useNavigate()
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const authorizedRef = useRef(false)
  const discoverAbortRef = useRef<AbortController | null>(null)

  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [expiresIn, setExpiresIn] = useState(30)
  const [countdown, setCountdown] = useState(30)
  const [status, setStatus] = useState<ConnectStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [qrFlash, setQrFlash] = useState(false)
  const [lanAgents, setLanAgents] = useState<AgentInfo[]>([])
  const [selectedLan, setSelectedLan] = useState<AgentInfo | null>(null)
  const [scanningLan, setScanningLan] = useState(false)
  const [manualHost, setManualHost] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)

  const qrPayload = useMemo((): SessionQRPayload | null => {
    if (!pendingSessionId) {
      return null
    }
    return {
      pendingSessionId,
      signalingUrl: WS_URL,
      version: 1,
    }
  }, [pendingSessionId])

  const qrValue = qrPayload ? JSON.stringify(qrPayload) : ''

  const clearTimers = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
  }, [])

  const startCountdown = useCallback(
    (ttl: number) => {
      setExpiresIn(ttl)
      setCountdown(ttl)
      clearTimers()
      countdownTimerRef.current = setInterval(() => {
        setCountdown((prev) => Math.max(0, prev - 1))
      }, 1000)
      refreshTimerRef.current = setInterval(() => {
        signalClient.refreshSession()
      }, REFRESH_INTERVAL_S * 1000)
    },
    [clearTimers],
  )

  const applyLanAgent = useCallback((agent: AgentInfo) => {
    storeLocalEndpoint(agent.baseUrl)
    setSelectedLan(agent)
    setLanAgents((prev) => {
      const key = agent.agentId ?? agent.baseUrl
      if (prev.some((item) => (item.agentId ?? item.baseUrl) === key)) {
        return prev
      }
      return [agent, ...prev]
    })
  }, [])

  const runLanDiscovery = useCallback(async () => {
    discoverAbortRef.current?.abort()
    const controller = new AbortController()
    discoverAbortRef.current = controller
    setScanningLan(true)
    try {
      const agents = await discoverLanAgents({
        signal: controller.signal,
        onProgress: (found) => {
          setLanAgents(found)
          setSelectedLan((current) => current ?? found[0] ?? null)
          if (found[0] && !readStoredLocalEndpoint()) {
            storeLocalEndpoint(found[0].baseUrl)
          }
        },
      })
      setLanAgents(agents)
      setSelectedLan((current) => {
        if (current) {
          return current
        }
        const first = agents[0]
        if (first) {
          storeLocalEndpoint(first.baseUrl)
          return first
        }
        return null
      })
    } finally {
      if (!controller.signal.aborted) {
        setScanningLan(false)
      }
    }
  }, [])

  useEffect(() => {
    signalClient.connect()

    const unsubscribe = signalClient.onMessage((message) => {
      switch (message.type) {
        case 'SESSION_PENDING':
          if (authorizedRef.current) {
            break
          }
          setPendingSessionId((prev) => {
            if (prev && prev !== message.pendingSessionId) {
              setQrFlash(true)
              window.setTimeout(() => setQrFlash(false), 1200)
            }
            return message.pendingSessionId
          })
          startCountdown(message.expiresIn)
          setStatus('waiting')
          setError(null)
          break
        case 'AUTH_APPROVED': {
          authorizedRef.current = true
          setStatus('authorized')
          clearTimers()
          writeSession(message.token, message.agentId)
          signalClient.bindSession(message.token)
          const endpoint = message.localEndpoint
          if (typeof endpoint === 'string') {
            storeLocalEndpoint(endpoint)
          } else if (endpoint && typeof endpoint.url === 'string') {
            storeLocalEndpoint(endpoint.url)
          }
          setTimeout(() => {
            setStatus('loading')
            navigate('/launchpad', { replace: true })
          }, 600)
          break
        }
        case 'SESSION_EXPIRED':
          if (authorizedRef.current) {
            break
          }
          setStatus('idle')
          setPendingSessionId(null)
          setError('Session expired — getting a fresh QR…')
          signalClient.refreshSession()
          break
        case 'ERROR':
          setError(message.message)
          break
      }
    })

    void runLanDiscovery()

    return () => {
      unsubscribe()
      clearTimers()
      discoverAbortRef.current?.abort()
    }
  }, [clearTimers, navigate, runLanDiscovery, startCountdown])

  const statusText = useMemo(() => {
    switch (status) {
      case 'waiting':
        return countdown <= 5
          ? 'Refreshing secure session…'
          : 'Waiting for phone approval…'
      case 'authorized':
      case 'loading':
        return 'Approved — opening launchpad…'
      default:
        return 'Connecting to signaling…'
    }
  }, [countdown, status])

  const handleManualConnect = async () => {
    setManualBusy(true)
    setManualError(null)
    try {
      const host = manualHost
        .trim()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.split(':')[0]
      if (!host) {
        throw new Error('Enter a valid IP or hostname')
      }
      const baseUrl = `http://${host}:7700`
      const info = await probeAgentInfo(baseUrl)
      if (!info) {
        throw new Error(`No agent reachable at ${baseUrl}. On the host, set http.bind = "0.0.0.0".`)
      }
      applyLanAgent(info)
      setShowManual(false)
      setManualHost('')
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Probe failed')
    } finally {
      setManualBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgb(232_163_23/0.18),transparent_55%),radial-gradient(ellipse_at_90%_20%,rgb(90_55_20/0.35),transparent_45%),linear-gradient(180deg,#120e0a_0%,#0c0b09_48%,#0a0907_100%)]"
      />
      <div
        aria-hidden
        className="animate-connect-breathe pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="animate-connect-breathe pointer-events-none absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-accent/40 blur-3xl [animation-delay:1.5s]"
      />

      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-center lg:gap-16 lg:px-10">
        <section className="animate-connect-rise max-w-xl flex-1">
          <p className="mb-3 text-sm font-medium tracking-[0.22em] text-primary uppercase">
            Desktop viewer
          </p>
          <h1
            className="text-5xl leading-[0.95] font-bold tracking-tight text-textPrimary sm:text-6xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            TabbyWebRTC
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-textMuted">
            Scan with your phone to authorize this browser. If the agent is on this Wi‑Fi,
            we prefer a direct LAN path automatically after approval.
          </p>

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 text-sm text-textMuted">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                1
              </span>
              Open TabbyWebRTC on your phone and scan the QR
            </div>
            <div className="flex items-center gap-3 text-sm text-textMuted">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                2
              </span>
              Approve the session for your paired machine
            </div>
            <div className="flex items-center gap-3 text-sm text-textMuted">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                3
              </span>
              Stream over LAN when an agent is found nearby
            </div>
          </div>

          <div className="mt-10 border-t border-border/80 pt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-textPrimary uppercase">
                On this network
              </h2>
              <button
                type="button"
                onClick={() => void runLanDiscovery()}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                disabled={scanningLan}
              >
                {scanningLan ? 'Scanning…' : 'Scan again'}
              </button>
            </div>

            {selectedLan ? (
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                <p className="text-sm font-medium text-textPrimary">
                  {selectedLan.name ?? 'Desktop agent'} ready on LAN
                </p>
                <p className="mt-1 text-xs text-textMuted">
                  {selectedLan.baseUrl.replace(/^https?:\/\//, '')}
                  {selectedLan.platform ? ` · ${selectedLan.platform}` : ''}
                </p>
                <p className="mt-2 text-xs text-textMuted">
                  After phone approval, sources and stream will use this local path when possible.
                </p>
              </div>
            ) : scanningLan ? (
              <p className="text-sm text-textMuted">Looking for agents on your Wi‑Fi…</p>
            ) : (
              <p className="text-sm text-textMuted">
                No agent found yet. Enter the host IP, or ensure the agent binds{' '}
                <code className="text-primary">0.0.0.0:7700</code>.
              </p>
            )}

            {lanAgents.length > 1 && (
              <ul className="mt-3 space-y-2">
                {lanAgents.map((agent) => {
                  const active =
                    (selectedLan?.agentId ?? selectedLan?.baseUrl) ===
                    (agent.agentId ?? agent.baseUrl)
                  return (
                    <li key={agent.agentId ?? agent.baseUrl}>
                      <button
                        type="button"
                        onClick={() => applyLanAgent(agent)}
                        className={cn(
                          'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                          active
                            ? 'border-primary/40 bg-primary/10 text-textPrimary'
                            : 'border-border bg-surface/60 text-textMuted hover:border-primary/30 hover:text-textPrimary',
                        )}
                      >
                        <span className="font-medium">{agent.name ?? 'Agent'}</span>
                        <span className="mt-0.5 block text-xs opacity-80">
                          {agent.baseUrl.replace(/^https?:\/\//, '')}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="mt-4">
              {!showManual ? (
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Enter agent IP manually
                </button>
              ) : (
                <div className="space-y-3 rounded-xl border border-border bg-surface/70 p-3">
                  <input
                    type="text"
                    value={manualHost}
                    onChange={(e) => setManualHost(e.target.value)}
                    placeholder="192.168.1.42"
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-textPrimary"
                  />
                  {manualError && <p className="text-xs text-destructive">{manualError}</p>}
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      className="flex-1"
                      onClick={() => {
                        setShowManual(false)
                        setManualError(null)
                      }}
                      disabled={manualBusy}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={() => void handleManualConnect()}
                      disabled={manualBusy || !manualHost.trim()}
                    >
                      {manualBusy ? 'Checking…' : 'Use this agent'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="animate-connect-rise flex flex-1 flex-col items-center [animation-delay:120ms]">
          <div
            className={cn(
              'relative flex h-[17.5rem] w-[17.5rem] items-center justify-center sm:h-[19rem] sm:w-[19rem]',
              qrFlash && 'animate-qr-pulse',
            )}
          >
            {pendingSessionId && <CountdownRing seconds={countdown} total={expiresIn} />}
            <div className="relative z-10 rounded-2xl bg-[#f7f1e6] p-3 shadow-[0_20px_60px_rgb(0_0_0/0.45)]">
              {qrValue ? (
                <QRCodeSVG value={qrValue} size={200} level="M" bgColor="#f7f1e6" fgColor="#140f08" />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center text-sm text-[#6f6454]">
                  Preparing QR…
                </div>
              )}
            </div>
          </div>

          <p
            className={cn(
              'mt-6 text-center text-sm font-medium',
              status === 'waiting' ? 'animate-pulse text-primary' : 'text-textMuted',
            )}
          >
            {statusText}
          </p>
          {pendingSessionId && (
            <p className="mt-2 text-center text-xs text-textMuted">
              Secure session refreshes every {REFRESH_INTERVAL_S}s · {countdown}s left
            </p>
          )}
          {error && <p className="mt-3 max-w-sm text-center text-sm text-destructive">{error}</p>}
        </section>
      </main>
    </div>
  )
}
