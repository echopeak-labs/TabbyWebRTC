import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function MobileAgentsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col p-4">
        <h1 className="text-xl font-semibold text-textPrimary">Paired Agents</h1>
        <p className="mt-2 text-textMuted">Agent list placeholder</p>
      </div>
      <div className="border-t border-border p-4">
        <Button asChild className="h-11 w-full">
          <Link to="/scan">Scan QR</Link>
        </Button>
      </div>
    </div>
  )
}
