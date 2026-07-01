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

export default function MobileRouter() {
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <BrowserRouter>
        <MobileRoutes />
      </BrowserRouter>
    </ClerkProvider>
  )
}
