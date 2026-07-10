import {
  ClipboardPaste,
  Crosshair,
  LogOut,
  Lock,
  Monitor,
  Moon,
  MousePointer2,
  Power,
  RotateCcw,
} from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/layout/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { readClipboardText, sendInput, type CommandName } from '@/lib/input-codec'
import { cn } from '@/lib/utils'

export interface StreamControlBarProps {
  inputChannel: RTCDataChannel | null
  peerConnection: RTCPeerConnection | null
  mode: 'absolute' | 'relative'
  onModeChange: (mode: 'absolute' | 'relative') => void
  visible?: boolean
  onExit: () => void
  className?: string
}

type PendingCommand = 'RESTART' | 'SHUTDOWN' | null

function sendCommand(channel: RTCDataChannel | null, name: CommandName): void {
  sendInput(channel, { type: 'COMMAND', name })
}

export function StreamControlBar({
  inputChannel,
  mode,
  onModeChange,
  visible = true,
  onExit,
  className,
}: StreamControlBarProps) {
  const [pendingCommand, setPendingCommand] = useState<PendingCommand>(null)

  const handlePaste = async () => {
    try {
      const text = await readClipboardText()
      sendInput(inputChannel, { type: 'CLIPBOARD_PASTE', text })
    } catch {
      return
    }
  }

  const toggleMode = () => {
    onModeChange(mode === 'absolute' ? 'relative' : 'absolute')
  }

  const confirmPending = () => {
    if (pendingCommand) {
      sendCommand(inputChannel, pendingCommand)
    }
    setPendingCommand(null)
  }

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/90 px-2 py-1.5 backdrop-blur-sm transition-opacity duration-300',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          title="Ctrl+Alt+Del"
          onClick={() => sendCommand(inputChannel, 'CTRL_ALT_DEL')}
        >
          <Monitor />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Lock Screen"
          onClick={() => sendCommand(inputChannel, 'LOCK')}
        >
          <Lock />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Sleep"
          onClick={() => sendCommand(inputChannel, 'SLEEP')}
        >
          <Moon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Restart"
          onClick={() => setPendingCommand('RESTART')}
        >
          <RotateCcw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Shutdown"
          onClick={() => setPendingCommand('SHUTDOWN')}
        >
          <Power />
        </Button>
        <Button variant="ghost" size="icon" title="Paste" onClick={() => void handlePaste()}>
          <ClipboardPaste />
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Button
          variant={mode === 'relative' ? 'default' : 'ghost'}
          size="icon"
          title={mode === 'relative' ? 'Relative mouse' : 'Absolute mouse'}
          onClick={toggleMode}
        >
          {mode === 'relative' ? <MousePointer2 /> : <Crosshair />}
        </Button>
        <Button variant="ghost" size="icon" title="Exit stream" onClick={onExit}>
          <LogOut />
        </Button>
      </div>

      <ConfirmDialog
        open={pendingCommand === 'RESTART'}
        title="Restart remote machine?"
        description="The connected desktop will restart immediately."
        confirmLabel="Restart"
        onConfirm={confirmPending}
        onCancel={() => setPendingCommand(null)}
      />
      <ConfirmDialog
        open={pendingCommand === 'SHUTDOWN'}
        title="Shut down remote machine?"
        description="The connected desktop will power off."
        confirmLabel="Shutdown"
        onConfirm={confirmPending}
        onCancel={() => setPendingCommand(null)}
      />
    </>
  )
}
