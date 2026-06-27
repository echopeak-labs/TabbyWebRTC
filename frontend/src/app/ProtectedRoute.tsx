import { Navigate, Outlet } from 'react-router-dom'

const SESSION_TOKEN_KEY = 'tabbyrdp_token'

export function hasSessionToken(): boolean {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) !== null
}

export function ProtectedRoute() {
  if (!hasSessionToken()) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}
