import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { StreamControlBar } from '@/components/layout/StreamControlBar'
import { TopBar } from '@/components/layout/TopBar'
import { useInputChannel } from '@/hooks/useInputChannel'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useAgentStore } from '@/stores/agentStore'
import { useAuthStore } from '@/stores/authStore'

const CONTROL_BAR_HIDE_MS = 3000

export function StreamPage() {
  const { sourceId } = useParams<{ sourceId: string }>()
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)
  const agentId = useAuthStore((s) => s.agentId)
  const displays = useAgentStore((s) => s.displays)
  const apps = useAgentStore((s) => s.apps)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const [mouseMode, setMouseMode] = useState<'absolute' | 'relative'>('absolute')
  const [controlBarVisible, setControlBarVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sourceMeta = useMemo(() => {
    const display = displays.find((d) => d.id === sourceId)
    if (display) {
      return { width: display.width, height: display.height }
    }
    const app = apps.find((a) => a.id === sourceId)
    if (app) {
      return { width: 1920, height: 1080 }
    }
    return { width: 1920, height: 1080 }
  }, [apps, displays, sourceId])

  const showControlBar = useCallback(() => {
    setControlBarVisible(true)
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
    }
    hideTimerRef.current = setTimeout(() => {
      setControlBarVisible(false)
    }, CONTROL_BAR_HIDE_MS)
  }, [])

  const handleDisconnect = useCallback(() => {
    navigate('/launchpad')
  }, [navigate])

  const { peerConnection, inputChannel, disconnect } = useWebRTC({
    sourceId: sourceId ?? '',
    token: token ?? '',
    agentId: agentId ?? '',
    onStream: (stream) => {
      setMediaStream(stream)
      setError(null)
    },
    onClose: handleDisconnect,
    onError: (err) => {
      setError(err.message)
    },
  })

  const {
    activateKeyboardLock,
    releaseKeyboardLock,
    setMode,
    mode,
  } = useInputChannel({
    inputChannel,
    videoRef,
    nativeWidth: sourceMeta.width,
    nativeHeight: sourceMeta.height,
    mode: mouseMode,
  })

  useEffect(() => {
    setMode(mouseMode)
  }, [mouseMode, setMode])

  useEffect(() => {
    if (mediaStream && videoRef.current) {
      videoRef.current.srcObject = mediaStream
    }
  }, [mediaStream])

  useEffect(() => {
    showControlBar()
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
    }
  }, [showControlBar])

  useEffect(() => {
    const onMouseMove = () => showControlBar()
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [showControlBar])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault()
        void activateKeyboardLock()
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        event.preventDefault()
        showControlBar()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activateKeyboardLock, showControlBar])

  useEffect(() => {
    return () => {
      releaseKeyboardLock()
    }
  }, [releaseKeyboardLock])

  const handleExit = useCallback(() => {
    disconnect()
    handleDisconnect()
  }, [disconnect, handleDisconnect])

  if (!sourceId || !token || !agentId) {
    return null
  }

  return (
    <div className="relative flex h-screen w-screen flex-col bg-black">
      <TopBar peerConnection={peerConnection} />

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          data-source-id={sourceId}
          data-native-width={sourceMeta.width}
          data-native-height={sourceMeta.height}
          className="h-full w-full object-contain"
          style={{ width: '100vw', height: 'calc(100vh - 3.5rem)' }}
        />

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <p className="text-textPrimary">{error}</p>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto">
            <StreamControlBar
              inputChannel={inputChannel}
              peerConnection={peerConnection}
              mode={mode}
              onModeChange={setMouseMode}
              visible={controlBarVisible}
              onExit={handleExit}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
