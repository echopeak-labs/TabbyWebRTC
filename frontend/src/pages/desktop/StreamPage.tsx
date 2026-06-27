import { useParams } from 'react-router-dom'

export function StreamPage() {
  const { sourceId } = useParams<{ sourceId: string }>()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-textMuted">Stream view for {sourceId}</p>
    </div>
  )
}
