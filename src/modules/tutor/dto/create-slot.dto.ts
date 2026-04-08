import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const TIME_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export class CreateSlotDto {
  @ApiProperty({ example: '2026-03-01', description: 'Date when this slot is available (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ example: '09:00', description: 'Start time in HH:mm (24h)' })
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm (e.g. 09:00)' })
  startTime: string;

  @ApiProperty({ example: '10:00', description: 'End time in HH:mm (24h)' })
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm (e.g. 10:00)' })
  endTime: string;
}
