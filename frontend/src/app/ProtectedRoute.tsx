import { Navigate, Outlet } from 'react-router-dom'
import { readSession } from '@/lib/auth-sync'

export function hasSessionToken(): boolean {
  return readSession() !== null
}

export function ProtectedRoute() {
  if (!hasSessionToken()) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}
