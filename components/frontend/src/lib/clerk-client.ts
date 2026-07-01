import type { PairedAgent } from '@/types/agent'

const PAIRED_AGENTS_KEY = 'pairedAgents'

type MetadataWithAgents = {
  pairedAgents?: PairedAgent[]
}

type ClerkUser = {
  id: string
  publicMetadata: Record<string, unknown>
  unsafeMetadata: Record<string, unknown>
  update: (params: { unsafeMetadata: Record<string, unknown> }) => Promise<ClerkUser>
}

export function getPairedAgentsFromUser(user: ClerkUser): PairedAgent[] {
  const publicAgents = (user.publicMetadata as MetadataWithAgents).pairedAgents
  if (publicAgents && Array.isArray(publicAgents)) {
    return publicAgents
  }
  const unsafeAgents = (user.unsafeMetadata as MetadataWithAgents).pairedAgents
  if (unsafeAgents && Array.isArray(unsafeAgents)) {
    return unsafeAgents
  }
  return []
}

export async function savePairedAgentsToUser(
  user: ClerkUser,
  agents: PairedAgent[],
): Promise<void> {
  await user.update({
    unsafeMetadata: {
      ...user.unsafeMetadata,
      [PAIRED_AGENTS_KEY]: agents,
    },
  })
}

export async function addPairedAgent(
  user: ClerkUser,
  agent: PairedAgent,
): Promise<PairedAgent[]> {
  const existing = getPairedAgentsFromUser(user)
  const updated = [...existing.filter((a) => a.agentId !== agent.agentId), agent]
  await savePairedAgentsToUser(user, updated)
  return updated
}
