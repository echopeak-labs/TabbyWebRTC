export type OutboundSignalMessage =
  | { type: 'SUBSCRIBE'; sourceId: string; tabId: string }
  | { type: 'SDP_ANSWER'; sourceId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; sourceId: string; candidate: RTCIceCandidateInit }
  | { type: 'UNSUBSCRIBE'; sourceId: string; tabId: string }
  | { type: 'REQUEST_SOURCES'; agentId: string }

export type InboundSignalMessage =
  | { type: 'SDP_OFFER'; sourceId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; sourceId: string; candidate: RTCIceCandidateInit }
  | { type: 'STREAM_READY'; sourceId: string }
  | { type: 'SOURCE_IN_USE'; sourceId: string; tabId: string }
  | { type: 'STREAM_CLOSED'; sourceId: string }
  | {
      type: 'AGENT_SOURCES'
      agentId: string
      displays: Array<{ id: string; name: string; width: number; height: number }>
      apps: Array<{ id: string; name: string; width: number; height: number }>
      localEndpoint?: string
    }
  | { type: 'AGENT_OFFLINE'; agentId?: string }

export type DesktopInboundMessage =
  | InboundSignalMessage
  | { type: 'SESSION_PENDING'; pendingSessionId: string; expiresIn: number }
  | { type: 'AUTH_APPROVED'; token: string; agentId: string; encryptedSalt?: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'ERROR'; code: string; message: string }
