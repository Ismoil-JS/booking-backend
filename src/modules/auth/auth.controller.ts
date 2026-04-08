import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/user.decorator';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RequestUser } from './strategies/jwt.strategy';

function formatBookings(bookings: unknown): unknown[] | undefined {
  if (!Array.isArray(bookings)) return undefined;
  return bookings.map((b: Record<string, unknown>) => ({
    ...b,
    amountPaid: b?.amountPaid != null ? Number(b.amountPaid) : null,
    platformFee: b?.platformFee != null ? Number(b.platformFee) : 0,
    tutorEarning: b?.tutorEarning != null ? Number(b.tutorEarning) : 0,
  }));
}

function computeEarningsTotals(bookings: unknown): { totalEarnings: number; totalPlatformFees: number; totalAmountPaid: number } {
  if (!Array.isArray(bookings)) return { totalEarnings: 0, totalPlatformFees: 0, totalAmountPaid: 0 };
  let totalEarnings = 0, totalPlatformFees = 0, totalAmountPaid = 0;
  for (const b of bookings) {
    const rec = b as Record<string, unknown>;
    totalAmountPaid += rec.amountPaid != null ? Number(rec.amountPaid) : 0;
    totalPlatformFees += rec.platformFee != null ? Number(rec.platformFee) : 0;
    totalEarnings += rec.tutorEarning != null ? Number(rec.tutorEarning) : 0;
  }
  return {
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    totalPlatformFees: Math.round(totalPlatformFees * 100) / 100,
    totalAmountPaid: Math.round(totalAmountPaid * 100) / 100,
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login' })
  @ApiResponse({ status: 200, description: 'Returns access_token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('google')
  @ApiOperation({ summary: 'Sign in with Google (creates account on first use)' })
  @ApiBody({ type: GoogleLoginDto })
  @ApiResponse({ status: 201, description: 'Returns access_token' })
  @ApiResponse({ status: 401, description: 'Invalid Google ID token' })
  async googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async me(@CurrentUser() user: RequestUser | undefined) {
    if (!user?.userId) return { message: 'Not authenticated' };
    const found = await this.authService.getMeProfile(user.userId);
    if (!found) return { message: 'User not found' };
    const response: Record<string, unknown> = {
      id: found.id,
      fullName: found.fullName,
      email: found.email,
      phone: found.phone,
      userType: found.userType,
      createdAt: found.createdAt,
    };
    if (found.userType === 'TUTOR' && found.tutor) {
      const t = found.tutor as { bookings?: Array<{ amountPaid?: unknown; [k: string]: unknown }> } & typeof found.tutor;
      response.tutor = {
        id: t.id,
        about: t.about,
        bio: t.bio,
        costPer30Min: t.costPer30Min == null ? null : Number(t.costPer30Min),
        profileImage: t.profileImage,
        certificate: t.certificate,
        category: (t as { category?: unknown }).category ?? null,
        rating: t.rating == null ? null : Number(t.rating),
        isApproved: t.isApproved,
        rejectionReason: t.rejectionReason ?? null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        workExperiences: 'workExperiences' in t && Array.isArray(t.workExperiences) ? t.workExperiences : undefined,
        slots: 'slots' in t && Array.isArray(t.slots) ? t.slots : undefined,
        bookings: formatBookings(t.bookings),
        ...computeEarningsTotals(t.bookings),
      };
    }
    const foundWithLearner = found as unknown as { learner?: { id: number; bookings?: unknown[] } };
    if (found.userType === 'LEARNER' && foundWithLearner.learner) {
      const learner = foundWithLearner.learner;
      response.learner = {
        id: learner.id,
        bookings: formatBookings(learner.bookings),
      };
    }
    return response;
  }
}
