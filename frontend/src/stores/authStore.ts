import { create } from 'zustand'

interface AuthState {
  token: string | null
  agentId: string | null
  setToken: (token: string) => void
  setSession: (token: string, agentId: string) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  agentId: null,
  setToken: (token) => set({ token }),
  setSession: (token, agentId) => set({ token, agentId }),
  clearSession: () => set({ token: null, agentId: null }),
}))
