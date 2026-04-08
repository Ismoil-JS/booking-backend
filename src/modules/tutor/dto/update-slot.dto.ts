import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const TIME_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export class UpdateSlotDto {
  @ApiPropertyOptional({ example: '2026-03-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm (e.g. 09:00)' })
  startTime?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm (e.g. 10:00)' })
  endTime?: string;
}
