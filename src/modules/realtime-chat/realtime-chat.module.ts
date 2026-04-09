import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeChatController } from './realtime-chat.controller';
import { RealtimeChatGateway } from './realtime-chat.gateway';
import { RealtimeChatService } from './realtime-chat.service';

@Module({
  imports: [AuthModule, UserModule, ConfigModule],
  controllers: [RealtimeChatController],
  providers: [RealtimeChatService, RealtimeChatGateway, PrismaService],
  exports: [RealtimeChatService],
})
export class RealtimeChatModule {}
