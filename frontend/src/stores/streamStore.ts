import { create } from 'zustand'
import type { ActiveStream } from '@/types/stream'

interface StreamState {
  activeStreams: Record<string, ActiveStream>
  registerStream: (sourceId: string, pc: RTCPeerConnection) => void
  releaseStream: (sourceId: string) => void
}

export const useStreamStore = create<StreamState>((set, get) => ({
  activeStreams: {},
  registerStream: (sourceId, pc) => {
    const existing = get().activeStreams[sourceId]
    if (existing) {
      return
    }
    const placeholder: ActiveStream = {
      sourceId,
      peerConnection: pc,
      inputChannel: {} as RTCDataChannel,
      mediaStream: new MediaStream(),
    }
    set((state) => ({
      activeStreams: { ...state.activeStreams, [sourceId]: placeholder },
    }))
  },
  releaseStream: (sourceId) =>
    set((state) => {
      const stream = state.activeStreams[sourceId]
      if (stream) {
        stream.peerConnection.close()
        stream.inputChannel.close?.()
        stream.mediaStream.getTracks().forEach((track) => track.stop())
      }
      const { [sourceId]: _removed, ...rest } = state.activeStreams
      return { activeStreams: rest }
    }),
}))
