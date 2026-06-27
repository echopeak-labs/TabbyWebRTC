import { BrowserMultiFormatReader } from '@zxing/browser'
import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { addPairedAgent } from '@/lib/clerk-client'
import { useMobileStore } from '@/stores/mobileStore'
import {
  isPairQRPayload,
  isSessionQRPayload,
  type PairQRPayload,
  type QRPayload,
} from '@/types/auth'
import { useAuth, useUser } from '@clerk/clerk-react'

const REST_URL = import.meta.env.VITE_REST_URL

function parseQRPayload(raw: string): QRPayload | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    if (data.type === 'PAIR' && typeof data.agentId === 'string' && typeof data.publicKey === 'string') {
      return {
        type: 'PAIR',
        agentId: data.agentId,
        publicKey: data.publicKey,
        platform: data.platform as PairQRPayload['platform'],
        name: typeof data.name === 'string' ? data.name : undefined,
      }
    }
    if (
      typeof data.pendingSessionId === 'string' &&
      typeof data.signalingUrl === 'string' &&
      data.version === 1
    ) {
      return {
        pendingSessionId: data.pendingSessionId,
        signalingUrl: data.signalingUrl,
        version: 1,
      }
    }
    return null
  } catch {
    return null
  }
}

export function MobileScanPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pairMode = searchParams.get('mode') === 'pair'
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const scanningRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  const { getToken } = useAuth()
  const { user } = useUser()
  const setPendingScanPayload = useMobileStore((s) => s.setPendingScanPayload)
  const addAgent = useMobileStore((s) => s.addPairedAgent)
  const setPairedAgents = useMobileStore((s) => s.setPairedAgents)

  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [pairPayload, setPairPayload] = useState<PairQRPayload | null>(null)

  const stopScanner = useCallback(() => {
    scanningRef.current = false
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    readerRef.current = null
    const stream = videoRef.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const handlePair = useCallback(
    async (payload: PairQRPayload) => {
      if (!user) {
        return
      }
      setPairing(true)
      setError(null)
      try {
        const clerkJwt = await getToken()
        if (!clerkJwt) {
          throw new Error('Not authenticated')
        }
        const name = payload.name ?? `Machine ${payload.agentId.slice(0, 8)}`
        const platform = payload.platform ?? 'linux'
        const response = await fetch(`${REST_URL}/agents/pair`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${clerkJwt}`,
          },
          body: JSON.stringify({
            agentId: payload.agentId,
            publicKey: payload.publicKey,
            name,
            platform,
          }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'Pairing failed')
        }
        const agent = {
          agentId: payload.agentId,
          name,
          platform,
          publicKey: payload.publicKey,
          lastSeen: new Date().toISOString(),
        }
        const updated = await addPairedAgent(user, agent)
        setPairedAgents(updated)
        addAgent(agent)
        stopScanner()
        navigate('/agents', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Pairing failed')
        setPairing(false)
        setPairPayload(null)
      }
    },
    [addAgent, getToken, navigate, setPairedAgents, stopScanner, user],
  )

  const handleDecode = useCallback(
    (raw: string) => {
      const payload = parseQRPayload(raw)
      if (!payload) {
        setError('Invalid QR code format')
        return
      }

      if (isPairQRPayload(payload)) {
        stopScanner()
        setPairPayload(payload)
        void handlePair(payload)
        return
      }

      if (isSessionQRPayload(payload)) {
        stopScanner()
        setPendingScanPayload(payload)
        navigate('/approve', { replace: true })
        return
      }

      setError('Unsupported QR code')
    },
    [handlePair, navigate, setPendingScanPayload, stopScanner],
  )

  useEffect(() => {
    let cancelled = false
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    scanningRef.current = true

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        const scanLoop = async () => {
          if (!scanningRef.current || !videoRef.current) {
            return
          }
          try {
            const result = await reader.decodeOnceFromVideoElement(videoRef.current)
            if (result?.getText()) {
              handleDecode(result.getText())
              return
            }
          } catch {
            // no QR in frame
          }
          rafRef.current = requestAnimationFrame(() => {
            void scanLoop()
          })
        }
        void scanLoop()
      } catch {
        if (!cancelled) {
          setError('Camera permission is required to scan QR codes')
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      stopScanner()
    }
  }, [handleDecode, stopScanner])

  const title = pairMode ? 'Pair New Machine' : 'Scan Desktop QR'

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-base font-medium text-textPrimary">{title}</h1>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
        <div className="relative w-full max-w-sm overflow-hidden rounded-lg border border-border">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-6 border-2 border-primary" />
          <div className="pointer-events-none absolute left-6 top-6 h-6 w-6 border-l-4 border-t-4 border-primary" />
          <div className="pointer-events-none absolute right-6 top-6 h-6 w-6 border-r-4 border-t-4 border-primary" />
          <div className="pointer-events-none absolute bottom-6 left-6 h-6 w-6 border-b-4 border-l-4 border-primary" />
          <div className="pointer-events-none absolute bottom-6 right-6 h-6 w-6 border-b-4 border-r-4 border-primary" />
        </div>

        <p className="text-center text-sm text-textMuted">
          {pairMode
            ? 'Point your camera at the setup QR on your desktop'
            : 'Point your camera at the QR on your desktop screen'}
        </p>

        {pairing && pairPayload && (
          <p className="text-sm text-primary">Pairing {pairPayload.name ?? 'machine'}…</p>
        )}

        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
