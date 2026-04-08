import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIs...', description: 'Google ID token from frontend Sign-In' })
  @IsString()
  @MinLength(1)
  idToken: string;

  @ApiPropertyOptional({ enum: ['LEARNER', 'TUTOR'], description: 'User type for first-time sign-ups (defaults to LEARNER)' })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;
}
