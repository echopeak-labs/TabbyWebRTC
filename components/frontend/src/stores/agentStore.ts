import { create } from 'zustand'
import type { AppWindow, Display } from '@/types/agent'

interface AgentState {
  displays: Display[]
  apps: AppWindow[]
  agentBaseUrl: string | null
  localToken: string | null
  setDisplays: (displays: Display[]) => void
  setApps: (apps: AppWindow[]) => void
  setAgentBaseUrl: (url: string | null) => void
  setLocalToken: (token: string | null) => void
  setSourceInUse: (sourceId: string, inUse: boolean) => void
  setThumbnail: (sourceId: string, thumbnailUrl: string | null) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  displays: [],
  apps: [],
  agentBaseUrl: null,
  localToken: null,
  setDisplays: (displays) => set({ displays }),
  setApps: (apps) => set({ apps }),
  setAgentBaseUrl: (agentBaseUrl) => set({ agentBaseUrl }),
  setLocalToken: (localToken) => set({ localToken }),
  setSourceInUse: (sourceId, inUse) =>
    set((state) => ({
      displays: state.displays.map((d) =>
        d.id === sourceId ? { ...d, inUse } : d,
      ),
      apps: state.apps.map((a) =>
        a.id === sourceId ? { ...a, inUse } : a,
      ),
    })),
  setThumbnail: (sourceId, thumbnailUrl) =>
    set((state) => ({
      displays: state.displays.map((d) =>
        d.id === sourceId ? { ...d, thumbnailUrl } : d,
      ),
      apps: state.apps.map((a) =>
        a.id === sourceId ? { ...a, thumbnailUrl } : a,
      ),
    })),
}))
