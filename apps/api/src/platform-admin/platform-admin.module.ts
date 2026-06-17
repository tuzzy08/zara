import { Module } from "@nestjs/common";

import { AuditLogModule } from "../compliance/audit-log.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { RuntimeRoutePolicyModule } from "../runtime-route-policy/runtime-route-policy.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [AuditLogModule, RuntimePromptPolicyModule, RuntimeRoutePolicyModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminGuard, PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
