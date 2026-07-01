import { Module } from "@nestjs/common";

import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { SandboxLiveSessionsModule } from "../sandbox-live-sessions/sandbox-live-sessions.module";
import { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service";
import {
  premiumRealtimeProviderTransportToken,
  WsPremiumRealtimeProviderTransport,
} from "./premium-realtime-provider-transport";
import { RuntimeSessionsController } from "./runtime-sessions.controller";
import { RuntimeSessionsService } from "./runtime-sessions.service";
import { RuntimeSessionsWebSocketBridge } from "./runtime-sessions.websocket-bridge";

@Module({
  imports: [RuntimePromptPolicyModule, SandboxLiveSessionsModule],
  controllers: [RuntimeSessionsController],
  providers: [
    PremiumRealtimeToolLoopService,
    RuntimeSessionsService,
    RuntimeSessionsWebSocketBridge,
    {
      provide: premiumRealtimeProviderTransportToken,
      useFactory: () => new WsPremiumRealtimeProviderTransport(),
    },
  ],
  exports: [PremiumRealtimeToolLoopService, RuntimeSessionsService],
})
export class RuntimeSessionsModule {}
