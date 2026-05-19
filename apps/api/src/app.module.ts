import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { RuntimeSessionsModule } from "./runtime-sessions/runtime-sessions.module";
import { SandboxLiveSessionsModule } from "./sandbox-live-sessions/sandbox-live-sessions.module";
import { TelephonyModule } from "./telephony/telephony.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [AuthModule, HealthModule, RuntimeSessionsModule, SandboxLiveSessionsModule, TelephonyModule, WorkspacesModule],
})
export class AppModule {}
