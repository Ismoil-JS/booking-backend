import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService, BookingForEmail } from '../mail/mail.service';
import { UserService } from '../user/user.service';
import { CreateBookingDto } from './dto/create-booking.dto';

const bookingInclude = {
  slot: true,
  tutor: { include: { user: { select: { id: true, fullName: true, email: true } } } },
  learner: { include: { user: { select: { id: true, fullName: true, email: true } } } },
};

@Injectable()
export class BookingService {
  private readonly stripe: Stripe | null;
  private readonly successUrl: string;
  private readonly cancelUrl: string;
  private readonly platformFeePercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    this.stripe = secretKey && secretKey !== 'sk_test_REPLACE_ME'
      ? new Stripe(secretKey, { apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion })
      : null;
    this.successUrl = this.config.get<string>('STRIPE_SUCCESS_URL') ?? 'http://localhost:5173/booking/success';
    this.cancelUrl = this.config.get<string>('STRIPE_CANCEL_URL') ?? 'http://localhost:5173/booking/cancel';
    this.platformFeePercent = Math.max(0, Math.min(100, Number(this.config.get<string>('PLATFORM_FEE_PERCENT')) || 10));
  }

  private async getOrCreateLearnerId(userId: number): Promise<number> {
    let learner = await this.userService.findLearnerByUserId(userId);
    if (!learner) {
      const user = await this.userService.findById(userId);
      if (!user) throw new NotFoundException('User not found');
      learner = await this.userService.createLearner(userId);
    }
    return learner.id;
  }

  private computeFeeSplit(amountPaid: number) {
    const platformFee = Math.round(amountPaid * this.platformFeePercent) / 100;
    const tutorEarning = Math.round((amountPaid - platformFee) * 100) / 100;
    return { platformFee, tutorEarning };
  }

  /**
   * Slot.date is stored as a calendar date (Prisma @db.Date), read as UTC midnight.
   * Use UTC year/month/day so booking.date matches the slot everywhere (local getDate() caused -1 day west of UTC).
   */
  private dateOnlyUtcFromSlotDate(slotDate: Date): Date {
    const d = slotDate instanceof Date ? slotDate : new Date(slotDate);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private async validateSlot(slotId: number) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { tutor: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.tutor.isApproved) throw new BadRequestException('Tutor is not approved');

    const slotDate = slot.date instanceof Date ? slot.date : new Date(slot.date);
    const dateOnly = this.dateOnlyUtcFromSlotDate(slotDate);
    const todayUtc = this.startOfTodayUtc();
    if (dateOnly < todayUtc) throw new BadRequestException('Slot date must be today or in the future');

    const existing = await this.prisma.booking.findUnique({ where: { slotId } });
    if (existing) throw new ConflictException('This slot is already booked');

    return { slot, dateOnly, amountPaid: Number(slot.tutor.costPer30Min) };
  }

  private formatBooking(b: Record<string, unknown>) {
    return {
      ...b,
      amountPaid: b.amountPaid != null ? Number(b.amountPaid) : 0,
      platformFee: b.platformFee != null ? Number(b.platformFee) : 0,
      tutorEarning: b.tutorEarning != null ? Number(b.tutorEarning) : 0,
    };
  }

  private generateMeetLink(bookingId: number): string {
    const suffix = randomBytes(4).toString('hex');
    return `https://meet.jit.si/bisp-${bookingId}-${suffix}`;
  }

  /** Create a Stripe Checkout Session for a slot. Returns session ID + redirect URL. */
  async createCheckoutSession(userId: number, slotId: number) {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe is not configured. Set STRIPE_SECRET_KEY in .env');
    }
    const learnerId = await this.getOrCreateLearnerId(userId);
    const { slot, amountPaid } = await this.validateSlot(slotId);
    const tutorName = (slot.tutor as unknown as { user?: { fullName?: string } }).user?.fullName ?? 'Tutor';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `30-min session with ${tutorName}`,
              description: `${slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : slot.date} ${slot.startTime}–${slot.endTime}`,
            },
            unit_amount: Math.round(amountPaid * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        slotId: String(slotId),
        learnerId: String(learnerId),
        tutorId: String(slot.tutorId),
        amountPaid: String(amountPaid),
      },
      success_url: `${this.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: this.cancelUrl,
    });

    return { sessionId: session.id, url: session.url };
  }

  /** Verify a Stripe Checkout Session was paid, then create the booking. */
  async confirmPayment(userId: number, sessionId: string) {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe is not configured');
    }
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      throw new BadRequestException('Payment has not been completed');
    }

    const existingBooking = await this.prisma.booking.findFirst({
      where: { stripeSessionId: sessionId },
      include: bookingInclude,
    });
    if (existingBooking) {
      return this.formatBooking(existingBooking as unknown as Record<string, unknown>);
    }

    const meta = session.metadata ?? {};
    const slotId = Number(meta.slotId);
    const learnerId = Number(meta.learnerId);
    const tutorId = Number(meta.tutorId);
    const amountPaid = Number(meta.amountPaid);
    if (!slotId || !learnerId || !tutorId || !amountPaid) {
      throw new BadRequestException('Invalid session metadata');
    }

    const existingSlotBooking = await this.prisma.booking.findUnique({ where: { slotId } });
    if (existingSlotBooking) throw new ConflictException('This slot is already booked');

    const slot = await this.prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Slot not found');
    const slotDate = slot.date instanceof Date ? slot.date : new Date(slot.date);
    const dateOnly = this.dateOnlyUtcFromSlotDate(slotDate);

    const { platformFee, tutorEarning } = this.computeFeeSplit(amountPaid);

    const booking = await this.prisma.booking.create({
      data: {
        tutorId,
        learnerId,
        slotId,
        date: dateOnly,
        amountPaid,
        platformFee,
        tutorEarning,
        stripeSessionId: sessionId,
        paymentStatus: 'paid',
      },
    });

    const meetLink = this.generateMeetLink(booking.id);
    const updated = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { meetLink },
      include: bookingInclude,
    });
    void this.mailService.sendBookingCreatedEmails(updated as unknown as BookingForEmail);
    return this.formatBooking(updated as unknown as Record<string, unknown>);
  }

  /** Legacy instant booking (no Stripe). Kept for backward compatibility. */
  async create(userId: number, dto: CreateBookingDto) {
    const learnerId = await this.getOrCreateLearnerId(userId);
    const { slot, dateOnly, amountPaid } = await this.validateSlot(dto.slotId);
    const { platformFee, tutorEarning } = this.computeFeeSplit(amountPaid);

    const booking = await this.prisma.booking.create({
      data: {
        tutorId: slot.tutorId,
        learnerId,
        slotId: dto.slotId,
        date: dateOnly,
        amountPaid,
        platformFee,
        tutorEarning,
        paymentStatus: 'paid',
      },
    });

    const meetLink = this.generateMeetLink(booking.id);
    const updated = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { meetLink },
      include: bookingInclude,
    });
    void this.mailService.sendBookingCreatedEmails(updated as unknown as BookingForEmail);
    return this.formatBooking(updated as unknown as Record<string, unknown>);
  }

  async listByLearner(userId: number) {
    const learner = await this.userService.findLearnerByUserId(userId);
    if (!learner) return [];
    const list = await this.prisma.booking.findMany({
      where: { learnerId: learner.id },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    });
    return list.map((b) => this.formatBooking(b as unknown as Record<string, unknown>));
  }

  async listByTutor(userId: number) {
    const tutor = await this.prisma.tutor.findUnique({ where: { userId }, select: { id: true } });
    if (!tutor) return [];
    const list = await this.prisma.booking.findMany({
      where: { tutorId: tutor.id },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    });
    return list.map((b) => this.formatBooking(b as unknown as Record<string, unknown>));
  }

  /** Tutor earnings summary: totals + per-booking breakdown. */
  async getEarnings(userId: number) {
    const tutor = await this.prisma.tutor.findUnique({ where: { userId }, select: { id: true } });
    if (!tutor) throw new NotFoundException('Tutor profile not found');

    const bookings = await this.prisma.booking.findMany({
      where: { tutorId: tutor.id, paymentStatus: 'paid' },
      include: {
        slot: true,
        learner: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    let totalEarnings = 0;
    let totalPlatformFees = 0;
    let totalAmountPaid = 0;

    const items = bookings.map((b) => {
      const amountPaid = Number(b.amountPaid);
      const platformFee = Number(b.platformFee);
      const tutorEarning = Number(b.tutorEarning);
      totalEarnings += tutorEarning;
      totalPlatformFees += platformFee;
      totalAmountPaid += amountPaid;
      return {
        id: b.id,
        date: b.date,
        startTime: b.slot.startTime,
        endTime: b.slot.endTime,
        amountPaid,
        platformFee,
        tutorEarning,
        learnerName: (b.learner as unknown as { user?: { fullName?: string } }).user?.fullName ?? 'Unknown',
        paidAt: b.paidAt,
      };
    });

    return {
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      totalPlatformFees: Math.round(totalPlatformFees * 100) / 100,
      totalAmountPaid: Math.round(totalAmountPaid * 100) / 100,
      platformFeePercent: this.platformFeePercent,
      totalBookings: bookings.length,
      bookings: items,
    };
  }
}
