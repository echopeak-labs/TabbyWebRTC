import { useSyncExternalStore } from 'react'
import type { DeviceRole } from '@/types/device'

function getDeviceRole(): DeviceRole {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return coarsePointer || mobileUA ? 'mobile-key' : 'desktop-viewer'
}

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia('(pointer: coarse)')
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

export function useDeviceType(): DeviceRole {
  return useSyncExternalStore(subscribe, getDeviceRole, () => 'desktop-viewer')
}
