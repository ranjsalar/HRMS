import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SuperAdminController } from "./superadmin.controller";
import { SuperAdminService } from "./superadmin.service";

@Module({
  // PrismaSuperAdminService comes from PrismaModule, which is @Global()
  // (see prisma.module.ts) — not imported explicitly here, same as every
  // other module that uses it.
  imports: [AuthModule, NotificationsModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService],
})
export class SuperAdminModule {}
