import { create } from 'zustand'

interface AuthState {
  token: string | null
  agentId: string | null
  setToken: (token: string) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  agentId: null,
  setToken: (token) => set({ token }),
  clearSession: () => set({ token: null, agentId: null }),
}))
