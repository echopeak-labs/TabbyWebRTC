import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/app/ProtectedRoute'
import { ConnectPage } from '@/pages/desktop/ConnectPage'
import { LaunchpadPage } from '@/pages/desktop/LaunchpadPage'
import { StreamPage } from '@/pages/desktop/StreamPage'

export default function DesktopRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConnectPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/launchpad" element={<LaunchpadPage />} />
          <Route path="/stream/:sourceId" element={<StreamPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
