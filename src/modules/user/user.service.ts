import { Injectable } from '@nestjs/common';
import { Tutor, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserPayload } from './interfaces/create-user.interface';

export type UserWithTutor = User & { tutor: Tutor | null };

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  async findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByIdWithTutor(id: number): Promise<UserWithTutor | null> {
    const bookingInclude = {
      slot: true,
      tutor: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      learner: { include: { user: { select: { id: true, fullName: true, email: true } } } },
    };
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        tutor: { include: { category: true, workExperiences: true, slots: true, bookings: { include: bookingInclude } } },
        learner: { include: { bookings: { include: bookingInclude } } },
      },
    });
  }

  async create(data: CreateUserPayload): Promise<User> {
    return this.prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        passwordHash: data.passwordHash ?? null,
        googleId: data.googleId ?? null,
        phone: data.phone ?? null,
        userType: data.userType ?? 'LEARNER',
      },
    });
  }

  async linkGoogleId(userId: number, googleId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { googleId },
    });
  }

  async updateProfile(userId: number, data: { fullName?: string; phone?: string }): Promise<User> {
    const updateData: Record<string, string> = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.phone !== undefined) updateData.phone = data.phone;
    return this.prisma.user.update({ where: { id: userId }, data: updateData });
  }

  async createLearner(userId: number) {
    return this.prisma.learner.create({ data: { userId } });
  }

  async findLearnerByUserId(userId: number) {
    return this.prisma.learner.findUnique({ where: { userId } });
  }
}
