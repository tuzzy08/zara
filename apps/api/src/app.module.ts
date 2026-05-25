import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { HealthModule } from "./health/health.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { MemoryModule } from "./memory/memory.module";
import { PlatformAdminModule } from "./platform-admin/platform-admin.module";
import { RuntimeSessionsModule } from "./runtime-sessions/runtime-sessions.module";
import { SandboxLiveSessionsModule } from "./sandbox-live-sessions/sandbox-live-sessions.module";
import { TelephonyModule } from "./telephony/telephony.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    AuthModule,
    BillingModule,
    ComplianceModule,
    HealthModule,
    IntegrationsModule,
    MemoryModule,
    PlatformAdminModule,
    RuntimeSessionsModule,
    SandboxLiveSessionsModule,
    TelephonyModule,
    WorkspacesModule,
  ],
})
export class AppModule {}
