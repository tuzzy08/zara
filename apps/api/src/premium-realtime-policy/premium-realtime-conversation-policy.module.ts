import { Module } from "@nestjs/common";

import {
  FilePremiumRealtimeConversationPolicyRepository,
  InMemoryPremiumRealtimeConversationPolicyRepository,
} from "./premium-realtime-conversation-policy.repository";
import {
  PremiumRealtimeConversationPolicyService,
  premiumRealtimeConversationPolicyRepositoryToken,
} from "./premium-realtime-conversation-policy.service";

@Module({
  providers: [
    PremiumRealtimeConversationPolicyService,
    {
      provide: premiumRealtimeConversationPolicyRepositoryToken,
      useFactory: () => process.env.NODE_ENV === "test"
        ? new InMemoryPremiumRealtimeConversationPolicyRepository()
        : new FilePremiumRealtimeConversationPolicyRepository(
            process.env.ZARA_PREMIUM_REALTIME_POLICY_STATE_DIR ?? ".zara/premium-realtime-policy",
          ),
    },
  ],
  exports: [PremiumRealtimeConversationPolicyService],
})
export class PremiumRealtimeConversationPolicyModule {}
