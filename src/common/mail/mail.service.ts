import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pluggable mailer. Dev impl just logs to the console so the reset flow works
 * without SMTP. Swap the body of `send` for nodemailer/SES when creds exist.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const base = (
      this.config.get<string>('frontendUrl') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    const link = `${base}/reset-password?token=${token}`;
    await this.send(
      email,
      'Reset your password',
      `Use this link to reset your password (valid 30 min):\n${link}`,
    );
  }

  // TODO: replace console log with real SMTP/transactional send.
  private async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`[MAIL] to=${to} subject="${subject}"\n${body}`);
    await Promise.resolve();
  }
}
