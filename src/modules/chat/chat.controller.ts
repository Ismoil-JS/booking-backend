import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ChatRequestDto } from './dto/chat.dto';
import { ChatService } from './chat.service';

@ApiTags('Chat (AI)')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message to the AI chatbot (non-streaming)' })
  @ApiBody({ type: ChatRequestDto })
  @ApiResponse({ status: 201, description: 'Returns the assistant reply', schema: { type: 'object', properties: { reply: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 503, description: 'Gemini not configured or API unavailable' })
  async chat(@Body() dto: ChatRequestDto) {
    return this.chatService.chat(dto);
  }

  @Post('stream')
  @ApiOperation({ summary: 'Send a message and stream the reply (SSE)' })
  @ApiBody({ type: ChatRequestDto })
  @ApiResponse({ status: 200, description: 'Server-Sent Events stream: each event data is { "text": "chunk" }' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 503, description: 'Gemini not configured or API unavailable' })
  async chatStream(@Body() dto: ChatRequestDto, @Res({ passthrough: false }) res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      for await (const chunk of this.chatService.chatStream(dto)) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        (res as unknown as { flush?: () => void }).flush?.();
      }
    } catch (err: unknown) {
      const quotaMsg = 'AI rate limit exceeded. Please try again in a minute.';
      let message: string;
      if (err && typeof err === 'object' && 'getResponse' in err) {
        const resBody = (err as { getResponse: () => unknown }).getResponse();
        message = typeof resBody === 'object' && resBody && 'message' in resBody ? String((resBody as { message: unknown }).message) : quotaMsg;
      } else if (err instanceof Error) {
        message = err.message.length > 200 ? quotaMsg : err.message;
      } else {
        message = quotaMsg;
      }
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
