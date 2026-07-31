import { Injectable } from "@nestjs/common";
import type { EmailMessage, EmailService } from "../src/common/email/email.interface";

/**
 * A real, alternate implementation of EmailService that always throws —
 * used to prove notification-failure isolation (leave-decision,
 * payslip-ready) with a real collaborator behind the same interface the
 * app already abstracts email behind, not a spy/mock on internal logic.
 * Overridden onto EMAIL_SERVICE for one dedicated NestJS testing module
 * per test file — every other provider (Prisma, real Postgres/Redis) is
 * untouched and genuinely real. See DECISIONS.md.
 */
@Injectable()
export class ThrowingEmailService implements EmailService {
  send(message: EmailMessage): Promise<void> {
    return Promise.reject(
      new Error(`Simulated SMTP failure — ThrowingEmailService always throws (to: ${message.to})`),
    );
  }
}
