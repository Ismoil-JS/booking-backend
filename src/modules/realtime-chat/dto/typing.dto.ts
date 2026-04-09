import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';

export class TypingDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  conversationId!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isTyping!: boolean;
}
