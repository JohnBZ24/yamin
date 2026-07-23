import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { AllConfigType } from '../config/config.type';
import { RealtimeNotifier, userRoom } from '../realtime/realtime.constants';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class VoiceGateway
  implements OnGatewayConnection, OnGatewayDisconnect, RealtimeNotifier
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token;

      if (!token) {
        this.logger.warn(`Disconnecting client: No JWT token found in handshake`);
        socket.disconnect();
        return;
      }

      // Strip "Bearer " prefix if present
      const cleanToken = token.startsWith('Bearer ') ? token.substring(7) : token;
      const secret = this.configService.get('auth.secret', { infer: true });

      const payload = await this.jwtService.verifyAsync(cleanToken, { secret });
      const userId = payload.id;

      if (!userId) {
        socket.disconnect();
        return;
      }

      // Join the user's room. The Redis adapter replicates room membership, so
      // any instance — including the worker's emitter — can reach this socket.
      socket.data.userId = userId;
      await socket.join(userRoom(userId));

      this.logger.log(`Client connected: Socket ID ${socket.id} bound to User ID ${userId}`);
    } catch (err) {
      this.logger.error(`WebSocket connection verification failed: ${err.message}`);
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket) {
    // socket.io removes the socket from its rooms automatically on disconnect;
    // there is no membership bookkeeping left to do here.
    const userId = socket.data.userId;
    if (userId) {
      this.logger.log(`Client disconnected: Socket ID ${socket.id} (User ID ${userId})`);
    }
  }

  /**
   * In-process send, for use by the API itself. The worker cannot use this —
   * it has no socket.io server — and instead publishes through
   * RedisEmitterNotifier, which lands in this same room.
   */
  async sendToUser(userId: number, event: string, payload: unknown): Promise<void> {
    this.server.to(userRoom(userId)).emit(event, payload);
    this.logger.log(`WS pushed event '${event}' to User ID ${userId}`);
  }
}
