import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ProtectedRoute } from '@/app/ProtectedRoute'
import { initAuthSync } from '@/lib/auth-sync'
import { ConnectPage } from '@/pages/desktop/ConnectPage'
import { LaunchpadPage } from '@/pages/desktop/LaunchpadPage'
import { StreamPage } from '@/pages/desktop/StreamPage'

function DesktopAuthBootstrap({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    initAuthSync().then((session) => {
      if (cancelled) {
        return
      }
      if (session && (window.location.pathname === '/' || window.location.pathname === '')) {
        navigate('/launchpad', { replace: true })
      }
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (!ready) {
    return null
  }

  return children
}

function DesktopRoutes() {
  return (
    <DesktopAuthBootstrap>
      <Routes>
        <Route path="/" element={<ConnectPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/launchpad" element={<LaunchpadPage />} />
          <Route path="/stream/:sourceId" element={<StreamPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DesktopAuthBootstrap>
  )
}

export default function DesktopRouter() {
  return (
    <BrowserRouter>
      <DesktopRoutes />
    </BrowserRouter>
  )
}
