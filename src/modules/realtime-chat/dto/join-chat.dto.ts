import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class JoinChatDto {
  @ApiProperty({ example: 12, description: 'Target tutor/learner user id' })
  @IsInt()
  @Min(1)
  otherUserId!: number;
}
