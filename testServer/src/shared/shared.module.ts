import { Global, Module } from '@nestjs/common';
import { AgentWsHandlerService } from './agent-ws-handler.service';
import { AgentsService } from './agents.service';
import { AuthHandlerService } from './auth-handler.service';
import { ConnectionsService } from './connections.service';
import { MessageRouterService } from './message-router.service';
import { MessageSenderService } from './message-sender.service';
import { PendingSessionsService } from './pending-sessions.service';
import { SignalingHandlerService } from './signaling-handler.service';

@Global()
@Module({
  providers: [
    MessageSenderService,
    ConnectionsService,
    AgentsService,
    PendingSessionsService,
    AuthHandlerService,
    AgentWsHandlerService,
    SignalingHandlerService,
    MessageRouterService,
  ],
  exports: [
    MessageSenderService,
    ConnectionsService,
    AgentsService,
    PendingSessionsService,
    AuthHandlerService,
    AgentWsHandlerService,
    SignalingHandlerService,
    MessageRouterService,
  ],
})
export class SharedModule {}
