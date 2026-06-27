import { useEffect, useState } from 'react'
import { subscribeToast } from '@/lib/toast'

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    return subscribeToast((msg) => {
      setMessage(msg)
    })
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [message])

  if (!message) {
    return null
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-surfaceHigh px-4 py-2 text-sm text-textPrimary shadow-lg border border-border">
      {message}
    </div>
  )
}
