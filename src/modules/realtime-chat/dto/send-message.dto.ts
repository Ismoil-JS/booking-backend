import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  conversationId!: number;

  @ApiProperty({ example: 'Hi, can we discuss IELTS speaking prep?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
