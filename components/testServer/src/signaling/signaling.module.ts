import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';
import { WsConnectService } from './ws-connect.service';

@Module({
  providers: [SignalingGateway, WsConnectService],
})
export class SignalingModule {}
