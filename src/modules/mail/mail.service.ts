import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export type BookingForEmail = {
  id: number;
  meetLink: string | null;
  amountPaid: unknown;
  tutorEarning: unknown;
  date: Date;
  slot: { startTime: string; endTime: string };
  tutor: { user: { email: string; fullName: string } };
  learner: { user: { email: string; fullName: string } };
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  private isMailEnabled(): boolean {
    const raw = this.config.get<string>('MAIL_ENABLED')?.trim().toLowerCase();
    if (raw === 'false' || raw === '0') return false;
    return true;
  }

  private smtpConfigured(): boolean {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const from = this.config.get<string>('MAIL_FROM')?.trim();
    return Boolean(host && user && pass && from);
  }

  /** Fire-and-forget: notify tutor and learner after a booking is created. Does not throw. */
  async sendBookingCreatedEmails(booking: BookingForEmail): Promise<void> {
    if (!this.isMailEnabled()) {
      this.logger.debug('MAIL_ENABLED is false; skipping booking emails');
      return;
    }
    if (!this.smtpConfigured()) {
      this.logger.warn('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM); skipping booking emails');
      return;
    }

    const meetLink = booking.meetLink ?? '';
    const dateStr =
      booking.date instanceof Date
        ? booking.date.toISOString().split('T')[0]
        : String(booking.date).split('T')[0];
    const amountPaid = Number(booking.amountPaid);
    const tutorEarning = Number(booking.tutorEarning);
    const tutorName = booking.tutor.user.fullName;
    const learnerName = booking.learner.user.fullName;
    const tutorEmail = booking.tutor.user.email;
    const learnerEmail = booking.learner.user.email;

    const port = Number(this.config.get<string>('SMTP_PORT')) || 587;
    const secure =
      this.config.get<string>('SMTP_SECURE')?.trim().toLowerCase() === 'true' || port === 465;

    const transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST')?.trim(),
      port,
      secure,
      auth: {
        user: this.config.get<string>('SMTP_USER')?.trim(),
        pass: this.config.get<string>('SMTP_PASS')?.trim(),
      },
    });

    const from = this.config.get<string>('MAIL_FROM')!.trim();

    const learnerHtml = `
      <p>Hi ${escapeHtml(learnerName)},</p>
      <p>Your session is confirmed.</p>
      <ul>
        <li><strong>Tutor:</strong> ${escapeHtml(tutorName)}</li>
        <li><strong>Date:</strong> ${escapeHtml(dateStr)}</li>
        <li><strong>Time:</strong> ${escapeHtml(booking.slot.startTime)} – ${escapeHtml(booking.slot.endTime)}</li>
        <li><strong>Amount paid:</strong> $${amountPaid.toFixed(2)}</li>
      </ul>
      <p><strong>Join your video call:</strong><br><a href="${hrefSafe(meetLink)}">${escapeHtml(meetLink)}</a></p>
      <p>Booking ID: ${booking.id}</p>
    `;

    const tutorHtml = `
      <p>Hi ${escapeHtml(tutorName)},</p>
      <p>You have a new booked session.</p>
      <ul>
        <li><strong>Learner:</strong> ${escapeHtml(learnerName)} (${escapeHtml(learnerEmail)})</li>
        <li><strong>Date:</strong> ${escapeHtml(dateStr)}</li>
        <li><strong>Time:</strong> ${escapeHtml(booking.slot.startTime)} – ${escapeHtml(booking.slot.endTime)}</li>
        <li><strong>Paid:</strong> $${amountPaid.toFixed(2)}</li>
        <li><strong>Your earning (after platform fee):</strong> $${tutorEarning.toFixed(2)}</li>
      </ul>
      <p><strong>Video call link:</strong><br><a href="${hrefSafe(meetLink)}">${escapeHtml(meetLink)}</a></p>
      <p>Booking ID: ${booking.id}</p>
    `;

    try {
      await transporter.sendMail({
        from,
        to: learnerEmail,
        subject: `Booking confirmed with ${tutorName}`,
        text: stripHtml(learnerHtml),
        html: learnerHtml,
      });
      await transporter.sendMail({
        from,
        to: tutorEmail,
        subject: `New booking: session with ${learnerName}`,
        text: stripHtml(tutorHtml),
        html: tutorHtml,
      });
      this.logger.log(`Booking ${booking.id} notification emails sent to learner and tutor`);
    } catch (err) {
      this.logger.error(`Failed to send booking ${booking.id} emails: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Allow https URLs in href; fall back to # if malformed. */
function hrefSafe(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u.replace(/"/g, '%22');
  return '#';
}
