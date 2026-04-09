import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Conversation, Message, UserType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/* ── Chat limits ─────────────────────────────────────────────────── */
const PREBOOK_TUTOR_LIMIT = 3;          // max unbooked tutors per cycle
const UNBOOKED_MESSAGE_LIMIT = 20;      // messages per unbooked conversation (learner)
const BOOKED_MESSAGE_LIMIT = 200;       // messages per booked conversation (learner)
const UNBOOKED_CYCLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class RealtimeChatService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── helpers ────────────────────────────────────────────────────── */

  private normalizeDirectKey(learnerUserId: number, tutorUserId: number): string {
    return `${learnerUserId}:${tutorUserId}`;
  }

  private async getUserRole(userId: number): Promise<UserType> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    if (!user) throw new NotFoundException('User not found');
    return user.userType;
  }

  private async getLearnerAndTutorPair(userId: number, otherUserId: number) {
    const [aRole, bRole] = await Promise.all([this.getUserRole(userId), this.getUserRole(otherUserId)]);
    if (aRole === bRole) {
      throw new ForbiddenException('Only learner-to-tutor chat is allowed');
    }

    const learnerUserId = aRole === 'LEARNER' ? userId : otherUserId;
    const tutorUserId = aRole === 'TUTOR' ? userId : otherUserId;

    const [learner, tutor] = await Promise.all([
      this.prisma.learner.findUnique({ where: { userId: learnerUserId }, select: { id: true } }),
      this.prisma.tutor.findUnique({ where: { userId: tutorUserId }, select: { id: true } }),
    ]);
    if (!learner || !tutor) {
      throw new ForbiddenException('Learner or tutor profile not found');
    }
    return { learnerUserId, tutorUserId, learnerId: learner.id, tutorId: tutor.id };
  }

  private async isBookedPair(learnerId: number, tutorId: number): Promise<boolean> {
    const booking = await this.prisma.booking.findFirst({
      where: { learnerId, tutorId },
      select: { id: true },
    });
    return !!booking;
  }

  private async ensureUnbookedWindowStart(learnerUserId: number): Promise<Date> {
    const learner = await this.prisma.learner.findUnique({
      where: { userId: learnerUserId },
      select: { unbookedChatWindowStart: true },
    });
    if (!learner) throw new NotFoundException('Learner not found');

    const now = new Date();
    const start = learner.unbookedChatWindowStart;
    if (!start || now.getTime() - start.getTime() >= UNBOOKED_CYCLE_MS) {
      const updated = await this.prisma.learner.update({
        where: { userId: learnerUserId },
        data: { unbookedChatWindowStart: now },
        select: { unbookedChatWindowStart: true },
      });
      return updated.unbookedChatWindowStart ?? now;
    }
    return start;
  }

  private async getUnbookedTutorUsage(learnerUserId: number): Promise<{
    limit: number;
    used: number;
    remaining: number;
    canStartNewTutorChat: boolean;
    windowStart: Date;
  }> {
    const learner = await this.prisma.learner.findUnique({
      where: { userId: learnerUserId },
      select: { id: true },
    });
    if (!learner) throw new NotFoundException('Learner not found');

    const windowStart = await this.ensureUnbookedWindowStart(learnerUserId);
    const convs = await this.prisma.conversation.findMany({
      where: { learnerUserId, createdAt: { gte: windowStart } },
      select: { tutorUserId: true },
      distinct: ['tutorUserId'],
    });

    const unbookedTutorUserIds: number[] = [];
    for (const conv of convs) {
      const tutor = await this.prisma.tutor.findUnique({
        where: { userId: conv.tutorUserId },
        select: { id: true },
      });
      if (!tutor) continue;
      const booked = await this.isBookedPair(learner.id, tutor.id);
      if (!booked) unbookedTutorUserIds.push(conv.tutorUserId);
    }

    const used = unbookedTutorUserIds.length;
    const remaining = Math.max(0, PREBOOK_TUTOR_LIMIT - used);
    return {
      limit: PREBOOK_TUTOR_LIMIT,
      used,
      remaining,
      canStartNewTutorChat: remaining > 0,
      windowStart,
    };
  }

  private async ensureCanStartUnbookedTutorChat(learnerUserId: number, tutorUserId: number): Promise<void> {
    const usage = await this.getUnbookedTutorUsage(learnerUserId);
    if (usage.canStartNewTutorChat) return;

    // allow re-opening an existing conversation even if limit is reached
    const existing = await this.prisma.conversation.findFirst({
      where: {
        learnerUserId,
        tutorUserId,
        createdAt: { gte: usage.windowStart },
      },
      select: { id: true },
    });
    if (existing) return;

    throw new ServiceUnavailableException({
      code: 'PREBOOK_TUTOR_LIMIT_REACHED',
      message: `You can only message ${PREBOOK_TUTOR_LIMIT} unbooked tutors per week. Book a session to unlock unlimited chat.`,
    });
  }

  private async ensureParticipant(conversationId: number, userId: number): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId } },
      },
    });
    if (!conversation) throw new ForbiddenException('Conversation not found or access denied');
    return conversation;
  }

  /** Count messages the learner sent in a given conversation */
  private async getLearnerMessageCount(conversationId: number, learnerUserId: number): Promise<number> {
    return this.prisma.message.count({
      where: { conversationId, senderUserId: learnerUserId },
    });
  }

  private async getMessageUsage(conversationId: number, learnerUserId: number, booked: boolean) {
    const used = await this.getLearnerMessageCount(conversationId, learnerUserId);
    const limit = booked ? BOOKED_MESSAGE_LIMIT : UNBOOKED_MESSAGE_LIMIT;
    return { limit, used, remaining: Math.max(0, limit - used) };
  }

  /* ── public API ─────────────────────────────────────────────────── */

  async joinConversation(currentUserId: number, otherUserId: number) {
    const pair = await this.getLearnerAndTutorPair(currentUserId, otherUserId);
    const directKey = this.normalizeDirectKey(pair.learnerUserId, pair.tutorUserId);

    let conversation = await this.prisma.conversation.findUnique({ where: { directKey } });
    if (!conversation) {
      const booked = await this.isBookedPair(pair.learnerId, pair.tutorId);
      if (!booked) {
        await this.ensureCanStartUnbookedTutorChat(pair.learnerUserId, pair.tutorUserId);
      }

      try {
        conversation = await this.prisma.conversation.create({
          data: {
            kind: 'DIRECT',
            directKey,
            learnerUserId: pair.learnerUserId,
            tutorUserId: pair.tutorUserId,
            participants: {
              create: [
                { userId: pair.learnerUserId, role: 'LEARNER' },
                { userId: pair.tutorUserId, role: 'TUTOR' },
              ],
            },
          },
        });
      } catch {
        conversation = await this.prisma.conversation.findUnique({ where: { directKey } });
      }
    }
    if (!conversation) throw new ServiceUnavailableException('Failed to initialize conversation');

    const booked = await this.isBookedPair(pair.learnerId, pair.tutorId);
    const preBook = await this.getUnbookedTutorUsage(pair.learnerUserId);
    const msgUsage = await this.getMessageUsage(conversation.id, pair.learnerUserId, booked);

    return {
      conversationId: conversation.id,
      directKey: conversation.directKey,
      isTutorUnlockedByBooking: booked,
      preBookTutorLimit: preBook.limit,
      preBookTutorsUsed: preBook.used,
      preBookTutorsRemaining: preBook.remaining,
      canStartNewTutorChat: preBook.canStartNewTutorChat,
      bookedMessageLimit: BOOKED_MESSAGE_LIMIT,
      unbookedMessageLimit: UNBOOKED_MESSAGE_LIMIT,
      messagesUsed: msgUsage.used,
      messagesRemaining: msgUsage.remaining,
      messageLimit: msgUsage.limit,
    };
  }

  async sendMessage(senderUserId: number, conversationId: number, body: string): Promise<Message> {
    const conversation = await this.ensureParticipant(conversationId, senderUserId);

    const senderRole = await this.getUserRole(senderUserId);

    // Only learners have message limits; tutors can reply without limits
    if (senderRole === 'LEARNER') {
      const [learner, tutor] = await Promise.all([
        this.prisma.learner.findUnique({ where: { userId: conversation.learnerUserId }, select: { id: true } }),
        this.prisma.tutor.findUnique({ where: { userId: conversation.tutorUserId }, select: { id: true } }),
      ]);
      if (!learner || !tutor) throw new ServiceUnavailableException('Conversation participants are invalid');

      const booked = await this.isBookedPair(learner.id, tutor.id);
      const usage = await this.getMessageUsage(conversationId, conversation.learnerUserId, booked);

      if (usage.remaining <= 0) {
        const code = booked ? 'BOOKED_MESSAGE_LIMIT_REACHED' : 'UNBOOKED_MESSAGE_LIMIT_REACHED';
        const hint = booked
          ? `You've used all ${BOOKED_MESSAGE_LIMIT} messages with this tutor.`
          : `You've used all ${UNBOOKED_MESSAGE_LIMIT} free messages. Book a session to unlock ${BOOKED_MESSAGE_LIMIT} messages.`;
        throw new ServiceUnavailableException({ code, message: hint });
      }
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId,
        body: body.trim(),
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt },
    });
    return message;
  }

  async markRead(userId: number, conversationId: number, messageId: number) {
    await this.ensureParticipant(conversationId, userId);
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadMessageId: messageId },
    });
  }

  async listConversationsForUser(userId: number) {
    const userRole = await this.getUserRole(userId);
    const learner = await this.prisma.learner.findUnique({ where: { userId }, select: { id: true } });
    const preBook = learner
      ? await this.getUnbookedTutorUsage(userId)
      : { limit: PREBOOK_TUTOR_LIMIT, used: 0, remaining: PREBOOK_TUTOR_LIMIT, canStartNewTutorChat: true };

    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                userType: true,
                tutor: { select: { profileImage: true } },
              },
            },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    const items = await Promise.all(
      conversations.map(async (conversation) => {
        const tutorRecord = await this.prisma.tutor.findUnique({
          where: { userId: conversation.tutorUserId },
          select: { id: true },
        });
        const isBooked =
          !!learner &&
          !!tutorRecord &&
          (await this.isBookedPair(learner.id, tutorRecord.id));
        const msgUsage = await this.getMessageUsage(
          conversation.id,
          conversation.learnerUserId,
          isBooked,
        );

        // unread count for the requesting user
        const participant = conversation.participants.find((p) => p.userId === userId);
        let unreadCount = 0;
        if (participant) {
          unreadCount = await this.prisma.message.count({
            where: {
              conversationId: conversation.id,
              senderUserId: { not: userId },
              ...(participant.lastReadMessageId ? { id: { gt: participant.lastReadMessageId } } : {}),
            },
          });
        }

        return {
          id: conversation.id,
          directKey: conversation.directKey,
          createdAt: conversation.createdAt,
          lastMessageAt: conversation.lastMessageAt,
          participants: conversation.participants.map((p) => ({
            ...p.user,
            profileImage: p.user.tutor?.profileImage ?? null,
          })),
          lastMessage: conversation.messages[0]
            ? {
                ...conversation.messages[0],
                senderId: conversation.messages[0].senderUserId,
              }
            : null,
          isTutorUnlockedByBooking: isBooked,
          messageLimit: msgUsage.limit,
          messagesUsed: msgUsage.used,
          messagesRemaining: msgUsage.remaining,
          unreadCount,
        };
      }),
    );

    return {
      preBookTutorLimit: preBook.limit,
      preBookTutorsUsed: preBook.used,
      preBookTutorsRemaining: preBook.remaining,
      canStartNewTutorChat: preBook.canStartNewTutorChat,
      items,
    };
  }

  async listMessagesForConversation(userId: number, conversationId: number, cursor?: number, limit = 30) {
    await this.ensureParticipant(conversationId, userId);

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: {
        senderUser: { select: { id: true, fullName: true, userType: true } },
      },
      orderBy: { id: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });

    const ordered = [...messages].reverse();

    // Normalize field names so REST and Socket responses match
    const normalized = ordered.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderUserId,          // frontend expects "senderId"
      senderUserId: m.senderUserId,      // keep for backward compat
      body: m.body,
      messageType: m.messageType,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
      readAt: null as string | null,
      senderUser: m.senderUser,
    }));

    return {
      items: normalized,
      nextCursor: messages.length ? messages[messages.length - 1].id : null,
    };
  }
}
