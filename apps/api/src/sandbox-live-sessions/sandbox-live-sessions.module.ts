import { Module } from "@nestjs/common";

import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SandboxLiveSessionsController } from "./sandbox-live-sessions.controller";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { SandboxLiveSessionsWebSocketBridge } from "./sandbox-live-sessions.websocket-bridge";

@Module({
  imports: [WorkspacesModule],
  controllers: [SandboxLiveSessionsController],
  providers: [SandboxLiveSessionsService, SandboxLiveSessionsWebSocketBridge],
  exports: [SandboxLiveSessionsService],
})
export class SandboxLiveSessionsModule {}
