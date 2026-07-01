import { useAuth } from '@clerk/clerk-react'
import { ArrowLeft, Check, Monitor } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import nacl from 'tweetnacl'
import { decodeUTF8, encodeBase64 } from 'tweetnacl-util'
import { Button } from '@/components/ui/button'
import { useMobileStore } from '@/stores/mobileStore'
import { isSessionQRPayload } from '@/types/auth'
import type { PairedAgent } from '@/types/agent'

const REST_URL = import.meta.env.VITE_REST_URL

function platformLabel(platform: string): string {
  switch (platform) {
    case 'windows':
      return 'Windows'
    case 'macos':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

function decodePublicKey(publicKey: string): Uint8Array {
  try {
    const binary = atob(publicKey)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return decodeUTF8(publicKey)
  }
}

function encryptSalt(publicKey: string, salt: Uint8Array): string {
  const recipientKey = decodePublicKey(publicKey)
  const ephemeral = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const encrypted = nacl.box(salt, nonce, recipientKey, ephemeral.secretKey)
  const combined = new Uint8Array(
    ephemeral.publicKey.length + nonce.length + encrypted.length,
  )
  combined.set(ephemeral.publicKey, 0)
  combined.set(nonce, ephemeral.publicKey.length)
  combined.set(encrypted, ephemeral.publicKey.length + nonce.length)
  return encodeBase64(combined)
}

async function tryLocalEndpoint(agent: PairedAgent): Promise<{ url: string; localToken: string } | undefined> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const response = await fetch(`http://127.0.0.1:7700/info`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) {
      return undefined
    }
    const info = (await response.json()) as { agentId?: string; localToken?: string }
    if (info.agentId === agent.agentId && info.localToken) {
      return { url: 'http://127.0.0.1:7700', localToken: info.localToken }
    }
  } catch {
    return undefined
  }
  return undefined
}

async function confirmIdentity(getToken: () => Promise<string | null>): Promise<boolean> {
  if (window.PublicKeyCredential) {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'required',
          rpId: window.location.hostname,
        },
      })
      return true
    } catch {
      // fall through to Clerk
    }
  }
  const token = await getToken()
  return token !== null
}

export function MobileApprovePage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const pendingScanPayload = useMobileStore((s) => s.pendingScanPayload)
  const pairedAgents = useMobileStore((s) => s.pairedAgents)
  const clearPendingScan = useMobileStore((s) => s.clearPendingScan)

  const [selectedAgent, setSelectedAgent] = useState<PairedAgent | null>(null)
  const [approving, setApproving] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingScanPayload || !isSessionQRPayload(pendingScanPayload)) {
      navigate('/scan', { replace: true })
      return
    }
    if (pairedAgents.length > 0 && !selectedAgent) {
      setSelectedAgent(pairedAgents[0] ?? null)
    }
  }, [navigate, pairedAgents, pendingScanPayload, selectedAgent])

  const handleApprove = useCallback(async () => {
    if (!pendingScanPayload || !isSessionQRPayload(pendingScanPayload) || !selectedAgent) {
      return
    }
    setApproving(true)
    setError(null)
    try {
      const verified = await confirmIdentity(getToken)
      if (!verified) {
        throw new Error('Identity verification failed')
      }
      const clerkJwt = await getToken()
      if (!clerkJwt) {
        throw new Error('Not authenticated')
      }
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const encryptedSalt = encryptSalt(selectedAgent.publicKey, salt)
      const localEndpoint = await tryLocalEndpoint(selectedAgent)
      const response = await fetch(`${REST_URL}/auth/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${clerkJwt}`,
        },
        body: JSON.stringify({
          pendingSessionId: pendingScanPayload.pendingSessionId,
          agentId: selectedAgent.agentId,
          encryptedSalt,
          ...(localEndpoint ? { localEndpoint } : {}),
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Approval failed')
      }
      setConfirmed(true)
      clearPendingScan()
      setTimeout(() => {
        navigate('/agents', { replace: true })
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed')
      setApproving(false)
    }
  }, [clearPendingScan, getToken, navigate, pendingScanPayload, selectedAgent])

  if (!pendingScanPayload || !isSessionQRPayload(pendingScanPayload)) {
    return null
  }

  if (confirmed && selectedAgent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <Check className="h-8 w-8 text-green-500" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-textPrimary">Desktop connected</h1>
        <p className="mt-2 text-textMuted">{selectedAgent.name}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          onClick={() => {
            clearPendingScan()
            navigate('/scan')
          }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-base font-medium text-textPrimary">Authorize Connection</h1>
      </header>

      <div className="flex flex-1 flex-col p-4">
        <p className="mb-3 text-sm text-textMuted">Connecting to:</p>

        {pairedAgents.length === 0 ? (
          <p className="text-sm text-destructive">No paired agents. Pair a machine first.</p>
        ) : pairedAgents.length === 1 && selectedAgent ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <Monitor className="h-6 w-6 text-primary" />
              <div>
                <p className="font-medium text-textPrimary">{selectedAgent.name}</p>
                <p className="text-sm text-textMuted">
                  {platformLabel(selectedAgent.platform)} · Last seen now
                </p>
              </div>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {pairedAgents.map((agent) => (
              <li key={agent.agentId}>
                <button
                  type="button"
                  onClick={() => setSelectedAgent(agent)}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg border p-4 text-left ${
                    selectedAgent?.agentId === agent.agentId
                      ? 'border-primary bg-card'
                      : 'border-border bg-card'
                  }`}
                >
                  <Monitor className="h-6 w-6 text-primary" />
                  <div>
                    <p className="font-medium text-textPrimary">{agent.name}</p>
                    <p className="text-sm text-textMuted">{platformLabel(agent.platform)}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-sm text-textMuted">
          This will grant access to your desktop from the scanned device.
        </p>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>

      <div className="space-y-3 border-t border-border p-4">
        <Button
          className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={approving || !selectedAgent}
          onClick={() => void handleApprove()}
        >
          {approving ? 'Approving…' : 'Approve with Face ID'}
        </Button>
        <Button
          variant="ghost"
          className="h-11 w-full"
          disabled={approving}
          onClick={() => {
            clearPendingScan()
            navigate('/agents')
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
