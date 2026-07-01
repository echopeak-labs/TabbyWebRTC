import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { writeSession } from '@/lib/auth-sync'
import { SignalClient } from '@/lib/signal-client'
import type { SessionQRPayload } from '@/types/auth'

const WS_URL = import.meta.env.VITE_WS_URL
const REFRESH_INTERVAL_S = 28

type ConnectStatus = 'idle' | 'waiting' | 'authorized' | 'loading'

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const radius = 110
  const stroke = 4
  const normalizedRadius = radius - stroke
  const circumference = normalizedRadius * 2 * Math.PI
  const progress = Math.max(0, Math.min(1, seconds / total))
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 240 240">
      <circle
        cx="120"
        cy="120"
        r={normalizedRadius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-border"
      />
      <circle
        cx="120"
        cy="120"
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

function LocalNetworkModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (ip: string) => void
}) {
  const [ip, setIp] = useState('')

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-sm border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-textPrimary">Connect on local network</CardTitle>
          <CardDescription>Enter the IP address of your desktop agent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="192.168.1.42"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-textPrimary"
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => onSubmit(ip)} disabled={!ip.trim()}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function ConnectPage() {
  const navigate = useNavigate()
  const clientRef = useRef<SignalClient | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [expiresIn, setExpiresIn] = useState(30)
  const [countdown, setCountdown] = useState(30)
  const [status, setStatus] = useState<ConnectStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [showLocalModal, setShowLocalModal] = useState(false)

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
        setCountdown((prev) => {
          if (prev <= 1) {
            return ttl
          }
          return prev - 1
        })
      }, 1000)
      refreshTimerRef.current = setInterval(() => {
        clientRef.current?.refreshSession()
      }, REFRESH_INTERVAL_S * 1000)
    },
    [clearTimers],
  )

  useEffect(() => {
    const client = new SignalClient(WS_URL)
    clientRef.current = client
    client.connect()

    const unsubscribe = client.onMessage((message) => {
      switch (message.type) {
        case 'SESSION_PENDING':
          setPendingSessionId(message.pendingSessionId)
          startCountdown(message.expiresIn)
          setStatus('waiting')
          setError(null)
          break
        case 'AUTH_APPROVED':
          setStatus('authorized')
          clearTimers()
          writeSession(message.token, message.agentId)
          setTimeout(() => {
            setStatus('loading')
            navigate('/launchpad', { replace: true })
          }, 600)
          break
        case 'SESSION_EXPIRED':
          setStatus('idle')
          setPendingSessionId(null)
          setError('Session expired. Refreshing QR code…')
          client.refreshSession()
          break
        case 'ERROR':
          setError(message.message)
          break
      }
    })

    return () => {
      unsubscribe()
      clearTimers()
      client.disconnect()
    }
  }, [clearTimers, navigate, startCountdown])

  const statusText = useMemo(() => {
    switch (status) {
      case 'waiting':
        return 'Waiting for authorization…'
      case 'authorized':
        return 'Authorized. Loading…'
      case 'loading':
        return 'Authorized. Loading…'
      default:
        return 'Scan with your phone to connect'
    }
  }, [status])

  const statusClass =
    status === 'waiting' ? 'animate-pulse text-primary' : 'text-textMuted'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-primary">TabbyWebRTC</CardTitle>
          <CardDescription className={statusClass}>{statusText}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6">
          <div className="relative flex h-60 w-60 items-center justify-center">
            {pendingSessionId && (
              <CountdownRing seconds={countdown} total={expiresIn} />
            )}
            <div className="relative z-10 rounded-lg bg-white p-3">
              {qrValue ? (
                <QRCodeSVG value={qrValue} size={180} level="M" />
              ) : (
                <div className="flex h-[180px] w-[180px] items-center justify-center text-sm text-textMuted">
                  Connecting…
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-center text-sm text-destructive">{error}</p>}

          {localIp && (
            <p className="text-center text-sm text-textMuted">
              Local agent: {localIp}
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowLocalModal(true)}
            className="min-h-11 text-sm text-primary underline-offset-4 hover:underline"
          >
            Connect on local network
          </button>
        </CardContent>
      </Card>

      <LocalNetworkModal
        open={showLocalModal}
        onClose={() => setShowLocalModal(false)}
        onSubmit={(ip) => {
          setLocalIp(ip.trim())
          setShowLocalModal(false)
        }}
      />
    </div>
  )
}
