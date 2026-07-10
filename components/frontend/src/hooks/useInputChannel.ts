import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  domButtonToPayload,
  getAbsoluteCoordinates,
  keyCodeFromEvent,
  modifiersFromEvent,
  sendInput,
} from '@/lib/input-codec'

const MOUSE_MOVE_INTERVAL_MS = 8

const KEYBOARD_LOCK_KEYS = [
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'Tab',
  'Escape',
  'KeyW',
  'KeyT',
  'KeyN',
  'KeyR',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'MetaLeft',
  'MetaRight',
]

interface NavigatorKeyboard {
  lock: (keys?: string[]) => Promise<void>
  unlock: () => void
}

export interface UseInputChannelOptions {
  inputChannel: RTCDataChannel | null
  videoRef: RefObject<HTMLVideoElement | null>
  nativeWidth: number
  nativeHeight: number
  mode: 'absolute' | 'relative'
}

export interface UseInputChannelReturn {
  activateKeyboardLock: () => Promise<void>
  releaseKeyboardLock: () => void
  setMode: (mode: 'absolute' | 'relative') => void
  mode: 'absolute' | 'relative'
  showFullscreenPrompt: boolean
  dismissFullscreenPrompt: () => void
}

function getNavigatorKeyboard(): NavigatorKeyboard | null {
  const nav = navigator as Navigator & { keyboard?: NavigatorKeyboard }
  if (nav.keyboard && 'lock' in nav.keyboard) {
    return nav.keyboard
  }
  return null
}

export function useInputChannel(options: UseInputChannelOptions): UseInputChannelReturn {
  const { inputChannel, videoRef, nativeWidth, nativeHeight } = options
  const [mode, setModeState] = useState(options.mode)
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false)
  const modeRef = useRef(mode)
  const lastMouseMoveRef = useRef(0)
  const cursorElRef = useRef<HTMLDivElement | null>(null)

  modeRef.current = mode

  useEffect(() => {
    setModeState(options.mode)
  }, [options.mode])

  const activateKeyboardLock = useCallback(async () => {
    await document.documentElement.requestFullscreen()
    const keyboard = getNavigatorKeyboard()
    if (keyboard) {
      await keyboard.lock(KEYBOARD_LOCK_KEYS)
    }
    setShowFullscreenPrompt(false)
  }, [])

  const releaseKeyboardLock = useCallback(() => {
    const keyboard = getNavigatorKeyboard()
    keyboard?.unlock()
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    }
  }, [])

  const setMode = useCallback(
    (nextMode: 'absolute' | 'relative') => {
      setModeState(nextMode)
      const video = videoRef.current
      if (!video) return
      if (nextMode === 'relative') {
        void video.requestPointerLock()
      } else if (document.pointerLockElement === video) {
        void document.exitPointerLock()
      }
    },
    [videoRef],
  )

  const dismissFullscreenPrompt = useCallback(() => {
    setShowFullscreenPrompt(false)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setShowFullscreenPrompt(true)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.style.cursor = 'none'

    const parent = video.parentElement
    if (!parent) return

    const cursor = document.createElement('div')
    cursor.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'width:16px',
      'height:16px',
      'border-radius:50%',
      'background:#f59e0b',
      'border:2px solid #0a0a0a',
      'transform:translate(-50%,-50%)',
      'z-index:10',
      'display:none',
    ].join(';')

    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative'
    }
    parent.appendChild(cursor)
    cursorElRef.current = cursor

    return () => {
      cursor.remove()
      cursorElRef.current = null
      video.style.cursor = ''
    }
  }, [videoRef])

  const updateLocalCursor = useCallback((event: MouseEvent, video: HTMLVideoElement) => {
    const cursor = cursorElRef.current
    if (!cursor) return
    const rect = video.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      cursor.style.display = 'none'
      return
    }
    const parent = video.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    cursor.style.left = `${event.clientX - parentRect.left}px`
    cursor.style.top = `${event.clientY - parentRect.top}px`
    cursor.style.display = 'block'
  }, [])

  useEffect(() => {
    if (!inputChannel) return

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      sendInput(inputChannel, {
        type: 'KEY_DOWN',
        code: keyCodeFromEvent(event),
        modifiers: modifiersFromEvent(event),
      })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      sendInput(inputChannel, {
        type: 'KEY_UP',
        code: keyCodeFromEvent(event),
        modifiers: modifiersFromEvent(event),
      })
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp, { passive: false })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [inputChannel])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !inputChannel) return

    const sendRelativeMouse = (event: MouseEvent) => {
      sendInput(inputChannel, {
        type: 'MOUSE_MOVE_REL',
        dx: event.movementX,
        dy: event.movementY,
      })
    }

    const onPointerLockChange = () => {
      if (document.pointerLockElement === video) {
        document.addEventListener('mousemove', sendRelativeMouse)
      } else {
        document.removeEventListener('mousemove', sendRelativeMouse)
      }
    }

    document.addEventListener('pointerlockchange', onPointerLockChange)
    if (document.pointerLockElement === video) {
      document.addEventListener('mousemove', sendRelativeMouse)
    }

    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', sendRelativeMouse)
      if (document.pointerLockElement === video) {
        void document.exitPointerLock()
      }
    }
  }, [inputChannel, videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !inputChannel) return

    const onMouseMoveAbsolute = (event: PointerEvent | MouseEvent) => {
      if (modeRef.current !== 'absolute') return
      const now = performance.now()
      if (now - lastMouseMoveRef.current < MOUSE_MOVE_INTERVAL_MS) return

      const rect = video.getBoundingClientRect()
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return
      }

      lastMouseMoveRef.current = now
      updateLocalCursor(event as MouseEvent, video)
      const width = video.videoWidth > 0 ? video.videoWidth : nativeWidth
      const height = video.videoHeight > 0 ? video.videoHeight : nativeHeight
      const { x, y } = getAbsoluteCoordinates(event as MouseEvent, video, width, height)
      sendInput(inputChannel, { type: 'MOUSE_MOVE_ABS', x, y })
    }

    const onMouseDown = (event: MouseEvent) => {
      if (modeRef.current !== 'absolute') return
      event.preventDefault()
      const width = video.videoWidth > 0 ? video.videoWidth : nativeWidth
      const height = video.videoHeight > 0 ? video.videoHeight : nativeHeight
      const { x, y } = getAbsoluteCoordinates(event, video, width, height)
      sendInput(inputChannel, {
        type: 'MOUSE_DOWN',
        button: domButtonToPayload(event.button),
        x,
        y,
      })
    }

    const onMouseUp = (event: MouseEvent) => {
      if (modeRef.current !== 'absolute') return
      const width = video.videoWidth > 0 ? video.videoWidth : nativeWidth
      const height = video.videoHeight > 0 ? video.videoHeight : nativeHeight
      const { x, y } = getAbsoluteCoordinates(event, video, width, height)
      sendInput(inputChannel, {
        type: 'MOUSE_UP',
        button: domButtonToPayload(event.button),
        x,
        y,
      })
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      sendInput(inputChannel, {
        type: 'MOUSE_SCROLL',
        delta_x: event.deltaX,
        delta_y: event.deltaY,
      })
    }

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }

    const onMouseLeave = () => {
      if (cursorElRef.current) {
        cursorElRef.current.style.display = 'none'
      }
    }

    document.addEventListener('pointermove', onMouseMoveAbsolute)
    video.addEventListener('mousedown', onMouseDown)
    video.addEventListener('mouseup', onMouseUp)
    video.addEventListener('wheel', onWheel, { passive: false })
    video.addEventListener('contextmenu', onContextMenu)
    video.addEventListener('mouseleave', onMouseLeave)

    return () => {
      document.removeEventListener('pointermove', onMouseMoveAbsolute)
      video.removeEventListener('mousedown', onMouseDown)
      video.removeEventListener('mouseup', onMouseUp)
      video.removeEventListener('wheel', onWheel)
      video.removeEventListener('contextmenu', onContextMenu)
      video.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [inputChannel, nativeHeight, nativeWidth, updateLocalCursor, videoRef])

  useEffect(() => {
    return () => {
      releaseKeyboardLock()
    }
  }, [releaseKeyboardLock])

  return {
    activateKeyboardLock,
    releaseKeyboardLock,
    setMode,
    mode,
    showFullscreenPrompt,
    dismissFullscreenPrompt,
  }
}
