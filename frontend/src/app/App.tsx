import { lazy, Suspense } from 'react'
import { SplashScreen } from '@/components/layout/SplashScreen'
import { useDeviceType } from '@/hooks/useDeviceType'

const DesktopRouter = lazy(() => import('@/app/DesktopRouter'))
const MobileRouter = lazy(() => import('@/app/MobileRouter'))

export function App() {
  const role = useDeviceType()

  return (
    <Suspense fallback={<SplashScreen />}>
      {role === 'desktop-viewer' ? <DesktopRouter /> : <MobileRouter />}
    </Suspense>
  )
}
