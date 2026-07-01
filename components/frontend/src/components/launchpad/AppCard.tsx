import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AppWindow } from '@/types/agent'

export interface AppCardProps {
  app: AppWindow
  offline?: boolean
  loading?: boolean
  onClick: (appId: string) => void
}

function truncateName(name: string, max = 40): string {
  if (name.length <= max) {
    return name
  }
  return `${name.slice(0, max - 1)}…`
}

export function AppCard({ app, offline = false, loading = false, onClick }: AppCardProps) {
  const inUse = app.inUse
  const disabled = offline || inUse || loading

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(app.id)}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border bg-surface p-3 text-left transition-colors',
        offline && 'cursor-not-allowed border-dashed border-border opacity-60',
        !offline && !inUse && !loading && 'border-border hover:border-primary',
        inUse && 'cursor-not-allowed border-border opacity-80',
        loading && 'cursor-wait border-primary opacity-80',
      )}
    >
      <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-background">
        {app.thumbnailUrl ? (
          <img
            src={app.thumbnailUrl}
            alt={app.name}
            className={cn('h-full w-full object-cover', inUse && 'grayscale')}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-[10px] text-textMuted">App</span>
          </div>
        )}
        {inUse && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Lock className="h-4 w-4 text-textPrimary" />
          </div>
        )}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm text-textPrimary">
        {truncateName(app.name)}
      </span>
      {inUse && (
        <Badge variant="secondary" className="shrink-0">
          In use
        </Badge>
      )}
    </button>
  )
}
