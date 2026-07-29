import { Module } from "@nestjs/common";
import { PermissionCheckService } from "./permission-check.service";
import { RbacService } from "./rbac.service";
import { RbacController } from "./rbac.controller";

@Module({
  controllers: [RbacController],
  providers: [PermissionCheckService, RbacService],
  exports: [PermissionCheckService],
})
export class RbacModule {}
