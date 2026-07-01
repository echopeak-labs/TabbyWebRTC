import { Global, Module } from '@nestjs/common';
import { AgentStore } from './agent.store';
import { ConnectionStore } from './connection.store';
import { PendingSessionStore } from './pending-session.store';
import { SourceLockStore } from './source-lock.store';

@Global()
@Module({
  providers: [ConnectionStore, PendingSessionStore, AgentStore, SourceLockStore],
  exports: [ConnectionStore, PendingSessionStore, AgentStore, SourceLockStore],
})
export class StorageModule {}
