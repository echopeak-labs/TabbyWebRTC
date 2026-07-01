import { SignIn, useAuth } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function MobileSignInPage() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate('/agents', { replace: true })
    }
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded) {
    return null
  }

  if (isSignedIn) {
    return null
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <h1 className="mb-2 text-3xl font-bold text-primary">TabbyWebRTC</h1>
      <p className="mb-8 text-textMuted">Sign in to continue</p>
      <div className="w-full max-w-sm">
        <SignIn
          routing="hash"
          appearance={{
            variables: {
              colorBackground: '#0a0a0a',
              colorInputBackground: '#141414',
              colorInputText: '#f5f5f5',
              colorText: '#f5f5f5',
              colorTextSecondary: '#737373',
              colorPrimary: '#f59e0b',
              colorDanger: '#ef4444',
              borderRadius: '0.5rem',
            },
            elements: {
              card: 'bg-card border border-border shadow-none',
              headerTitle: 'text-textPrimary',
              headerSubtitle: 'text-textMuted',
              socialButtonsBlockButton: 'border-border bg-secondary text-textPrimary min-h-11',
              formButtonPrimary: 'bg-primary text-primary-foreground hover:bg-primary/90 min-h-11',
              formFieldInput: 'bg-background border-input text-textPrimary min-h-11',
              footerActionLink: 'text-primary',
            },
          }}
        />
      </div>
    </div>
  )
}
