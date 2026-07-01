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

  const restUrl = import.meta.env.VITE_REST_URL
  const response = await fetch(`${restUrl}/turn-credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch TURN credentials: ${response.status}`)
  }

  const data = (await response.json()) as TurnCredentials
  cachedTurnCredentials = data
  cachedTurnToken = token
  return data
}

export function clearTurnCredentialsCache(): void {
  cachedTurnCredentials = null
  cachedTurnToken = null
}

export async function createPeerConnection(token: string): Promise<RTCPeerConnection> {
  const turn = await fetchTurnCredentials(token)

  const iceServers: RTCIceServer[] = [
    ...STUN_SERVERS,
    {
      urls: turn.urls,
      username: turn.username,
      credential: turn.credential,
    },
  ]

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
    id = crypto.randomUUID()
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
