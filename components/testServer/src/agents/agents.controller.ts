import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  extractBearerToken,
  issueAgentJwt,
  verifyClerkJwt,
  verifyTabbyWebRTCToken,
} from '../shared/jwt';
import { AgentsService } from '../shared/agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  async listAgents(@Headers('authorization') authorization: string | undefined) {
    const token = extractBearerToken(authorization);
    if (!token) {
      throw new HttpException({ error: 'Missing authorization' }, 401);
    }

    try {
      const payload = await verifyTabbyWebRTCToken(token);
      const userId = payload.sub!;
      const agentList = this.agents.listAgentsByUserId(userId);

      return {
        agents: agentList.map((agent) => ({
          id: agent.agentId,
          name: agent.name ?? agent.agentId,
          platform: agent.platform,
          online: agent.online,
          lastSeen: new Date(agent.lastSeen).toISOString(),
        })),
      };
    } catch {
      throw new HttpException({ error: 'Invalid token' }, 401);
    }
  }

  @Get('pair-claim')
  pairClaim(
    @Query('agentId') agentId: string | undefined,
    @Query('nonce') nonce: string | undefined,
  ) {
    if (!agentId || !nonce) {
      throw new HttpException({ error: 'agentId and nonce are required' }, 400);
    }
    const agentJwt = this.agents.consumePairingClaim(agentId, nonce);
    if (!agentJwt) {
      throw new HttpException({ error: 'Pairing claim not found or expired' }, 404);
    }
    return { agentJwt };
  }

  @Post('pair')
  async pairAgent(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      agentId?: string;
      publicKey?: string;
      platform?: string;
      name?: string;
      pairingNonce?: string;
    },
  ) {
    const clerkToken = extractBearerToken(authorization);
    if (!clerkToken) {
      throw new HttpException({ error: 'Missing authorization' }, 401);
    }

    if (!body.agentId || !body.publicKey || !body.platform || !body.name) {
      throw new HttpException(
        { error: 'agentId, publicKey, platform, and name are required' },
        400,
      );
    }

    try {
      const { userId } = await verifyClerkJwt(clerkToken);
      const existing = this.agents.getAgent(body.agentId);
      if (existing && existing.userId !== userId) {
        throw new HttpException({ error: 'Agent already paired to another user' }, 403);
      }

      const agentJwt = await issueAgentJwt(body.agentId, userId);
      const pairingNonce = body.pairingNonce || randomUUID();

      await this.agents.pairAgent({
        agentId: body.agentId,
        userId,
        publicKey: body.publicKey,
        platform: body.platform,
        name: body.name,
        pairingToken: agentJwt,
        pairingNonce,
      });

      return { agentJwt, pairingNonce };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Pairing failed';
      if (message === 'INVALID_CLERK_JWT') {
        throw new HttpException({ error: 'Invalid Clerk token' }, 401);
      }
      throw new HttpException({ error: message }, 500);
    }
  }
}
