import { create } from 'zustand'
import type { PairedAgent } from '@/types/agent'
import type { QRPayload } from '@/types/auth'

interface MobileState {
  clerkUserId: string | null
  pairedAgents: PairedAgent[]
  pendingScanPayload: QRPayload | null
  setClerkUserId: (id: string | null) => void
  setPairedAgents: (agents: PairedAgent[]) => void
  addPairedAgent: (agent: PairedAgent) => void
  setPendingScanPayload: (payload: QRPayload) => void
  clearPendingScan: () => void
}

export const useMobileStore = create<MobileState>((set) => ({
  clerkUserId: null,
  pairedAgents: [],
  pendingScanPayload: null,
  setClerkUserId: (clerkUserId) => set({ clerkUserId }),
  setPairedAgents: (pairedAgents) => set({ pairedAgents }),
  addPairedAgent: (agent) =>
    set((state) => ({
      pairedAgents: [...state.pairedAgents.filter((a) => a.agentId !== agent.agentId), agent],
    })),
  setPendingScanPayload: (pendingScanPayload) => set({ pendingScanPayload }),
  clearPendingScan: () => set({ pendingScanPayload: null }),
}))
