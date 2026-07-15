import { Module } from "@nestjs/common";

import { PremiumRealtimeConversationPolicyModule } from "../premium-realtime-policy/premium-realtime-conversation-policy.module";
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
  imports: [PremiumRealtimeConversationPolicyModule, RuntimePromptPolicyModule, SandboxLiveSessionsModule],
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
  exports: [
    PremiumRealtimeToolLoopService,
    RuntimeSessionsService,
    premiumRealtimeProviderTransportToken,
  ],
})
export class RuntimeSessionsModule {}
