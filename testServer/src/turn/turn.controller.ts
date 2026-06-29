import { Controller, Get, Headers, HttpException } from '@nestjs/common';
import {
  extractBearerToken,
  generateTurnCredential,
  verifyTabbyRDPToken,
} from '../shared/jwt';
import { ConfigService } from '@nestjs/config';

const TURN_CREDENTIAL_TTL_SECONDS = 86400;

@Controller()
export class TurnController {
  constructor(private readonly config: ConfigService) {}

  @Get('turn-credentials')
  async getTurnCredentials(@Headers('authorization') authorization: string | undefined) {
    const token = extractBearerToken(authorization);
    if (!token) {
      throw new HttpException({ error: 'Missing authorization' }, 401);
    }

    try {
      await verifyTabbyRDPToken(token);
    } catch {
      throw new HttpException({ error: 'Invalid token' }, 401);
    }

    const turnSecret = this.config.get<string>('TURN_SECRET');
    const turnUrls = this.config.get<string>('TURN_URLS');
    if (!turnSecret || !turnUrls) {
      throw new HttpException({ error: 'TURN not configured' }, 500);
    }

    const { username, credential, ttl } = generateTurnCredential(
      turnSecret,
      TURN_CREDENTIAL_TTL_SECONDS,
    );

    return {
      urls: turnUrls.split(',').map((url) => url.trim()).filter(Boolean),
      username,
      credential,
      ttl,
    };
  }
}
