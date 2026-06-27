import { create } from 'zustand'
import type { AppWindow, Display } from '@/types/agent'

interface AgentState {
  displays: Display[]
  apps: AppWindow[]
  setDisplays: (displays: Display[]) => void
  setApps: (apps: AppWindow[]) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  displays: [],
  apps: [],
  setDisplays: (displays) => set({ displays }),
  setApps: (apps) => set({ apps }),
}))
