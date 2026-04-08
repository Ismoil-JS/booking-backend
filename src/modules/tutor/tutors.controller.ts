import { Body, Controller, Get, Param, ParseIntPipe, NotFoundException, Post, UseGuards, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { CreateReviewDto } from './dto/create-review.dto';
import { TutorService } from './tutor.service';

function parseNumber(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function parseCategoryIds(val: unknown): number[] | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  const ids = s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
  return ids.length ? ids : undefined;
}

@ApiTags('Tutors (public)')
@Controller('tutors')
export class TutorsController {
  constructor(private readonly tutorService: TutorService) {}

  @Get('categories')
  @ApiOperation({
    summary: 'List tutor categories with tutorCount per category (highest count first)',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of { id, name, slug, tutorCount }',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string', example: 'Mathematics' },
          slug: { type: 'string', example: 'mathematics' },
          tutorCount: { type: 'number', example: 24 },
        },
      },
    },
  })
  async getCategories() {
    return this.tutorService.findAllCategories();
  }

  @Get(':id/slots')
  @ApiOperation({ summary: 'Get tutor slots (public). Optional ?date=YYYY-MM-DD; each slot has status booked or -' })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  @ApiQuery({ name: 'date', required: false, description: 'Date (YYYY-MM-DD) to filter slots for that day' })
  @ApiResponse({ status: 200, description: 'List of slots (booked + status: booked or -)' })
  @ApiResponse({ status: 404, description: 'Tutor not found' })
  async getTutorSlots(@Param('id', ParseIntPipe) id: number, @Query('date') date?: string) {
    const slots = await this.tutorService.getSlotsWithBookedStatus(id, date);
    if (!slots) throw new NotFoundException('Tutor not found');
    return slots;
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get tutors – approved only for public/learner; all when admin. Filter by category, price, rating. Search by name, email, about, bio.' })
  @ApiBearerAuth()
  @ApiQuery({ name: 'categoryIds', required: false, description: 'Comma-separated category IDs' })
  @ApiQuery({ name: 'minPrice', required: false, description: 'Min cost per 30 min' })
  @ApiQuery({ name: 'maxPrice', required: false, description: 'Max cost per 30 min' })
  @ApiQuery({ name: 'minRating', required: false, description: 'Min rating (0–5)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in tutor name, email, about, bio (case-insensitive)' })
  @ApiResponse({ status: 200, description: 'List of tutors' })
  async getAll(
    @CurrentUser() user: RequestUser | undefined,
    @Query('categoryIds') categoryIdsQuery?: string,
    @Query('minPrice') minPriceQuery?: string,
    @Query('maxPrice') maxPriceQuery?: string,
    @Query('minRating') minRatingQuery?: string,
    @Query('search') searchQuery?: string,
  ) {
    const isAdmin = String(user?.userType ?? '').toUpperCase() === 'ADMIN';
    const search = typeof searchQuery === 'string' ? searchQuery.trim() || undefined : undefined;
    const filters = {
      categoryIds: parseCategoryIds(categoryIdsQuery),
      minPrice: parseNumber(minPriceQuery),
      maxPrice: parseNumber(maxPriceQuery),
      minRating: parseNumber(minRatingQuery),
      search,
    };
    const tutors = await (isAdmin ? this.tutorService.findAll(filters) : this.tutorService.findAllApproved(filters));
    return tutors.map((t: Record<string, unknown>) => ({
      id: t.id,
      about: t.about,
      bio: t.bio,
      costPer30Min: t.costPer30Min == null ? null : Number(t.costPer30Min),
      profileImage: t.profileImage,
      certificate: t.certificate,
      category: (t as { category?: unknown }).category ?? null,
      rating: t.rating == null ? null : Number(t.rating),
      isApproved: t.isApproved,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      user: t.user,
      workExperiences: t.workExperiences,
      slots: (t as { slots?: unknown[] }).slots ?? [],
      reviews: (t as { reviews?: unknown[] }).reviews ?? [],
    }));
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get tutor by ID. Optional ?date=YYYY-MM-DD; slots use status booked or -' })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  @ApiQuery({ name: 'date', required: false, description: 'Date (YYYY-MM-DD) – when set, slots filtered to that day' })
  @ApiResponse({ status: 200, description: 'Tutor profile (slots include booked + status when date provided)' })
  @ApiResponse({ status: 404, description: 'Tutor not found' })
  async getById(
    @CurrentUser() user: RequestUser | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('date') date?: string,
    @Query() query?: { date?: string },
  ) {
    const approvedOnly = String(user?.userType ?? '').toUpperCase() !== 'ADMIN';
    const tutor = await this.tutorService.findById(id, approvedOnly);
    if (!tutor) throw new NotFoundException('Tutor not found');
    const dateParam = (typeof date === 'string' ? date : query?.date)?.trim?.() || undefined;
    const slots = await this.tutorService.getSlotsWithBookedStatus(id, dateParam, approvedOnly) ?? [];
    return {
      id: tutor.id,
      about: tutor.about,
      bio: tutor.bio,
      costPer30Min: tutor.costPer30Min == null ? null : Number(tutor.costPer30Min),
      profileImage: tutor.profileImage,
      certificate: tutor.certificate,
      category: (tutor as { category?: unknown }).category ?? null,
      rating: tutor.rating == null ? null : Number(tutor.rating),
      isApproved: tutor.isApproved,
      createdAt: tutor.createdAt,
      updatedAt: tutor.updatedAt,
      user: tutor.user,
      workExperiences: tutor.workExperiences,
      slots: slots ?? [],
      reviews: (tutor as { reviews?: unknown[] }).reviews ?? [],
    };
  }

  @Post(':id/reviews')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave a review for a tutor (learner must have a paid booking with the tutor)' })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  @ApiBody({ type: CreateReviewDto })
  @ApiResponse({ status: 201, description: 'Review created, tutor rating recalculated' })
  @ApiResponse({ status: 400, description: 'Not a learner, or no booking with this tutor' })
  @ApiResponse({ status: 409, description: 'Already reviewed this tutor' })
  async createReview(
    @CurrentUser() user: RequestUser | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReviewDto,
  ) {
    if (!user?.userId) throw new NotFoundException('Not authenticated');
    return this.tutorService.createReview(user.userId, id, dto);
  }

  @Get(':id/reviews')
  @ApiOperation({ summary: 'Get all reviews for a tutor (public)' })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  @ApiResponse({ status: 200, description: 'List of reviews with learner names' })
  @ApiResponse({ status: 404, description: 'Tutor not found' })
  async getReviews(@Param('id', ParseIntPipe) id: number) {
    return this.tutorService.getReviewsByTutorId(id);
  }
}
