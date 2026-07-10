import { useAuth } from '@clerk/clerk-react'
import { ArrowLeft, Check, Monitor } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import nacl from 'tweetnacl'
import { decodeUTF8, encodeBase64 } from 'tweetnacl-util'
import { Button } from '@/components/ui/button'
import { ed25519PublicToX25519 } from '@/lib/ed2curve'
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
  const recipientKey = ed25519PublicToX25519(decodePublicKey(publicKey))
  const ephemeral = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const encrypted = nacl.box(salt, nonce, recipientKey, ephemeral.secretKey)
  if (!encrypted) {
    throw new Error('Failed to encrypt session salt')
  }
  const combined = new Uint8Array(
    ephemeral.publicKey.length + nonce.length + encrypted.length,
  )
  combined.set(ephemeral.publicKey, 0)
  combined.set(nonce, ephemeral.publicKey.length)
  combined.set(encrypted, ephemeral.publicKey.length + nonce.length)
  return encodeBase64(combined)
}

async function tryLocalEndpoint(agent: PairedAgent): Promise<{ url: string; localToken: string } | undefined> {
  const host = window.location.hostname
  const pageLan =
    host && host !== 'localhost' && host !== '127.0.0.1'
      ? `http://${host}:7700`
      : undefined
  const candidates = [agent.localEndpoint, pageLan].filter(
    (value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index,
  )

  for (const base of candidates) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      const response = await fetch(`${base.replace(/\/$/, '')}/info`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok) {
        continue
      }
      const info = (await response.json()) as { agentId?: string; localToken?: string }
      if (info.agentId === agent.agentId && info.localToken) {
        return { url: base.replace(/\/$/, ''), localToken: info.localToken }
      }
    } catch {
    }
  }
  return undefined
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
        <p className="mt-2 text-center text-textMuted">
          {selectedAgent.name} can stream to the browser that showed the QR.
        </p>
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
        <h1 className="text-base font-medium text-textPrimary">Approve session</h1>
      </header>

      <div className="flex flex-1 flex-col p-4">
        <p className="mb-3 text-sm text-textMuted">Connect the scanned browser to:</p>

        {pairedAgents.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-textPrimary">
              This desktop QR is ready, but no machine is paired to your account yet.
            </p>
            <p className="text-sm text-textMuted">
              One-time setup: on the PC, run the agent until it prints a PAIR QR, then pair it from
              your phone. After that, scan this desktop QR again to approve.
            </p>
            <Button
              className="min-h-11 w-full"
              onClick={() => navigate('/scan?mode=pair')}
            >
              Pair a machine
            </Button>
          </div>
        ) : pairedAgents.length === 1 && selectedAgent ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <Monitor className="h-6 w-6 text-primary" />
              <div>
                <p className="font-medium text-textPrimary">{selectedAgent.name}</p>
                <p className="text-sm text-textMuted">{platformLabel(selectedAgent.platform)}</p>
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

        {pairedAgents.length > 0 && (
          <p className="mt-6 text-sm text-textMuted">
            You’re already signed in. Approving links this browser tab to the selected machine.
          </p>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>

      <div className="space-y-3 border-t border-border p-4">
        <Button
          className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={approving || !selectedAgent}
          onClick={() => void handleApprove()}
        >
          {approving ? 'Connecting…' : 'Approve'}
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
