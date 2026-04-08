import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateTutorCategoryDto } from './dto/create-tutor-category.dto';
import { UpdateTutorCategoryDto } from './dto/update-tutor-category.dto';
import { VerifyTutorDto } from './dto/verify-tutor.dto';
import { AdminService } from './admin.service';
import { TutorService } from '../tutor/tutor.service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parsePage(val: unknown): number {
  const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_PAGE;
}

function parseLimit(val: unknown): number {
  const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function parseCategoryIds(val: unknown): number[] | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  const ids = s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return ids.length ? ids : undefined;
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly tutorService: TutorService,
  ) {}

  @Get('tutor-categories')
  @ApiOperation({ summary: 'List tutor categories / types (admin). Paginated.' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (1-based)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default 10, max 100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Paginated list: { data, total, page, limit, totalPages }' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  async getTutorCategories(
    @Query('page') pageQuery?: string,
    @Query('limit') limitQuery?: string,
  ) {
    const page = parsePage(pageQuery);
    const limit = parseLimit(limitQuery);
    return this.tutorService.findCategoriesPaginated({ page, limit });
  }

  @Post('tutor-categories')
  @ApiOperation({ summary: 'Create a tutor category / type (admin)' })
  @ApiBody({ type: CreateTutorCategoryDto })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 409, description: 'Category with this name or slug already exists' })
  async createTutorCategory(@Body() dto: CreateTutorCategoryDto) {
    return this.tutorService.createCategory(dto.name, dto.slug);
  }

  @Patch('tutor-categories/:id')
  @ApiOperation({ summary: 'Update a tutor category / type (admin)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiBody({ type: UpdateTutorCategoryDto })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Another category with this name or slug already exists' })
  async updateTutorCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTutorCategoryDto,
  ) {
    return this.tutorService.updateCategory(id, dto);
  }

  @Delete('tutor-categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tutor category (admin). Linked tutors get categoryId set to null.' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async deleteTutorCategory(@Param('id', ParseIntPipe) id: number) {
    await this.tutorService.deleteCategory(id);
  }

  @Get('tutors')
  @ApiOperation({ summary: 'Get all tutors including unverified (admin only)' })
  @ApiQuery({ name: 'categoryIds', required: false, description: 'Comma-separated category IDs (e.g. 5,4)' })
  @ApiResponse({ status: 200, description: 'List of all tutors (verified and unverified)' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getAllTutors(@Query('categoryIds') categoryIdsQuery?: string) {
    const categoryIds = parseCategoryIds(categoryIdsQuery);
    const tutors = await this.adminService.findAllTutors({ categoryIds });
    return tutors.map((t) => ({
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
      user: t.user,
      workExperiences: t.workExperiences,
    }));
  }

  @Get('tutors/:id')
  @ApiOperation({ summary: 'Get one tutor by ID (admin – check before verification)' })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  @ApiResponse({ status: 200, description: 'Tutor profile' })
  @ApiResponse({ status: 404, description: 'Tutor not found' })
  async getTutorById(@Param('id', ParseIntPipe) id: number) {
    const t = await this.adminService.findTutorById(id);
    return {
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
      user: t.user,
      workExperiences: t.workExperiences,
    };
  }

  @Patch('tutors/:id/verify')
  @ApiOperation({
    summary: 'Verify or reject a tutor',
    description:
      'When rejecting (isApproved: false), rejectionReason is required (1–2000 chars). Approving clears any stored rejection reason.',
  })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  @ApiBody({ type: VerifyTutorDto })
  @ApiResponse({ status: 200, description: 'Tutor verification updated' })
  @ApiResponse({ status: 400, description: 'Validation error (e.g. missing rejectionReason when rejecting)' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async verifyTutor(
    @Param('id', ParseIntPipe) tutorId: number,
    @Body() dto: VerifyTutorDto,
  ) {
    return this.adminService.verifyTutor(tutorId, dto);
  }
}
