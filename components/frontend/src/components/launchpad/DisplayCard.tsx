import { Loader2, Lock, Monitor } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Display } from '@/types/agent'

export interface DisplayCardProps {
  display: Display
  offline?: boolean
  loading?: boolean
  onClick: (displayId: string) => void
}

export function DisplayCard({ display, offline = false, loading = false, onClick }: DisplayCardProps) {
  const inUse = display.inUse
  const disabled = offline || inUse || loading

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(display.id)}
      className={cn(
        'group relative flex w-full flex-col overflow-hidden rounded-lg border bg-surface text-left transition-colors',
        offline && 'cursor-not-allowed border-dashed border-border',
        !offline && !inUse && !loading && 'border-border hover:border-primary',
        inUse && 'cursor-not-allowed border-border opacity-80',
        loading && 'cursor-wait border-primary ring-2 ring-primary/50 ring-offset-2 ring-offset-background animate-pulse',
      )}
    >
      <div className="relative aspect-video w-full bg-background">
        {display.thumbnailUrl ? (
          <img
            src={display.thumbnailUrl}
            alt={display.name}
            className={cn('h-full w-full object-cover', inUse && 'grayscale')}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-background">
            <Monitor className="h-10 w-10 text-textMuted" />
          </div>
        )}
        {inUse && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Lock className="h-8 w-8 text-textPrimary" />
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        {offline && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <span className="text-sm text-textMuted">Unavailable</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="truncate text-sm font-medium text-textPrimary">{display.name}</span>
        {inUse && (
          <Badge variant="secondary" className="shrink-0">
            In use
          </Badge>
        )}
      </div>
    </button>
  )
}
