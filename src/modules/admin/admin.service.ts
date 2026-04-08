import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VerifyTutorDto } from './dto/verify-tutor.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns all tutors (verified and unverified). Only for admin. */
  async findAllTutors(filters?: { categoryIds?: number[] }) {
    return this.prisma.tutor.findMany({
      where: {
        ...(filters?.categoryIds?.length ? { categoryId: { in: filters.categoryIds } } : {}),
      },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, userType: true, createdAt: true } },
        category: true,
        workExperiences: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns one tutor by ID (any approval status). For admin to check before verification. */
  async findTutorById(tutorId: number) {
    const tutor = await this.prisma.tutor.findUnique({
      where: { id: tutorId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, userType: true, createdAt: true } },
        category: true,
        workExperiences: true,
      },
    });
    if (!tutor) throw new NotFoundException('Tutor not found');
    return tutor;
  }

  async verifyTutor(tutorId: number, dto: VerifyTutorDto) {
    const tutor = await this.prisma.tutor.findUnique({ where: { id: tutorId } });
    if (!tutor) throw new NotFoundException('Tutor not found');
    const rejectionReason = dto.isApproved ? null : dto.rejectionReason!.trim();
    return this.prisma.tutor.update({
      where: { id: tutorId },
      data: { isApproved: dto.isApproved, rejectionReason },
      include: { workExperiences: true, user: true },
    });
  }
}
