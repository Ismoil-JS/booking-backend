import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { RealtimeChatService } from './realtime-chat.service';

@ApiTags('Realtime Chat')
@ApiBearerAuth()
@Controller('realtime-chat')
@UseGuards(JwtAuthGuard)
export class RealtimeChatController {
  constructor(private readonly chatService: RealtimeChatService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List my direct conversations and quota info' })
  @ApiResponse({ status: 200, description: 'Conversation list with limits and usage' })
  async listConversations(@CurrentUser() user: RequestUser | undefined) {
    if (!user?.userId) return { items: [] };
    return this.chatService.listConversationsForUser(user.userId);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'List messages by conversation (cursor pagination)' })
  @ApiResponse({ status: 200, description: 'Chronological conversation messages' })
  async listMessages(
    @CurrentUser() user: RequestUser | undefined,
    @Param('id', ParseIntPipe) conversationId: number,
    @Query() query: ListMessagesQueryDto,
  ) {
    if (!user?.userId) return { items: [], nextCursor: null };
    return this.chatService.listMessagesForConversation(user.userId, conversationId, query.cursor, query.limit ?? 30);
  }
}
