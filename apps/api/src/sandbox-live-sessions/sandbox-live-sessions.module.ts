import { Module } from "@nestjs/common";

import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SandboxLiveSessionsController } from "./sandbox-live-sessions.controller";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [SandboxLiveSessionsController],
  providers: [SandboxLiveSessionsService],
  exports: [SandboxLiveSessionsService],
})
export class SandboxLiveSessionsModule {}
