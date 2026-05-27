import { Module } from "@nestjs/common";

import {
  FileRuntimePromptPolicyRepository,
  InMemoryRuntimePromptPolicyRepository,
} from "./runtime-prompt-policy.repository";
import {
  RuntimePromptPolicyService,
  runtimePromptPolicyRepositoryToken,
} from "./runtime-prompt-policy.service";

@Module({
  providers: [
    RuntimePromptPolicyService,
    {
      provide: runtimePromptPolicyRepositoryToken,
      useFactory: () => {
        if (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined) {
          return new InMemoryRuntimePromptPolicyRepository();
        }

        return new FileRuntimePromptPolicyRepository(
          process.env.ZARA_RUNTIME_PROMPT_POLICY_STATE_DIR ?? ".zara/runtime-prompt-policy",
        );
      },
    },
  ],
  exports: [RuntimePromptPolicyService],
})
export class RuntimePromptPolicyModule {}
