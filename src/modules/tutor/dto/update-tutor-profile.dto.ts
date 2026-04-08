import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class WorkExperienceItemDto {
  @ApiPropertyOptional({ example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ example: 'Software Engineer' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 3, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  yearsWorked?: number;
}

export class UpdateTutorProfileDto {
  @ApiPropertyOptional({ example: 'Experienced tutor' })
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional({ example: 'Short bio text' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: 25, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPer30Min?: number;

  @ApiPropertyOptional({ example: 'https://example.com/photo.jpg' })
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ example: 'https://example.com/cert.pdf' })
  @IsOptional()
  @IsString()
  certificate?: string;

  @ApiPropertyOptional({ example: '+1234567890', description: 'Phone number (updates the user record)' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 1, description: 'Tutor category ID (e.g. IELTS, Software, Marketing)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ example: 4.5, minimum: 0, maximum: 5, description: 'Tutor rating (e.g. 0-5)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ type: [WorkExperienceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkExperienceItemDto)
  workExperiences?: WorkExperienceItemDto[];
}
