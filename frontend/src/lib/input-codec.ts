export interface ModifierState {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export type CommandName = 'CTRL_ALT_DEL' | 'SLEEP' | 'RESTART' | 'SHUTDOWN' | 'LOCK'

export interface KeyDownPayload {
  type: 'KEY_DOWN'
  code: string
  modifiers: ModifierState
}

export interface KeyUpPayload {
  type: 'KEY_UP'
  code: string
  modifiers: ModifierState
}

export interface MouseMoveAbsolutePayload {
  type: 'MOUSE_MOVE_ABS'
  x: number
  y: number
}

export interface MouseMoveRelativePayload {
  type: 'MOUSE_MOVE_REL'
  dx: number
  dy: number
}

export interface MouseButtonPayload {
  type: 'MOUSE_DOWN' | 'MOUSE_UP'
  button: 0 | 1 | 2
  x: number
  y: number
}

export interface MouseScrollPayload {
  type: 'MOUSE_SCROLL'
  delta_x: number
  delta_y: number
}

export interface ClipboardPayload {
  type: 'CLIPBOARD_PASTE'
  text: string
}

export interface CommandPayload {
  type: 'COMMAND'
  name: CommandName
}

export type InputPayload =
  | KeyDownPayload
  | KeyUpPayload
  | MouseMoveAbsolutePayload
  | MouseMoveRelativePayload
  | MouseButtonPayload
  | MouseScrollPayload
  | ClipboardPayload
  | CommandPayload

export function serializePayload(payload: InputPayload): string {
  return JSON.stringify(payload)
}

export function sendInput(channel: RTCDataChannel | null, payload: InputPayload): void {
  if (!channel || channel.readyState !== 'open') {
    return
  }
  channel.send(serializePayload(payload))
}

export function modifiersFromEvent(event: KeyboardEvent | MouseEvent): ModifierState {
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  }
}

export function keyCodeFromEvent(event: KeyboardEvent): string {
  if (event.code) {
    return event.code
  }
  if (event.key.length === 1) {
    return `Key${event.key.toUpperCase()}`
  }
  return event.key
}

export function getAbsoluteCoordinates(
  event: MouseEvent,
  videoEl: HTMLVideoElement,
  nativeWidth: number,
  nativeHeight: number,
): { x: number; y: number } {
  const rect = videoEl.getBoundingClientRect()
  const scaleX = nativeWidth / rect.width
  const scaleY = nativeHeight / rect.height
  return {
    x: Math.round((event.clientX - rect.left) * scaleX),
    y: Math.round((event.clientY - rect.top) * scaleY),
  }
}

export function domButtonToPayload(button: number): 0 | 1 | 2 {
  if (button === 1) return 1
  if (button === 2) return 2
  return 0
}

export async function readClipboardText(): Promise<string> {
  return navigator.clipboard.readText()
}
