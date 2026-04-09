import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class MarkReadDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  conversationId!: number;

  @ApiProperty({ example: 19 })
  @IsInt()
  @Min(1)
  messageId!: number;
}
