import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { env } from "../common/env";
import type { CodeEmail } from "./email";

/**
 * Sends email over SMTP, which every provider offers (Amazon SES, SendGrid,
 * Resend, Brevo, Google Workspace...), so switching provider is a settings
 * change, not a code change.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger("mail");
  private transport: Transporter | null = null;

  /** True when SMTP settings are present. */
  get configured() { return !!(env.SMTP_HOST && env.EMAIL_FROM); }

  async send(to: string, mail: CodeEmail): Promise<void> {
    if (!this.configured) throw new Error("Email is not configured");
    this.transport ??= createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,          // 465 is TLS from the start; 587 upgrades with STARTTLS
      requireTLS: env.SMTP_PORT !== 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const info = await this.transport.sendMail({ from: env.EMAIL_FROM, to, subject: mail.subject, text: mail.text, html: mail.html });
    this.log.log(`sent "${mail.subject.replace(/^\d+/, "******")}" (${info.messageId})`);
  }
}
