import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({ example: 'cs_test_abc123', description: 'Stripe Checkout Session ID returned from create-checkout-session' })
  @IsString()
  @MinLength(1)
  sessionId: string;
}
