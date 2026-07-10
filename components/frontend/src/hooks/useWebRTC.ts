import { useCallback, useEffect, useRef, useState } from 'react'
import { signalClient } from '@/lib/signal-client'
import { showToast } from '@/lib/toast'
import {
  createPeerConnection,
  getTabId,
  sleep,
} from '@/lib/webrtc'
import { useAgentStore } from '@/stores/agentStore'
import type { DesktopInboundMessage, InboundSignalMessage } from '@/types/signaling'

const MAX_ICE_RETRIES = 3
const ICE_RETRY_BASE_MS = 1000

export interface UseWebRTCOptions {
  sourceId: string
  token: string
  agentId: string
  onStream: (stream: MediaStream) => void
  onClose: () => void
  onError: (err: Error) => void
}

export interface UseWebRTCReturn {
  peerConnection: RTCPeerConnection | null
  inputChannel: RTCDataChannel | null
  connectionState: RTCPeerConnectionState
  disconnect: () => void
}

function isStreamSignalMessage(msg: { type: string }): msg is Extract<
  InboundSignalMessage,
  | { type: 'SDP_OFFER' }
  | { type: 'ICE_CANDIDATE' }
  | { type: 'STREAM_READY' }
  | { type: 'SOURCE_IN_USE' }
  | { type: 'STREAM_CLOSED' }
> {
  return (
    msg.type === 'SDP_OFFER' ||
    msg.type === 'ICE_CANDIDATE' ||
    msg.type === 'STREAM_READY' ||
    msg.type === 'SOURCE_IN_USE' ||
    msg.type === 'STREAM_CLOSED'
  )
}

function toSessionDescription(
  sdp: RTCSessionDescriptionInit | string,
  fallbackType: RTCSdpType,
): RTCSessionDescriptionInit {
  if (typeof sdp === 'string') {
    return { type: fallbackType, sdp }
  }
  if (sdp && typeof sdp === 'object' && typeof sdp.sdp === 'string') {
    return {
      type: sdp.type ?? fallbackType,
      sdp: sdp.sdp,
    }
  }
  throw new Error('Invalid SDP payload')
}

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { sourceId, token } = options
  const tabId = getTabId()

  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null)
  const [inputChannel, setInputChannel] = useState<RTCDataChannel | null>(null)
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const iceRetryCount = useRef(0)
  const disconnectedRef = useRef(false)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const remoteDescriptionSetRef = useRef(false)
  const optionsRef = useRef(options)
  const disconnectRef = useRef<() => void>(() => {})
  optionsRef.current = options

  const setSourceInUse = useAgentStore((s) => s.setSourceInUse)

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const pending = pendingIceRef.current
    pendingIceRef.current = []
    for (const candidate of pending) {
      await pc.addIceCandidate(candidate)
    }
  }, [])

  const teardownPc = useCallback(() => {
    channelRef.current?.close()
    channelRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    pendingIceRef.current = []
    remoteDescriptionSetRef.current = false
    setPeerConnection(null)
    setInputChannel(null)
    setConnectionState('closed')
  }, [])

  const setupPeerConnection = useCallback(async () => {
    teardownPc()

    const pc = await createPeerConnection(token)

    pcRef.current = pc
    channelRef.current = null
    remoteDescriptionSetRef.current = false
    pendingIceRef.current = []
    setPeerConnection(pc)
    setInputChannel(null)
    setConnectionState(pc.connectionState)

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState)
      if (pc.connectionState === 'failed' && !disconnectedRef.current) {
        optionsRef.current.onError(new Error('WebRTC connection failed'))
        disconnectRef.current()
      }
    }

    pc.oniceconnectionstatechange = async () => {
      if (pc.iceConnectionState === 'failed' && !disconnectedRef.current) {
        if (iceRetryCount.current < MAX_ICE_RETRIES) {
          iceRetryCount.current += 1
          const delay = ICE_RETRY_BASE_MS * 2 ** (iceRetryCount.current - 1)
          await sleep(delay)
          if (!disconnectedRef.current) {
            await setupPeerConnection()
            signalClient.subscribeToSource(sourceId, tabId)
          }
        } else {
          showToast('Connection unstable')
          optionsRef.current.onError(new Error('ICE connection failed after retries'))
        }
      }
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      optionsRef.current.onStream(stream)
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalClient.sendIceCandidate(sourceId, event.candidate.toJSON())
      }
    }

    pc.ondatachannel = (event) => {
      if (event.channel.label !== 'input_stream') {
        return
      }
      const channel = event.channel
      const adopt = () => {
        channelRef.current = channel
        setInputChannel(channel)
      }
      if (channel.readyState === 'open') {
        adopt()
      } else {
        channel.addEventListener('open', adopt, { once: true })
      }
    }

    return pc
  }, [sourceId, tabId, teardownPc, token])

  const disconnect = useCallback(() => {
    if (disconnectedRef.current) {
      return
    }
    disconnectedRef.current = true
    signalClient.unsubscribeFromSource(sourceId, tabId)
    teardownPc()
    optionsRef.current.onClose()
  }, [sourceId, tabId, teardownPc])

  disconnectRef.current = disconnect

  useEffect(() => {
    disconnectedRef.current = false
    iceRetryCount.current = 0
    pendingIceRef.current = []
    remoteDescriptionSetRef.current = false

    if (!signalClient.isConnected) {
      signalClient.connect()
    }

    let mounted = true

    const handleMessage = async (message: { type: string }) => {
      if (!isStreamSignalMessage(message)) {
        return
      }

      if (message.sourceId !== sourceId) {
        return
      }

      switch (message.type) {
        case 'SDP_OFFER': {
          const pc = pcRef.current ?? (await setupPeerConnection())
          if (!mounted) return
          const offer = toSessionDescription(message.sdp, 'offer')
          await pc.setRemoteDescription(offer)
          remoteDescriptionSetRef.current = true
          await flushPendingIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          signalClient.sendSdpAnswer(sourceId, {
            type: answer.type,
            sdp: answer.sdp,
          })
          break
        }
        case 'ICE_CANDIDATE': {
          const pc = pcRef.current
          if (!pc || !message.candidate) {
            break
          }
          if (!remoteDescriptionSetRef.current) {
            pendingIceRef.current.push(message.candidate)
            break
          }
          await pc.addIceCandidate(message.candidate)
          break
        }
        case 'SOURCE_IN_USE': {
          if (message.tabId !== tabId) {
            setSourceInUse(sourceId, true)
            optionsRef.current.onError(new Error('Source in use in another tab'))
          }
          break
        }
        case 'STREAM_CLOSED': {
          setSourceInUse(sourceId, false)
          if (!disconnectedRef.current) {
            disconnect()
          }
          break
        }
        case 'STREAM_READY':
          break
      }
    }

    const unsubMessage = signalClient.subscribe((msg: DesktopInboundMessage) => {
      void handleMessage(msg)
    })

    const unsubState = signalClient.onConnectionState((state: 'connected' | 'disconnected' | 'offline') => {
      if (state === 'offline') {
        optionsRef.current.onError(new Error('Agent offline'))
      }
    })

    void setupPeerConnection().then(() => {
      if (mounted) {
        signalClient.subscribeToSource(sourceId, tabId)
      }
    })

    return () => {
      mounted = false
      unsubMessage()
      unsubState()
      disconnectedRef.current = true
      signalClient.unsubscribeFromSource(sourceId, tabId)
      teardownPc()
    }
  }, [
    disconnect,
    flushPendingIce,
    setSourceInUse,
    setupPeerConnection,
    sourceId,
    tabId,
    teardownPc,
    token,
  ])

  return {
    peerConnection,
    inputChannel,
    connectionState,
    disconnect,
  }
}
