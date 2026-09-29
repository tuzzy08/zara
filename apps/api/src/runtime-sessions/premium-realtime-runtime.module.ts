import { Module } from "@nestjs/common";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";

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
    DatabaseModule,
    PremiumRealtimeConversationPolicyModule,
    RuntimePromptPolicyModule,
    RuntimeAgentToolExecutionModule,
  ],
  providers: [
    PremiumRealtimeToolLoopService,
    RuntimeSessionsService,
    {
      provide: premiumRealtimeProviderTransportToken,
      useFactory: (database: PostgresPoolService) => {
        resolvePremiumRealtimeProviderEndpoint(process.env);
        return new WsPremiumRealtimeProviderTransport(undefined, process.env,
          new ProviderUsageRecordingRepository(database.pool));
      },
      inject: [PostgresPoolService],
    },
  ],
  exports: [
    PremiumRealtimeToolLoopService,
    RuntimeSessionsService,
    premiumRealtimeProviderTransportToken,
  ],
})
export class PremiumRealtimeRuntimeModule {}
