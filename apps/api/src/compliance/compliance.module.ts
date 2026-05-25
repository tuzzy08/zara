import { Module } from "@nestjs/common";

import { MemoryModule } from "../memory/memory.module";
import { TelephonyModule } from "../telephony/telephony.module";
import { AuditLogModule } from "./audit-log.module";
import { ComplianceController } from "./compliance.controller";
import { ComplianceService } from "./compliance.service";

@Module({
  imports: [AuditLogModule, MemoryModule, TelephonyModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
})
export class ComplianceModule {}
