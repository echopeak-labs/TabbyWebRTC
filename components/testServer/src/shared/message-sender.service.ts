import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { ConnectionStore } from '../storage/connection.store';

@Injectable()
export class MessageSenderService {
  private readonly sockets = new Map<string, WebSocket>();

  constructor(private readonly connections: ConnectionStore) {}

  registerSocket(connectionId: string, socket: WebSocket): void {
    this.sockets.set(connectionId, socket);
  }

  unregisterSocket(connectionId: string): void {
    this.sockets.delete(connectionId);
  }

  async sendToConnection(connectionId: string, payload: object): Promise<void> {
    const socket = this.sockets.get(connectionId);
    if (!socket || socket.readyState !== socket.OPEN) {
      this.sockets.delete(connectionId);
      this.connections.delete(connectionId);
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  clear(): void {
    this.sockets.clear();
  }
}
