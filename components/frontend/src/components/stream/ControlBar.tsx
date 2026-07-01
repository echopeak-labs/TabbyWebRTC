import {
  ClipboardPaste,
  Crosshair,
  Lock,
  Monitor,
  Moon,
  MousePointer2,
  Power,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readClipboardText, sendInput, type CommandName } from '@/lib/input-codec'
import { cn } from '@/lib/utils'

export interface ControlBarProps {
  inputChannel: RTCDataChannel | null
  mode: 'absolute' | 'relative'
  onModeChange: (mode: 'absolute' | 'relative') => void
  visible?: boolean
  className?: string
}

function sendCommand(channel: RTCDataChannel | null, name: CommandName): void {
  sendInput(channel, { type: 'COMMAND', name })
}

export function ControlBar({
  inputChannel,
  mode,
  onModeChange,
  visible = true,
  className,
}: ControlBarProps) {
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

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-lg border border-border bg-card/90 px-2 py-1.5 backdrop-blur-sm transition-opacity duration-300',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        title="Process Manager (Ctrl+Alt+Del)"
        onClick={() => sendCommand(inputChannel, 'CTRL_ALT_DEL')}
      >
        <Monitor />
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
        onClick={() => sendCommand(inputChannel, 'RESTART')}
      >
        <RotateCcw />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Shutdown"
        onClick={() => sendCommand(inputChannel, 'SHUTDOWN')}
      >
        <Power />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Lock Screen"
        onClick={() => sendCommand(inputChannel, 'LOCK')}
      >
        <Lock />
      </Button>
      <Button variant="ghost" size="icon" title="Paste Clipboard" onClick={() => void handlePaste()}>
        <ClipboardPaste />
      </Button>
      <div className="mx-1 h-6 w-px bg-border" />
      <Button
        variant={mode === 'relative' ? 'default' : 'ghost'}
        size="icon"
        title={mode === 'relative' ? 'Relative mouse (gaming)' : 'Absolute mouse (desktop)'}
        onClick={toggleMode}
      >
        {mode === 'relative' ? <MousePointer2 /> : <Crosshair />}
      </Button>
    </div>
  )
}
