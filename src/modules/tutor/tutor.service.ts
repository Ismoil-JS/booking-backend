import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Slot } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateSlotDto } from './dto/create-slot.dto';
import { UpdateSlotDto } from './dto/update-slot.dto';
import { UpdateTutorProfileDto } from './dto/update-tutor-profile.dto';

const tutorWithUserInclude = {
  user: { select: { id: true, fullName: true, email: true, phone: true } },
  category: true,
  workExperiences: true,
  slots: true,
  reviews: {
    include: { learner: { include: { user: { select: { id: true, fullName: true } } } } },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

/** Minimal type for tutor record (avoids generated client resolution). */
type TutorRecord = { id: number; isApproved: boolean; [key: string]: unknown };

@Injectable()
export class TutorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cast so TypeScript accepts .tutor / .workExperience (generated client not always resolved in IDE). */
  private get db(): any {
    return this.prisma;
  }

  /** Filters: categoryIds, minPrice, maxPrice, minRating, search (text). All optional. */
  private buildTutorWhere(
    filters: { categoryIds?: number[]; minPrice?: number; maxPrice?: number; minRating?: number; search?: string },
    approvedOnly: boolean,
  ) {
    const where: Record<string, unknown> = {};
    if (approvedOnly) where.isApproved = true;
    if (filters.categoryIds?.length) where.categoryId = { in: filters.categoryIds };
    if (filters.minPrice != null || filters.maxPrice != null) {
      (where as { costPer30Min: { gte?: number; lte?: number } }).costPer30Min = {};
      if (filters.minPrice != null) (where as { costPer30Min: { gte: number } }).costPer30Min.gte = filters.minPrice;
      if (filters.maxPrice != null) (where as { costPer30Min: { lte: number } }).costPer30Min.lte = filters.maxPrice;
    }
    if (filters.minRating != null) (where as { rating: { gte: number } }).rating = { gte: filters.minRating };
    const search = filters.search?.trim();
    if (search) {
      (where as { OR: Array<Record<string, unknown>> }).OR = [
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { about: { contains: search, mode: 'insensitive' } },
        { bio: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async findAllApproved(filters?: { categoryIds?: number[]; minPrice?: number; maxPrice?: number; minRating?: number; search?: string }) {
    return this.db.tutor.findMany({
      where: this.buildTutorWhere(filters ?? {}, true),
      include: tutorWithUserInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Lightweight list for AI chat context only (no slots, no workExperiences). Faster. */
  async findApprovedForChat() {
    return this.db.tutor.findMany({
      where: { isApproved: true },
      select: {
        id: true,
        about: true,
        bio: true,
        costPer30Min: true,
        rating: true,
        user: { select: { fullName: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** All tutors (no isApproved filter). Use for admin. Supports same filters. */
  async findAll(filters?: { categoryIds?: number[]; minPrice?: number; maxPrice?: number; minRating?: number; search?: string }) {
    return this.db.tutor.findMany({
      where: this.buildTutorWhere(filters ?? {}, false),
      include: tutorWithUserInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllCategories() {
    const list = await this.db.tutorCategory.findMany({
      include: {
        _count: { select: { tutors: { where: { isApproved: true } } } },
      },
    });
    const mapped = list.map((c: { id: number; name: string; slug: string; _count: { tutors: number } }) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      tutorCount: c._count.tutors,
    }));
    mapped.sort(
      (a: { tutorCount: number; name: string }, b: { tutorCount: number; name: string }) => {
        if (b.tutorCount !== a.tutorCount) return b.tutorCount - a.tutorCount;
        return a.name.localeCompare(b.name);
      },
    );
    return mapped;
  }

  /** Paginated list of tutor categories (admin). page 1-based, limit default 10 max 100. Newest first (id desc). */
  async findCategoriesPaginated(pagination?: { page?: number; limit?: number }) {
    const page = Math.max(1, pagination?.page ?? 1);
    const limit = Math.min(100, Math.max(1, pagination?.limit ?? 10));
    const [total, data] = await Promise.all([
      this.db.tutorCategory.count(),
      this.db.tutorCategory.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  /** Create a tutor category (admin). Slug is derived from name if not provided. */
  async createCategory(name: string, slug?: string) {
    const toSlug = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    const slugValue = slug?.trim() ? toSlug(slug) : toSlug(name);
    if (!slugValue) throw new ConflictException('Slug could not be derived from name');
    const existing = await this.db.tutorCategory.findFirst({
      where: { OR: [{ name: name.trim() }, { slug: slugValue }] },
    });
    if (existing) {
      throw new ConflictException(
        existing.slug === slugValue ? 'A category with this slug already exists' : 'A category with this name already exists',
      );
    }
    return this.db.tutorCategory.create({
      data: { name: name.trim(), slug: slugValue },
    });
  }

  /** Update a tutor category (admin). Only provided fields are updated. */
  async updateCategory(
    id: number,
    dto: { name?: string; slug?: string },
  ) {
    const existing = await this.db.tutorCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tutor category not found');
    const toSlug = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const slugValue =
      dto.slug !== undefined ? (dto.slug.trim() ? toSlug(dto.slug) : toSlug(name)) : existing.slug;
    const other = await this.db.tutorCategory.findFirst({
      where: {
        id: { not: id },
        OR: [{ name }, { slug: slugValue }],
      },
    });
    if (other) {
      throw new ConflictException(
        other.slug === slugValue ? 'Another category with this slug already exists' : 'Another category with this name already exists',
      );
    }
    return this.db.tutorCategory.update({
      where: { id },
      data: { name, slug: slugValue },
    });
  }

  /** Delete a tutor category (admin). Tutors linked to this category get categoryId set to null (onDelete: SetNull). */
  async deleteCategory(id: number) {
    const existing = await this.db.tutorCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tutor category not found');
    await this.db.tutorCategory.delete({ where: { id } });
  }

  async findById(tutorId: number, approvedOnly = true) {
    const tutor = (await this.db.tutor.findUnique({
      where: { id: tutorId },
      include: tutorWithUserInclude,
    })) as TutorRecord | null;
    if (!tutor) return null;
    if (approvedOnly && !tutor.isApproved) return null;
    return tutor;
  }

  async getOrUpdateProfile(userId: number, userType: 'TUTOR' | 'ADMIN' | 'LEARNER', dto: UpdateTutorProfileDto) {
    if (userType !== 'TUTOR') {
      throw new ForbiddenException('Only tutors can update tutor profile');
    }
    if (dto.phone !== undefined) {
      await this.db.user.update({ where: { id: userId }, data: { phone: dto.phone } });
    }

    const existing = await this.db.tutor.findUnique({ where: { userId } });
    const costPer30Min = dto.costPer30Min !== undefined ? dto.costPer30Min : (existing ? Number(existing.costPer30Min) : 0);
    const categoryId = dto.categoryId !== undefined ? dto.categoryId : (existing?.categoryId ?? null);
    const rating = dto.rating !== undefined ? dto.rating : (existing?.rating != null ? Number(existing.rating) : null);
    const data = {
      about: dto.about !== undefined ? dto.about : existing?.about ?? null,
      bio: dto.bio !== undefined ? dto.bio : existing?.bio ?? null,
      costPer30Min,
      profileImage: dto.profileImage !== undefined ? dto.profileImage : existing?.profileImage ?? null,
      certificate: dto.certificate !== undefined ? dto.certificate : existing?.certificate ?? null,
      categoryId,
      rating,
    };
    if (existing) {
      const tutor = await this.db.tutor.update({
        where: { id: existing.id },
        data,
      });
      if (dto.workExperiences && dto.workExperiences.length >= 0) {
        await this.db.workExperience.deleteMany({ where: { tutorId: tutor.id } });
        if (dto.workExperiences.length > 0) {
          await this.db.workExperience.createMany({
            data: dto.workExperiences.map((we) => ({
              tutorId: tutor.id,
              companyName: we.companyName ?? '',
              role: we.role ?? null,
              yearsWorked: we.yearsWorked ?? null,
            })),
          });
        }
      }
      return this.db.tutor.findUnique({
        where: { id: tutor.id },
        include: { category: true, workExperiences: true, slots: true },
      });
    }
    const tutor = await this.db.tutor.create({
      data: {
        userId,
        about: data.about ?? null,
        bio: data.bio ?? null,
        costPer30Min,
        profileImage: data.profileImage ?? null,
        certificate: data.certificate ?? null,
        categoryId: data.categoryId ?? null,
        rating: data.rating ?? null,
        isApproved: false,
      },
    });
    if (dto.workExperiences && dto.workExperiences.length > 0) {
      await this.db.workExperience.createMany({
        data: dto.workExperiences.map((we) => ({
          tutorId: tutor.id,
          companyName: we.companyName ?? '',
          role: we.role ?? null,
          yearsWorked: we.yearsWorked ?? null,
        })),
      });
    }
    return this.db.tutor.findUnique({
      where: { id: tutor.id },
      include: { category: true, workExperiences: true, slots: true },
    });
  }

  /** Get tutor id for userId; throws if not a tutor. */
  private async getTutorId(userId: number): Promise<number> {
    const tutor = await this.db.tutor.findUnique({ where: { userId }, select: { id: true } });
    if (!tutor) throw new NotFoundException('Tutor profile not found');
    return tutor.id;
  }

  async getSlotsByUserId(userId: number) {
    const tutorId = await this.getTutorId(userId);
    const slots = await this.db.slot.findMany({
      where: { tutorId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    return Promise.all(
      slots.map(async (slot: Slot) => {
        const booking = await this.db.booking.findUnique({ where: { slotId: slot.id } });
        const booked = !!booking;
        return {
          id: slot.id,
          tutorId: slot.tutorId,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          createdAt: slot.createdAt,
          updatedAt: slot.updatedAt,
          booked,
          status: booked ? 'booked' : '-',
        };
      }),
    );
  }

  /** Parse YYYY-MM-DD to a date at UTC midnight so the calendar date is preserved (no timezone shift). */
  private parseDateOnly(dateStr: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!match) throw new ConflictException('Invalid date; use YYYY-MM-DD');
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    const d = parseInt(match[3], 10);
    const date = new Date(Date.UTC(y, m, d));
    if (isNaN(date.getTime())) throw new ConflictException('Invalid date');
    return date;
  }

  async createSlot(userId: number, dto: CreateSlotDto) {
    const tutorId = await this.getTutorId(userId);
    const dateNormalized = this.parseDateOnly(dto.date);
    const existing = await this.db.slot.findFirst({
      where: {
        tutorId,
        date: dateNormalized,
        startTime: dto.startTime,
      },
    });
    if (existing) {
      throw new ConflictException('A slot with this date and time already exists');
    }
    return this.db.slot.create({
      data: {
        tutorId,
        date: dateNormalized,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
  }

  async updateSlot(userId: number, slotId: number, dto: UpdateSlotDto) {
    const tutorId = await this.getTutorId(userId);
    const slot = await this.db.slot.findFirst({ where: { id: slotId, tutorId } });
    if (!slot) throw new NotFoundException('Slot not found');
    const slotDate = slot.date instanceof Date ? slot.date : new Date(slot.date);
    const dateOnly = dto.date != null ? this.parseDateOnly(dto.date) : slotDate;
    const startTime = dto.startTime ?? slot.startTime;
    const endTime = dto.endTime ?? slot.endTime;
    const duplicate = await this.db.slot.findFirst({
      where: {
        tutorId,
        date: dateOnly,
        startTime,
        id: { not: slotId },
      },
    });
    if (duplicate) {
      throw new ConflictException('A slot with this date and time already exists');
    }
    const data: { date?: Date; startTime?: string; endTime?: string } = {};
    if (dto.date !== undefined) data.date = dateOnly;
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    return this.db.slot.update({ where: { id: slotId }, data });
  }

  async deleteSlot(userId: number, slotId: number) {
    const tutorId = await this.getTutorId(userId);
    const slot = await this.db.slot.findFirst({ where: { id: slotId, tutorId } });
    if (!slot) throw new NotFoundException('Slot not found');
    return this.db.slot.delete({ where: { id: slotId } });
  }

  /** Get tutor slots; each slot has status "booked" or "-" (one booking per slot). Optional date (YYYY-MM-DD) filters slots to that date only. */
  async getSlotsWithBookedStatus(tutorId: number, date?: string, approvedOnly = true) {
    const tutor = await this.db.tutor.findUnique({
      where: { id: tutorId },
      include: { slots: { orderBy: [{ date: 'asc' }, { startTime: 'asc' }] } },
    });
    if (!tutor) return null;
    if (approvedOnly && !tutor.isApproved) return null;
    let slots = tutor.slots as Array<{ id: number; tutorId: number; date: Date; startTime: string; endTime: string; createdAt: Date; updatedAt: Date }>;
    if (date && typeof date === 'string' && date.trim()) {
      const filterDate = new Date(date.trim());
      if (!isNaN(filterDate.getTime())) {
        const filterDateOnly = new Date(filterDate.getFullYear(), filterDate.getMonth(), filterDate.getDate());
        slots = slots.filter((s) => {
          const d = s.date instanceof Date ? s.date : new Date(s.date);
          return d.getFullYear() === filterDateOnly.getFullYear() && d.getMonth() === filterDateOnly.getMonth() && d.getDate() === filterDateOnly.getDate();
        });
      }
    }
    const withStatus = await Promise.all(
      slots.map(async (slot) => {
        const booking = await this.db.booking.findUnique({ where: { slotId: slot.id } });
        const booked = !!booking;
        return {
          id: slot.id,
          tutorId: slot.tutorId,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          createdAt: slot.createdAt,
          updatedAt: slot.updatedAt,
          booked,
          status: booked ? 'booked' : '-',
        };
      }),
    );
    return withStatus;
  }

  async createReview(userId: number, tutorId: number, dto: CreateReviewDto) {
    const learner = await this.db.learner.findUnique({ where: { userId } });
    if (!learner) throw new BadRequestException('Only learners can leave reviews');

    const tutor = await this.db.tutor.findUnique({ where: { id: tutorId } });
    if (!tutor) throw new NotFoundException('Tutor not found');

    const booking = await this.db.booking.findFirst({
      where: { learnerId: learner.id, tutorId, paymentStatus: 'paid' },
    });
    if (!booking) throw new BadRequestException('You can only review a tutor you have had a session with');

    const existing = await this.db.review.findUnique({
      where: { tutorId_learnerId: { tutorId, learnerId: learner.id } },
    });
    if (existing) throw new ConflictException('You have already reviewed this tutor');

    const review = await this.db.review.create({
      data: { tutorId, learnerId: learner.id, rating: dto.rating, comment: dto.comment ?? null },
      include: { learner: { include: { user: { select: { id: true, fullName: true } } } } },
    });

    await this.recalculateTutorRating(tutorId);

    return review;
  }

  async getReviewsByTutorId(tutorId: number) {
    const tutor = await this.db.tutor.findUnique({ where: { id: tutorId } });
    if (!tutor) throw new NotFoundException('Tutor not found');

    return this.db.review.findMany({
      where: { tutorId },
      include: { learner: { include: { user: { select: { id: true, fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recalculateTutorRating(tutorId: number) {
    const result = await this.db.review.aggregate({
      where: { tutorId },
      _avg: { rating: true },
    });
    const avg = result._avg.rating != null ? Math.round(result._avg.rating * 100) / 100 : null;
    await this.db.tutor.update({ where: { id: tutorId }, data: { rating: avg } });
  }
}
