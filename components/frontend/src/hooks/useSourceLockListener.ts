import { useEffect } from 'react'
import { signalClient } from '@/lib/signal-client'
import { getTabId } from '@/lib/webrtc'
import { useAgentStore } from '@/stores/agentStore'
import type { DesktopInboundMessage } from '@/types/signaling'

function isLockMessage(msg: DesktopInboundMessage): boolean {
  return msg.type === 'SOURCE_IN_USE' || msg.type === 'STREAM_CLOSED'
}

export function useSourceLockListener(): void {
  const setSourceInUse = useAgentStore((s) => s.setSourceInUse)
  const tabId = getTabId()

  useEffect(() => {
    if (!signalClient.isConnected) {
      signalClient.connect()
    }

    return signalClient.subscribe((message: DesktopInboundMessage) => {
      if (!isLockMessage(message)) {
        return
      }

      if (message.type === 'SOURCE_IN_USE' && message.tabId !== tabId) {
        setSourceInUse(message.sourceId, true)
      } else if (message.type === 'STREAM_CLOSED') {
        setSourceInUse(message.sourceId, false)
      }
    })
  }, [setSourceInUse, tabId])
}
