import { Body, Controller, Headers, HttpException, Post } from '@nestjs/common';
import { extractBearerToken } from '../shared/jwt';
import { AuthHandlerService } from '../shared/auth-handler.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authHandler: AuthHandlerService) {}

  @Post('approve')
  async approve(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: {
      pendingSessionId?: string;
      agentId?: string;
      encryptedSalt?: string;
      localEndpoint?: { url: string; localToken: string };
    },
  ) {
    const clerkToken = extractBearerToken(authorization);
    if (!clerkToken) {
      throw new HttpException({ error: 'Missing authorization' }, 401);
    }

    if (!body.pendingSessionId || !body.agentId) {
      throw new HttpException(
        { error: 'pendingSessionId and agentId are required' },
        400,
      );
    }

    try {
      const result = await this.authHandler.handleAuthApprove(
        clerkToken,
        body.pendingSessionId,
        body.agentId,
        body.encryptedSalt,
        body.localEndpoint,
      );
      if (result.status !== 200) {
        throw new HttpException(result.body, result.status);
      }
      return result.body;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Authorization failed';
      if (message === 'INVALID_CLERK_JWT') {
        throw new HttpException({ error: 'Invalid Clerk token' }, 401);
      }
      throw new HttpException({ error: message }, 500);
    }
  }
}
