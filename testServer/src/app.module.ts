import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { SignalingModule } from './signaling/signaling.module';
import { SharedModule } from './shared/shared.module';
import { StorageModule } from './storage/storage.module';
import { TurnModule } from './turn/turn.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StorageModule,
    SharedModule,
    AuthModule,
    AgentsModule,
    SignalingModule,
    TurnModule,
  ],
})
export class AppModule {}
