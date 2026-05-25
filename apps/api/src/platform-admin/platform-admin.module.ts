import { Module } from "@nestjs/common";

import { AuditLogModule } from "../compliance/audit-log.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [AuditLogModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminGuard, PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
