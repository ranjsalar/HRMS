import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EMAIL_SERVICE } from "../../common/email/email.interface";
import { SmtpEmailService } from "../../common/email/smtp-email.service";
import { NotificationsService } from "./notifications.service";

@Module({
  providers: [
    NotificationsService,
    {
      provide: EMAIL_SERVICE,
      useFactory: (config: ConfigService) =>
        new SmtpEmailService({
          host: config.getOrThrow<string>("SMTP_HOST"),
          port: config.getOrThrow<number>("SMTP_PORT"),
          secure: config.getOrThrow<boolean>("SMTP_SECURE"),
          user: config.get<string>("SMTP_USER") ?? "",
          password: config.get<string>("SMTP_PASSWORD") ?? "",
          from: config.getOrThrow<string>("EMAIL_FROM"),
        }),
      inject: [ConfigService],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
