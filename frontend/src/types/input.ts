export type InputPayload =
  | { type: 'KEY_DOWN'; code: string; modifiers: number }
  | { type: 'KEY_UP'; code: string; modifiers: number }
  | { type: 'MOUSE_MOVE_ABS'; x: number; y: number }
  | { type: 'MOUSE_MOVE_REL'; dx: number; dy: number }
  | { type: 'MOUSE_DOWN'; button: number; x: number; y: number }
  | { type: 'MOUSE_UP'; button: number; x: number; y: number }
  | { type: 'MOUSE_SCROLL'; deltaX: number; deltaY: number }
  | { type: 'CLIPBOARD_PASTE'; text: string }
  | { type: 'COMMAND'; command: string }
