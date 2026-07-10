import { apiFetch } from '@/lib/api-fetch'
import { randomUUID } from '@/lib/utils'

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export const BITRATE_CAPS = {
  low: 3000,
  medium: 8000,
  high: 15000,
} as const

export type BitratePreset = keyof typeof BITRATE_CAPS

interface TurnCredentials {
  urls: string[]
  username: string
  credential: string
  ttl: number
}

let cachedTurnCredentials: TurnCredentials | null = null
let cachedTurnToken: string | null = null

export async function fetchTurnCredentials(token: string): Promise<TurnCredentials> {
  if (cachedTurnCredentials && cachedTurnToken === token) {
    return cachedTurnCredentials
  }

  const empty: TurnCredentials = { urls: [], username: '', credential: '', ttl: 0 }
  const restUrl = import.meta.env.VITE_REST_URL
  if (!restUrl) {
    return empty
  }

  try {
    const response = await apiFetch(`${restUrl}/turn-credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      return empty
    }

    const data = (await response.json()) as TurnCredentials
    const normalized: TurnCredentials = {
      urls: (data.urls ?? []).map((url) => url.trim()).filter(Boolean),
      username: data.username ?? '',
      credential: data.credential ?? '',
      ttl: data.ttl ?? 0,
    }
    cachedTurnCredentials = normalized
    cachedTurnToken = token
    return normalized
  } catch {
    return empty
  }
}

export function clearTurnCredentialsCache(): void {
  cachedTurnCredentials = null
  cachedTurnToken = null
}

export async function createPeerConnection(token: string): Promise<RTCPeerConnection> {
  const turn = await fetchTurnCredentials(token)
  const turnUrls = (turn.urls ?? []).map((url) => url.trim()).filter(Boolean)

  const iceServers: RTCIceServer[] = [...STUN_SERVERS]
  if (turnUrls.length > 0) {
    iceServers.push({
      urls: turnUrls,
      username: turn.username,
      credential: turn.credential,
    })
  }

  const config: RTCConfiguration = {
    iceServers,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  }

  return new RTCPeerConnection(config)
}

export async function applyBitrateCap(sender: RTCRtpSender, maxKbps: number): Promise<void> {
  const params = sender.getParameters()
  if (!params.encodings.length) {
    params.encodings = [{}]
  }
  params.encodings[0].maxBitrate = maxKbps * 1000
  await sender.setParameters(params)
}

const TAB_ID_KEY = 'tabbywebrtc_tab_id'

export function getTabId(): string {
  let id = sessionStorage.getItem(TAB_ID_KEY)
  if (!id) {
    id = randomUUID()
    sessionStorage.setItem(TAB_ID_KEY, id)
  }
  return id
}

export function createInputChannel(pc: RTCPeerConnection): RTCDataChannel {
  return pc.createDataChannel('input_stream', {
    ordered: false,
    maxRetransmits: 0,
  })
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
