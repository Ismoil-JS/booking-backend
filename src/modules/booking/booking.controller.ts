import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { BookingService } from './booking.service';

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a Stripe Checkout Session for a slot (redirects user to Stripe payment page)' })
  @ApiBody({ type: CreateBookingDto })
  @ApiResponse({
    status: 201,
    description: 'Returns Stripe session ID and redirect URL',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', example: 'cs_test_abc123' },
        url: { type: 'string', example: 'https://checkout.stripe.com/pay/cs_test_abc123' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid slot, date in the past, or slot already booked' })
  @ApiResponse({ status: 404, description: 'Slot not found' })
  @ApiResponse({ status: 409, description: 'Slot already booked' })
  @ApiResponse({ status: 503, description: 'Stripe not configured' })
  async createCheckoutSession(@CurrentUser() user: RequestUser | undefined, @Body() dto: CreateBookingDto) {
    if (!user?.userId) throw new Error('Not authenticated');
    return this.bookingService.createCheckoutSession(user.userId, dto.slotId);
  }

  @Post('confirm-payment')
  @ApiOperation({ summary: 'Confirm Stripe payment and create the booking (call after Stripe redirects back)' })
  @ApiBody({ type: ConfirmPaymentDto })
  @ApiResponse({
    status: 201,
    description: 'Booking created with payment breakdown (amountPaid, platformFee, tutorEarning)',
  })
  @ApiResponse({ status: 400, description: 'Payment not completed or invalid session' })
  @ApiResponse({ status: 409, description: 'Slot already booked' })
  @ApiResponse({ status: 503, description: 'Stripe not configured' })
  async confirmPayment(@CurrentUser() user: RequestUser | undefined, @Body() dto: ConfirmPaymentDto) {
    if (!user?.userId) throw new Error('Not authenticated');
    return this.bookingService.confirmPayment(user.userId, dto.sessionId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a booking instantly (legacy, no Stripe payment)' })
  @ApiBody({ type: CreateBookingDto })
  @ApiResponse({ status: 201, description: 'Booking created with fee breakdown' })
  @ApiResponse({ status: 400, description: 'Invalid slot/date or slot already booked' })
  async create(@CurrentUser() user: RequestUser | undefined, @Body() dto: CreateBookingDto) {
    if (!user?.userId) throw new Error('Not authenticated');
    return this.bookingService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my bookings (as learner or tutor)' })
  @ApiResponse({ status: 200, description: 'List of bookings with fee breakdown' })
  async list(@CurrentUser() user: RequestUser | undefined) {
    if (!user?.userId) return [];
    const type = String(user?.userType ?? '').toUpperCase();
    if (type === 'LEARNER') {
      return this.bookingService.listByLearner(user.userId);
    }
    if (type === 'TUTOR') {
      return this.bookingService.listByTutor(user.userId);
    }
    return [];
  }
}
