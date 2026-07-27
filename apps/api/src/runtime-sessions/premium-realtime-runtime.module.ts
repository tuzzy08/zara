import { Module } from "@nestjs/common";

import { PremiumRealtimeConversationPolicyModule } from "../premium-realtime-policy/premium-realtime-conversation-policy.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { RuntimeAgentToolExecutionModule } from "../sandbox-live-sessions/runtime-agent-tool-execution.module";
import { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service";
import {
  premiumRealtimeProviderTransportToken,
  resolvePremiumRealtimeProviderEndpoint,
  WsPremiumRealtimeProviderTransport,
} from "./premium-realtime-provider-transport";
import { RuntimeSessionsService } from "./runtime-sessions.service";

@Module({
  imports: [
    PremiumRealtimeConversationPolicyModule,
    RuntimePromptPolicyModule,
    RuntimeAgentToolExecutionModule,
  ],
  providers: [
    PremiumRealtimeToolLoopService,
    RuntimeSessionsService,
    {
      provide: premiumRealtimeProviderTransportToken,
      useFactory: () => {
        resolvePremiumRealtimeProviderEndpoint(process.env);
        return new WsPremiumRealtimeProviderTransport();
      },
    },
  ],
  exports: [
    PremiumRealtimeToolLoopService,
    RuntimeSessionsService,
    premiumRealtimeProviderTransportToken,
  ],
})
export class PremiumRealtimeRuntimeModule {}
