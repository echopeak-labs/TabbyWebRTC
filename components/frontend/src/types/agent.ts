export interface Display {
  id: string
  name: string
  width: number
  height: number
  thumbnailUrl: string | null
  inUse: boolean
}

export interface AppWindow {
  id: string
  name: string
  pid: number
  thumbnailUrl: string | null
  inUse: boolean
}

export interface PairedAgent {
  agentId: string
  name: string
  platform: 'windows' | 'macos' | 'linux'
  publicKey: string
  lastSeen: string
}
