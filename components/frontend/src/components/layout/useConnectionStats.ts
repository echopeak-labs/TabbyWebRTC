import { useEffect, useState } from 'react'

export type ConnectionPath = 'lan' | 'wan' | 'unknown'

export interface ConnectionStats {
  latencyMs: number | null
  path: ConnectionPath
}

function candidateTypeToPath(candidateType: string | undefined): ConnectionPath {
  if (!candidateType) {
    return 'unknown'
  }
  if (candidateType === 'relay') {
    return 'wan'
  }
  if (candidateType === 'host' || candidateType === 'srflx') {
    return 'lan'
  }
  return 'unknown'
}

export function useConnectionStats(peerConnection: RTCPeerConnection | null): ConnectionStats {
  const [stats, setStats] = useState<ConnectionStats>({ latencyMs: null, path: 'unknown' })

  useEffect(() => {
    if (!peerConnection) {
      setStats({ latencyMs: null, path: 'unknown' })
      return
    }

    let cancelled = false

    const poll = async () => {
      if (cancelled) {
        return
      }
      try {
        const report = await peerConnection.getStats()
        let latencyMs: number | null = null
        let path: ConnectionPath = 'unknown'

        report.forEach((entry) => {
          if (entry.type === 'candidate-pair' && 'state' in entry && entry.state === 'succeeded') {
            const pair = entry as RTCStats & {
              currentRoundTripTime?: number
              localCandidateId?: string
            }
            if (typeof pair.currentRoundTripTime === 'number') {
              latencyMs = Math.round(pair.currentRoundTripTime * 1000)
            }
            if (pair.localCandidateId) {
              const local = report.get(pair.localCandidateId) as RTCStats & {
                candidateType?: string
              }
              path = candidateTypeToPath(local?.candidateType)
            }
          }
        })

        if (!cancelled) {
          setStats({ latencyMs, path })
        }
      } catch {
        if (!cancelled) {
          setStats({ latencyMs: null, path: 'unknown' })
        }
      }
    }

    void poll()
    const interval = setInterval(() => void poll(), 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [peerConnection])

  return stats
}
