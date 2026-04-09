import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { UserService } from '../user/user.service';
import { RealtimeChatService } from './realtime-chat.service';
import { JoinChatDto } from './dto/join-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { TypingDto } from './dto/typing.dto';
import { MarkReadDto } from './dto/mark-read.dto';

type SocketUser = {
  userId: number;
  email: string;
  sub: number;
  userType?: string;
};

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  pingInterval: 25000,
  pingTimeout: 20000,
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class RealtimeChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeChatGateway.name);
  /** Track online users: userId -> Set of socketIds */
  private onlineUsers = new Map<number, Set<string>>();

  constructor(
    private readonly chatService: RealtimeChatService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly userService: UserService,
  ) {}

  /* ── Auth middleware — runs BEFORE handleConnection ─────────── */

  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          return next(new Error('UNAUTHORIZED: Missing token'));
        }

        const payload = this.jwtService.verify<{
          sub: number;
          email: string;
          userType?: string;
        }>(token, {
          secret: this.config.get<string>('JWT_SECRET') || 'change-me',
        });

        const dbUser = await this.userService.findById(Number(payload.sub));
        if (!dbUser) {
          return next(new Error('UNAUTHORIZED: User not found'));
        }

        // Attach user to socket — this is guaranteed to finish
        // BEFORE handleConnection and any event handlers run
        socket.data.user = {
          userId: Number(payload.sub),
          sub: Number(payload.sub),
          email: payload.email,
          userType: dbUser.userType,
        } as SocketUser;

        next();
      } catch (err) {
        next(new Error('UNAUTHORIZED: Invalid or expired token'));
      }
    });

    this.logger.log('Socket.IO auth middleware registered');
  }

  /* ── connection lifecycle ────────────────────────────────────── */

  private extractToken(socket: Socket): string | null {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim();
    }
    return null;
  }

  handleConnection(socket: Socket): void {
    const user = socket.data.user as SocketUser;
    // user is guaranteed to exist here because the middleware already verified it

    // Join a personal room so we can push to a user across all their sockets
    socket.join(`user:${user.userId}`);

    // Track online status
    if (!this.onlineUsers.has(user.userId)) {
      this.onlineUsers.set(user.userId, new Set());
    }
    this.onlineUsers.get(user.userId)!.add(socket.id);

    // Broadcast that this user is online
    this.server.emit('user:online', { userId: user.userId });

    this.logger.log(`User ${user.userId} connected (socket ${socket.id})`);
  }

  handleDisconnect(socket: Socket): void {
    const user = socket.data.user as SocketUser | undefined;
    if (!user?.userId) return;

    const sockets = this.onlineUsers.get(user.userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.onlineUsers.delete(user.userId);
        // Only broadcast offline when ALL sockets for this user are gone
        this.server.emit('user:offline', { userId: user.userId });
      }
    }
    this.logger.log(`User ${user.userId} disconnected (socket ${socket.id})`);
  }

  private requireUser(socket: Socket): SocketUser {
    const user = socket.data.user as SocketUser | undefined;
    if (!user?.userId) throw new Error('Socket not authenticated');
    return user;
  }

  isUserOnline(userId: number): boolean {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId)!.size > 0;
  }

  getOnlineUserIds(): number[] {
    return Array.from(this.onlineUsers.keys());
  }

  /* ── socket event handlers ──────────────────────────────────── */

  @SubscribeMessage('chat:join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() dto: JoinChatDto) {
    const user = this.requireUser(socket);
    try {
      const joined = await this.chatService.joinConversation(user.userId, dto.otherUserId);
      const room = `conversation:${joined.conversationId}`;
      await socket.join(room);

      // Also make the other user join the room if they're online
      const otherRoom = `user:${dto.otherUserId}`;
      const otherSockets = await this.server.in(otherRoom).fetchSockets();
      for (const s of otherSockets) {
        await s.join(room);
      }

      return { event: 'chat:joined', data: joined };
    } catch (err: any) {
      const errorData = {
        code: err?.response?.code ?? err?.response?.statusCode ?? 'JOIN_FAILED',
        message: err?.response?.message ?? err?.message ?? 'Could not join conversation',
      };
      socket.emit('chat:error', errorData);
      return { event: 'chat:error', data: errorData };
    }
  }

  @SubscribeMessage('chat:send')
  async send(@ConnectedSocket() socket: Socket, @MessageBody() dto: SendMessageDto) {
    const user = this.requireUser(socket);
    try {
      const message = await this.chatService.sendMessage(user.userId, dto.conversationId, dto.body);

      // Broadcast to ALL users in the conversation room (including sender's other tabs)
      this.server.to(`conversation:${dto.conversationId}`).emit('chat:message', {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderUserId,
        body: message.body,
        createdAt: message.createdAt,
        readAt: null,
      });

      return {
        event: 'chat:ack',
        data: {
          conversationId: dto.conversationId,
          messageId: message.id,
          createdAt: message.createdAt,
        },
      };
    } catch (err: any) {
      const errorData = {
        code: err?.response?.code ?? 'SEND_FAILED',
        message: err?.response?.message ?? err?.message ?? 'Could not send message',
      };
      socket.emit('chat:error', errorData);
      return { event: 'chat:error', data: errorData };
    }
  }

  @SubscribeMessage('chat:typing')
  async typing(@ConnectedSocket() socket: Socket, @MessageBody() dto: TypingDto) {
    const user = this.requireUser(socket);
    socket.to(`conversation:${dto.conversationId}`).emit('chat:typing', {
      conversationId: dto.conversationId,
      userId: user.userId,
      isTyping: dto.isTyping,
    });
    return { event: 'chat:typing:ack', data: { ok: true } };
  }

  @SubscribeMessage('chat:read')
  async read(@ConnectedSocket() socket: Socket, @MessageBody() dto: MarkReadDto) {
    const user = this.requireUser(socket);
    try {
      await this.chatService.markRead(user.userId, dto.conversationId, dto.messageId);
      socket.to(`conversation:${dto.conversationId}`).emit('chat:read', {
        conversationId: dto.conversationId,
        userId: user.userId,
        messageId: dto.messageId,
      });
      return { event: 'chat:read:ack', data: { ok: true } };
    } catch {
      return { event: 'chat:read:ack', data: { ok: false } };
    }
  }

  /** Client can request who's online among a list of user IDs */
  @SubscribeMessage('users:online-status')
  async onlineStatus(@ConnectedSocket() _socket: Socket, @MessageBody() dto: { userIds: number[] }) {
    const statuses: Record<number, boolean> = {};
    for (const uid of (dto.userIds ?? [])) {
      statuses[uid] = this.isUserOnline(uid);
    }
    return { event: 'users:online-status', data: statuses };
  }
}
