import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";

import {
  LegacyFileRuntimePromptPolicyReader,
  InMemoryRuntimePromptPolicyRepository,
  PostgresRuntimePromptPolicyRepository,
} from "./runtime-prompt-policy.repository";
import { defaultRuntimePromptPolicy } from "./runtime-prompt-policy.models";
import {
  RuntimePromptPolicyService,
  runtimePromptPolicyRepositoryToken,
} from "./runtime-prompt-policy.service";

@Module({
  imports: [DatabaseModule],
  providers: [
    RuntimePromptPolicyService,
    {
      provide: runtimePromptPolicyRepositoryToken,
      inject: [PostgresPoolService],
      useFactory: async (database: PostgresPoolService) => {
        if (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined) {
          return new InMemoryRuntimePromptPolicyRepository();
        }

        const repository = new PostgresRuntimePromptPolicyRepository(database.pool);
        if (await repository.load() !== null) {
          return repository;
        }
        const legacyRepository = new LegacyFileRuntimePromptPolicyReader(
          process.env.ZARA_RUNTIME_PROMPT_POLICY_STATE_DIR ?? ".zara/runtime-prompt-policy",
        );
        await repository.loadOrCreateInitial(await legacyRepository.load() ?? defaultRuntimePromptPolicy);
        return repository;
      },
    },
  ],
  exports: [RuntimePromptPolicyService],
})
export class RuntimePromptPolicyModule {}
