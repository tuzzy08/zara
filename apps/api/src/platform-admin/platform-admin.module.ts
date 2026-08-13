import { Module } from "@nestjs/common";

import { AuditLogModule } from "../compliance/audit-log.module";
import { PremiumRealtimeConversationPolicyModule } from "../premium-realtime-policy/premium-realtime-conversation-policy.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { RuntimeRoutePolicyModule } from "../runtime-route-policy/runtime-route-policy.module";
import { TelephonyModule } from "../telephony/telephony.module";
import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { PostgresTenantStatusRepository } from "../persistence/tenant-status.repository";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdminService } from "./platform-admin.service";
import { PostgresPlatformBillingReadRepository } from "./platform-billing-read.repository";

@Module({
  imports: [
    AuditLogModule,
    DatabaseModule,
    PremiumRealtimeConversationPolicyModule,
    RuntimePromptPolicyModule,
    RuntimeRoutePolicyModule,
    TelephonyModule,
  ],
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminGuard,
    PlatformAdminService,
    {
      provide: PostgresPlatformBillingReadRepository,
      useFactory: (postgres: PostgresPoolService) =>
        new PostgresPlatformBillingReadRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: PostgresTenantStatusRepository,
      useFactory: (postgres: PostgresPoolService) =>
        new PostgresTenantStatusRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
  ],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
