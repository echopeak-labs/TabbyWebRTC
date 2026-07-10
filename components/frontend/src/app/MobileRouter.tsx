import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { MobileAgentsPage } from '@/pages/mobile/MobileAgentsPage'
import { MobileApprovePage } from '@/pages/mobile/MobileApprovePage'
import { MobileScanPage } from '@/pages/mobile/MobileScanPage'
import { MobileSignInPage } from '@/pages/mobile/MobileSignInPage'

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function ClerkAuthGuard() {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return null
  }

  if (!isSignedIn) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

function MobileRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MobileSignInPage />} />
      <Route element={<ClerkAuthGuard />}>
        <Route path="/scan" element={<MobileScanPage />} />
        <Route path="/approve" element={<MobileApprovePage />} />
        <Route path="/agents" element={<MobileAgentsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function MissingClerkConfig() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <h1 className="mb-2 text-3xl font-bold text-primary">TabbyWebRTC</h1>
      <p className="mb-2 text-lg font-medium text-textPrimary">Mobile auth is not configured</p>
      <p className="max-w-sm text-sm text-textMuted">
        Set <code className="text-textPrimary">VITE_CLERK_PUBLISHABLE_KEY</code> in the frontend
        environment, then rebuild or restart the dev server.
      </p>
    </div>
  )
}

export default function MobileRouter() {
  if (!clerkKey) {
    return <MissingClerkConfig />
  }

  return (
    <ClerkProvider publishableKey={clerkKey}>
      <BrowserRouter>
        <MobileRoutes />
      </BrowserRouter>
    </ClerkProvider>
  )
}
