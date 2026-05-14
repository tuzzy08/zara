import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { RuntimeSessionsModule } from "./runtime-sessions/runtime-sessions.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [AuthModule, HealthModule, RuntimeSessionsModule, WorkspacesModule],
})
export class AppModule {}
