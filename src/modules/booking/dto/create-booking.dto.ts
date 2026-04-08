import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 1, description: 'Slot ID (session date/time come from the slot)' })
  @IsInt()
  @Min(1)
  slotId: number;
}
