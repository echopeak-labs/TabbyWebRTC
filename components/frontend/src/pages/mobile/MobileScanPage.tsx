import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { addPairedAgent } from '@/lib/clerk-client'
import { randomUUID } from '@/lib/utils'
import { useMobileStore } from '@/stores/mobileStore'
import {
  isPairQRPayload,
  isSessionQRPayload,
  type PairQRPayload,
  type QRPayload,
} from '@/types/auth'
import { useAuth, useUser } from '@clerk/clerk-react'

const REST_URL = import.meta.env.VITE_REST_URL

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor ?? null
}

function createQrReader() {
  const hints = new Map<DecodeHintType, unknown>()
  hints.set(DecodeHintType.TRY_HARDER, true)
  return new BrowserQRCodeReader(hints, {
    delayBetweenScanAttempts: 150,
    delayBetweenScanSuccess: 300,
  })
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Camera video timed out'))
    }, 8000)
    const onReady = () => {
      if (video.videoWidth > 0) {
        cleanup()
        resolve()
      }
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('playing', onReady)
    }
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('playing', onReady)
  })
}

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
        localEndpoint: typeof data.localEndpoint === 'string' ? data.localEndpoint : undefined,
        pairingNonce: typeof data.pairingNonce === 'string' ? data.pairingNonce : undefined,
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

async function deliverAgentJwt(
  agentJwt: string,
  pairingNonce: string,
  endpoints: string[],
): Promise<boolean> {
  for (const base of endpoints) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(`${base.replace(/\/$/, '')}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: agentJwt, nonce: pairingNonce }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (response.ok) {
        return true
      }
    } catch {
    }
  }
  return false
}

async function waitForAgentOnline(endpoints: string[], timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const base of endpoints) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 1500)
        const response = await fetch(`${base.replace(/\/$/, '')}/info`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (response.ok) {
          return true
        }
      } catch {
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500))
  }
  return false
}

export function MobileScanPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pairMode = searchParams.get('mode') === 'pair'
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const scanTimerRef = useRef<number | null>(null)
  const scanningRef = useRef(false)

  const { getToken } = useAuth()
  const { user } = useUser()
  const setPendingScanPayload = useMobileStore((s) => s.setPendingScanPayload)
  const addAgent = useMobileStore((s) => s.addPairedAgent)
  const setPairedAgents = useMobileStore((s) => s.setPairedAgents)

  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [pairPayload, setPairPayload] = useState<PairQRPayload | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [manualPayload, setManualPayload] = useState('')
  const insecureContext = typeof window !== 'undefined' && !window.isSecureContext

  const stopScanner = useCallback(() => {
    scanningRef.current = false
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
    controlsRef.current?.stop()
    controlsRef.current = null
    const stream = videoRef.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
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
        const pairingNonce = payload.pairingNonce ?? randomUUID()
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
            pairingNonce,
          }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'Pairing failed')
        }
        const pairBody = (await response.json()) as { agentJwt?: string }
        if (!pairBody.agentJwt) {
          throw new Error('Pairing response missing agentJwt')
        }

        const endpoints = [
          payload.localEndpoint,
          'http://127.0.0.1:7700',
          'http://localhost:7700',
        ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)

        const delivered = await deliverAgentJwt(pairBody.agentJwt, pairingNonce, endpoints)

        const agent = {
          agentId: payload.agentId,
          name,
          platform,
          publicKey: payload.publicKey,
          lastSeen: new Date().toISOString(),
          localEndpoint: payload.localEndpoint,
        }
        const updated = await addPairedAgent(user, agent)
        setPairedAgents(updated)
        addAgent(agent)
        stopScanner()
        if (!delivered) {
          await waitForAgentOnline(endpoints)
        }
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
      const text = raw.trim()
      setLastScan(text)
      setError(null)

      try {
        const data = JSON.parse(text) as Record<string, unknown>
        if (typeof data.part === 'number' && typeof data.of === 'number' && typeof data.data === 'string') {
          stopScanner()
          setError(null)
          setLastScan(`Captured part ${data.part}/${data.of} (${data.data.length} chars)`)
          return
        }
      } catch {
      }

      const payload = parseQRPayload(text)
      if (!payload) {
        setError(`Detected QR, but not a TabbyWebRTC payload: ${text.slice(0, 120)}`)
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

      setError(`Detected QR, unsupported shape: ${text.slice(0, 120)}`)
    },
    [handlePair, navigate, setPendingScanPayload, stopScanner],
  )

  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [stopScanner])

  const startCamera = useCallback(async () => {
    setError(null)
    setLastScan(null)

    if (!window.isSecureContext) {
      setError(
        `Camera needs HTTPS or localhost. This page is ${window.location.origin}, which browsers treat as insecure. Paste the QR JSON below, or open via HTTPS / Chrome flag unsafely-treat-insecure-origin-as-secure.`,
      )
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera access. Paste the QR JSON below.')
      return
    }

    stopScanner()
    scanningRef.current = true

    const constraintsList: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      { video: { facingMode: { ideal: 'environment' } } },
      { video: true },
    ]

    let stream: MediaStream | null = null
    let lastError: unknown
    for (const constraints of constraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (err) {
        lastError = err
      }
    }

    const video = videoRef.current
    if (!stream || !video) {
      const name = lastError instanceof DOMException ? lastError.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Camera permission was denied for this site. Check Opera site permissions.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera was found on this device.')
      } else {
        setError('Could not open the camera. Paste the QR JSON below.')
      }
      scanningRef.current = false
      stream?.getTracks().forEach((track) => track.stop())
      return
    }

    video.srcObject = stream
    video.setAttribute('playsinline', 'true')
    video.muted = true
    try {
      await video.play()
      await waitForVideo(video)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      scanningRef.current = false
      setError('Camera started but video never became ready. Paste the QR JSON below.')
      return
    }

    setCameraActive(true)

    const onText = (text: string) => {
      if (!scanningRef.current || !text) {
        return
      }
      scanningRef.current = false
      if (scanTimerRef.current !== null) {
        window.clearTimeout(scanTimerRef.current)
        scanTimerRef.current = null
      }
      controlsRef.current?.stop()
      handleDecode(text)
    }

    const Detector = getBarcodeDetector()
    if (Detector) {
      try {
        const detector = new Detector({ formats: ['qr_code'] })
        const tick = async () => {
          if (!scanningRef.current || !videoRef.current) {
            return
          }
          try {
            const codes = await detector.detect(videoRef.current)
            const value = codes.find((code) => code.rawValue)?.rawValue
            if (value) {
              onText(value)
              return
            }
          } catch {
          }
          scanTimerRef.current = window.setTimeout(() => {
            void tick()
          }, 200)
        }
        void tick()
        controlsRef.current = {
          stop: () => {
            if (scanTimerRef.current !== null) {
              window.clearTimeout(scanTimerRef.current)
              scanTimerRef.current = null
            }
          },
        }
        return
      } catch {
      }
    }

    try {
      const reader = createQrReader()
      const controls = await reader.decodeFromStream(stream, video, (result, err) => {
        if (!scanningRef.current) {
          return
        }
        if (result) {
          onText(result.getText())
          return
        }
        if (err && import.meta.env.DEV) {
          console.debug('zxing scan miss', err.name)
        }
      })
      controlsRef.current = controls
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      scanningRef.current = false
      setCameraActive(false)
      setError('Could not start QR scanner. Paste the QR JSON below.')
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
        <div className="relative w-full max-w-sm overflow-hidden rounded-lg border border-border bg-muted">
          <video
            ref={videoRef}
            className="aspect-[4/3] w-full object-contain"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-6 border-2 border-primary" />
          <div className="pointer-events-none absolute left-6 top-6 h-6 w-6 border-l-4 border-t-4 border-primary" />
          <div className="pointer-events-none absolute right-6 top-6 h-6 w-6 border-r-4 border-t-4 border-primary" />
          <div className="pointer-events-none absolute bottom-6 left-6 h-6 w-6 border-b-4 border-l-4 border-primary" />
          <div className="pointer-events-none absolute bottom-6 right-6 h-6 w-6 border-b-4 border-r-4 border-primary" />
          {!cameraActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4">
              <Button className="min-h-11" onClick={() => void startCamera()}>
                Enable camera
              </Button>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-textMuted">
          {pairMode
            ? 'First-time setup: scan the agent PAIR QR from the desktop-agent terminal'
            : 'Scan the QR on the desktop browser to approve this session'}
        </p>

        {cameraActive && !lastScan && (
          <p className="text-sm text-primary">Scanning… point at any QR to verify detection</p>
        )}

        {lastScan && (
          <p className="max-w-sm break-all text-center text-sm text-primary">Last scan: {lastScan}</p>
        )}

        {insecureContext && (
          <p className="max-w-sm text-center text-sm text-amber-500">
            Opened over HTTP on a LAN IP — browsers block the camera here even if Opera has camera
            permission. Use paste below for local testing.
          </p>
        )}

        {pairing && pairPayload && (
          <p className="text-sm text-primary">Pairing {pairPayload.name ?? 'machine'}…</p>
        )}

        {error && <p className="max-w-sm text-center text-sm text-destructive">{error}</p>}

        <div className="flex w-full max-w-sm flex-col gap-2">
          <label className="text-sm text-textMuted" htmlFor="manual-qr">
            Or paste QR JSON
          </label>
          <textarea
            id="manual-qr"
            className="min-h-24 w-full rounded-md border border-border bg-card p-3 text-sm text-textPrimary"
            value={manualPayload}
            onChange={(event) => setManualPayload(event.target.value)}
            placeholder='{"pendingSessionId":"...","signalingUrl":"...","version":1}'
          />
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pairing || !manualPayload.trim()}
            onClick={() => handleDecode(manualPayload.trim())}
          >
            Use pasted code
          </Button>
        </div>
      </div>
    </div>
  )
}
