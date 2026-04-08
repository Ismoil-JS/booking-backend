import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class VerifyTutorDto {
  @ApiProperty({ example: true, description: 'Whether to approve or reject the tutor' })
  @IsBoolean()
  isApproved: boolean;

  @ApiPropertyOptional({
    description: 'Required when isApproved is false. Explains why the application was rejected. Cleared when approving.',
    example: 'Certificate image was unreadable. Please upload a clearer scan.',
    maxLength: 2000,
  })
  @ValidateIf((o: VerifyTutorDto) => o.isApproved === false)
  @IsString()
  @MinLength(1, { message: 'rejectionReason is required when rejecting a tutor' })
  @MaxLength(2000)
  rejectionReason?: string;
}
