export interface ActiveStream {
  sourceId: string
  peerConnection: RTCPeerConnection
  inputChannel: RTCDataChannel
  mediaStream: MediaStream
}
